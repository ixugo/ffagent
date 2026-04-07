package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"path/filepath"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/ixugo/ffagent/agent/internal/ai"
	"github.com/ixugo/ffagent/agent/internal/core/chat"
	openai "github.com/sashabaranov/go-openai"
)

// sseWriter 实现 ai.SSEWriter 接口，将事件推送到 HTTP SSE 连接，同时收集完整回复用于持久化
// 因为标题生成协程与 Agent 主循环并发写入同一 ResponseWriter，需要互斥保护
type sseWriter struct {
	mu             sync.Mutex
	c              *gin.Context
	flusher        http.Flusher
	fullContent    strings.Builder
	collectedFiles []string
}

func newSSEWriter(c *gin.Context) *sseWriter {
	flusher, _ := c.Writer.(http.Flusher)
	return &sseWriter{c: c, flusher: flusher}
}

func (w *sseWriter) flush() {
	if w.flusher != nil {
		w.flusher.Flush()
	}
}

// data 以 base64 编码传输，避免换行符等特殊字符破坏 SSE 帧边界
func (w *sseWriter) writeEvent(event, data string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	encoded := base64.StdEncoding.EncodeToString([]byte(data))
	fmt.Fprintf(w.c.Writer, "event: %s\ndata: %s\n\n", event, encoded)
	w.flush()
}

func (w *sseWriter) SendMessage(text string) {
	w.fullContent.WriteString(text)
	w.writeEvent("message", text)
}

func (w *sseWriter) SendThinking(text string) {
	w.writeEvent("thinking", text)
}

func (w *sseWriter) SendStatus(text string) {
	w.writeEvent("status", text)
}

func (w *sseWriter) SendFile(path string) {
	slog.Debug("SSE SendFile", "path", path)
	w.collectedFiles = append(w.collectedFiles, path)
	w.writeEvent("file", path)
}

func (w *sseWriter) SendExecStart(id, cmd string) {
	payload, _ := json.Marshal(map[string]any{
		"id":  id,
		"cmd": cmd,
	})
	w.writeEvent("exec_start", string(payload))
}

func (w *sseWriter) SendExecDone(id, output string, isErr bool) {
	payload, _ := json.Marshal(map[string]any{
		"id":     id,
		"output": output,
		"error":  isErr,
	})
	w.writeEvent("exec_done", string(payload))
}

func (w *sseWriter) SendTitle(title string) {
	w.writeEvent("title", title)
}

func (w *sseWriter) SendDone() {
	w.writeEvent("done", "")
}

// handleChatSSE 处理 SSE 聊天请求
func (uc *Usecase) handleChatSSE(c *gin.Context) {
	sessionID := c.Query("session_id")
	message := c.Query("message")
	attachmentsRaw := c.Query("attachments")

	if sessionID == "" || message == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "session_id and message are required"})
		return
	}

	var attachments []string
	if attachmentsRaw != "" {
		if err := json.Unmarshal([]byte(attachmentsRaw), &attachments); err != nil {
			attachments = strings.Split(attachmentsRaw, ",")
		}
	}

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("Access-Control-Allow-Origin", "*")

	writer := newSSEWriter(c)

	ctx := c.Request.Context()

	uc.syncAIConfig(ctx)

	// 在保存用户消息前对附件执行 ffprobe，将媒体信息持久化到 content 中，
	// 确保后续轮次加载历史时 LLM 仍能看到每个附件的详细元数据（如时长）
	savedContent := message
	if len(attachments) > 0 {
		savedContent += "\n\n附件文件路径:\n" + strings.Join(attachments, "\n")
		for _, path := range attachments {
			info, err := uc.FFmpegExec.ProbeAsText(ctx, path)
			if err != nil {
				slog.Warn("probe attachment for save failed", "path", path, "err", err)
				continue
			}
			savedContent += "\n\n" + path + " 的媒体信息:\n" + info
		}
	}
	_, err := uc.ChatAPI.chatCore.AddMessage(ctx, &chat.AddMessageInput{
		SessionID:   sessionID,
		Role:        "user",
		Content:     savedContent,
		Attachments: mustJSON(attachments),
	})
	if err != nil {
		slog.Error("save user message failed", "err", err)
	}

	// 用户消息入库后立即异步生成标题并通过 SSE 推送，不阻塞后续 Agent 处理
	go uc.generateAndSaveTitle(sessionID, message, writer)

	history, err := uc.loadChatHistory(ctx, sessionID)
	if err != nil {
		slog.Error("load chat history failed", "err", err)
	}

	userSourceDir := ""
	if len(attachments) > 0 {
		userSourceDir = filepath.Dir(attachments[0])
	}

	req := ai.AgentRequest{
		SessionID:     sessionID,
		UserMessage:   message,
		Attachments:   attachments,
		History:       history,
		CacheRoot:     uc.Conf.CacheRoot,
		UserSourceDir: userSourceDir,
	}

	if err := uc.AIClient.RunAgent(ctx, req, uc.FFmpegExec, writer); err != nil {
		slog.Error("agent run failed", "session_id", sessionID, "err", err)
		return
	}

	content := writer.fullContent.String()
	if content != "" || len(writer.collectedFiles) > 0 {
		_, err := uc.ChatAPI.chatCore.AddMessage(ctx, &chat.AddMessageInput{
			SessionID:   sessionID,
			Role:        "assistant",
			Content:     content,
			Attachments: mustJSON(writer.collectedFiles),
		})
		if err != nil {
			slog.Error("save assistant message failed", "err", err)
		}
	}

}

// loadChatHistory 加载会话历史消息，转换为 OpenAI 消息格式
func (uc *Usecase) loadChatHistory(ctx context.Context, sessionID string) ([]openai.ChatCompletionMessage, error) {
	msgs, _, err := uc.ChatAPI.chatCore.FindMessages(ctx, &chat.FindMessageInput{
		SessionID: sessionID,
	})
	if err != nil {
		return nil, err
	}

	result := make([]openai.ChatCompletionMessage, 0, len(msgs))
	for _, m := range msgs {
		result = append(result, openai.ChatCompletionMessage{
			Role:    m.Role,
			Content: m.Content,
		})
	}
	return trimChatHistoryRunes(result, chatHistoryMaxRunes), nil
}

// generateAndSaveTitle 在用户消息到达后立即异步调用：生成标题 → 落库 → 通过 SSE 推送给前端
// 因为在 handleChatSSE handler 返回前调用（RunAgent 仍在运行），SSE 连接保持打开，写入安全
func (uc *Usecase) generateAndSaveTitle(sessionID, userMessage string, writer *sseWriter) {
	ctx := context.Background()

	session, err := uc.ChatAPI.chatCore.GetSession(ctx, sessionID)
	if err != nil || (session != nil && session.Title != "") {
		return
	}

	title, err := uc.AIClient.GenerateTitle(ctx, userMessage)
	if err != nil {
		slog.Error("generate title failed", "err", err)
		return
	}

	title = strings.TrimSpace(title)
	if title == "" {
		return
	}

	_, err = uc.ChatAPI.chatCore.EditSession(ctx, &chat.EditSessionInput{
		Title: title,
	}, sessionID)
	if err != nil {
		slog.Error("save title failed", "err", err)
	}

	writer.SendTitle(title)
	slog.Info("title generated and pushed via SSE", "session_id", sessionID, "title", title)
}

// syncAIConfig 每次 SSE 请求时从数据库加载最新的 openai 配置并刷新 AI Client，确保前端保存后立即生效
func (uc *Usecase) syncAIConfig(ctx context.Context) {
	cfg, err := uc.ConfigAPI.configCore.GetConfig(ctx, "openai")
	if err != nil {
		slog.Debug("load openai config for sync", "err", err)
		return
	}
	if cfg.Value == "" {
		return
	}
	if err := uc.AIClient.UpdateConfig(cfg.Value); err != nil {
		slog.Error("sync ai config failed", "err", err)
	}
}

func mustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}
