package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/ixugo/ffagent/agent/internal/pkg/ffmpeg"
	openai "github.com/sashabaranov/go-openai"
)

const (
	// maxLLMRounds 限制单次用户请求内模型推理轮次，防止无限循环
	maxLLMRounds = 25
	// maxToolFailures 连续工具失败（ffmpeg/ffprobe/解析等）上限，与成功产生的中间文件无关
	maxToolFailures = 7
)

// agentRunState 单次 RunAgent 内的可变状态：跟踪待清理的中间产物路径与缓存会话目录
type agentRunState struct {
	intermediatePaths []string
	cacheSessionDir   string
	userSourceDir     string
	attachmentPaths   map[string]struct{}
}

// isUserAttachment 判断路径是否为用户本轮上传的源文件，避免把输入文件当作产物推送
func (s *agentRunState) isUserAttachment(p string) bool {
	if s == nil || len(s.attachmentPaths) == 0 || p == "" {
		return false
	}
	_, ok := s.attachmentPaths[filepath.Clean(p)]
	return ok
}

// SSEWriter 用于向前端推送 SSE 事件
type SSEWriter interface {
	SendMessage(text string)
	SendThinking(text string)
	SendStatus(text string)
	SendFile(path string)
	// SendExecStart 工具开始执行时推送命令，前端立即渲染为"执行中"的终端块
	SendExecStart(id, cmd string)
	// SendExecDone 工具执行完成后推送结果，前端更新对应终端块
	SendExecDone(id, output string, isErr bool)
	SendTitle(title string)
	SendDone()
}

// AgentRequest 聊天请求参数
type AgentRequest struct {
	SessionID   string
	UserMessage string
	Attachments []string
	History     []openai.ChatCompletionMessage
	// CacheRoot 工作缓存根目录（…/ffagent），空则不做路径重写（便于纯 CLI 调试）
	CacheRoot string
	// UserSourceDir 首个附件所在目录，用于将最终成品复制到用户源文件旁；无附件时为空
	UserSourceDir string
}

// removeIntermediates 在任务结束时删除中间临时文件，失败仅打日志以便排查权限或占用问题
func removeIntermediates(paths []string) {
	for _, p := range paths {
		if p == "" {
			continue
		}
		if err := os.Remove(p); err != nil {
			slog.Debug("remove intermediate failed", "path", p, "err", err)
		} else {
			slog.Info("removed intermediate file", "path", p)
		}
	}
}

// toolFailureOneLine 从工具返回文本中提取首行摘要，便于向用户展示失败原因而不刷屏
func toolFailureOneLine(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = strings.TrimSpace(s[:i])
	}
	const max = 400
	if len(s) > max {
		return s[:max] + "…"
	}
	return s
}

// isToolFailureResult 判断工具返回是否应计入「连续失败」；成功的中间步骤不计入
func isToolFailureResult(s string) bool {
	switch {
	case strings.HasPrefix(s, "参数解析失败"):
		return true
	case strings.HasPrefix(s, "执行失败"):
		return true
	case strings.HasPrefix(s, "ffprobe 执行失败"):
		return true
	case strings.Contains(s, "未知的工具"):
		return true
	case strings.Contains(s, "未找到输出文件"):
		return true
	default:
		return false
	}
}

// RunAgent 执行 AI Agent 多轮循环
func (c *Client) RunAgent(ctx context.Context, req AgentRequest, executor *ffmpeg.Executor, writer SSEWriter) error {
	att := make(map[string]struct{}, len(req.Attachments))
	for _, a := range req.Attachments {
		att[filepath.Clean(a)] = struct{}{}
	}
	state := &agentRunState{
		userSourceDir:   req.UserSourceDir,
		attachmentPaths: att,
	}
	if req.CacheRoot != "" {
		state.cacheSessionDir = filepath.Join(req.CacheRoot, req.SessionID)
		if err := os.MkdirAll(state.cacheSessionDir, 0o755); err != nil {
			slog.Error("mkdir cache session dir failed", "dir", state.cacheSessionDir, "err", err)
		}
	}
	defer removeIntermediates(state.intermediatePaths)

	cacheRootLine := req.CacheRoot
	if strings.TrimSpace(cacheRootLine) == "" {
		cacheRootLine = "（未配置，未启用会话缓存路径重写）"
	}
	envBlock := fmt.Sprintf(
		"\n\n[运行环境]\n- 操作系统（Agent 进程视角）: %s/%s\n- 工作缓存根目录: %s\n- %s\n",
		runtime.GOOS, runtime.GOARCH, cacheRootLine, executor.FFmpegVersionLine(ctx),
	)

	messages := make([]openai.ChatCompletionMessage, 0, len(req.History)+3)
	messages = append(messages, openai.ChatCompletionMessage{
		Role:    openai.ChatMessageRoleSystem,
		Content: SystemPrompt() + envBlock,
	})
	messages = append(messages, req.History...)

	userContent := req.UserMessage
	if len(req.Attachments) > 0 {
		userContent += "\n\n附件文件路径:\n" + strings.Join(req.Attachments, "\n")

		for _, path := range req.Attachments {
			info, err := executor.ProbeAsText(ctx, path)
			if err != nil {
				slog.Warn("probe attachment failed", "path", path, "err", err)
				continue
			}
			userContent += "\n\n" + path + " 的媒体信息:\n" + info
		}
	}

	messages = append(messages, openai.ChatCompletionMessage{
		Role:    openai.ChatMessageRoleUser,
		Content: userContent,
	})

	toolFailures := 0
	pendingFollowUp := false
	var lastToolFailureSummary string

	for round := 0; round < maxLLMRounds; round++ {
		slog.Debug("agent round", "round", round+1, "messages_count", len(messages))

		response, err := c.collectStreamResponse(ctx, messages, writer)
		if err != nil {
			slog.Error("ai stream failed", "round", round+1, "err", err)
			writer.SendMessage("请在设置中配置 AI 服务")
			writer.SendDone()
			return err
		}

		if len(response.ToolCalls) == 0 {
			// if len(req.Attachments) > 0 && strings.TrimSpace(response.Content) != "" {
			// 	writer.SendMessage("\n\n——\n提示：本轮未调用 ffprobe/ffmpeg 工具。处理附件必须先通过工具执行；若你仍需要处理文件，请再发一条消息明确要求使用工具，或检查模型是否支持 Function Calling。")
			// 	slog.Warn("agent round ended without tool calls but session has attachments", "session_id", req.SessionID, "round", round+1)
			// }
			pendingFollowUp = false
			break
		}

		pendingFollowUp = true

		messages = append(messages, openai.ChatCompletionMessage{
			Role:      openai.ChatMessageRoleAssistant,
			Content:   response.Content,
			ToolCalls: response.ToolCalls,
		})

		for _, tc := range response.ToolCalls {
			toolResult := c.executeToolCall(ctx, tc, executor, writer, state)
			if isToolFailureResult(toolResult) {
				toolFailures++
				lastToolFailureSummary = toolFailureOneLine(toolResult)
				slog.Info("tool failure counted", "consecutive", toolFailures, "function", tc.Function.Name)
				if toolFailures >= maxToolFailures {
					hint := fmt.Sprintf("连续 %d 次执行失败，已停止处理。", toolFailures)
					hint += "可能的原因：文件路径不正确、格式不兼容或参数有误。建议检查源文件是否可读，或把任务拆成更简单的步骤重试。"
					if lastToolFailureSummary != "" {
						hint += "\n\n最近一次错误摘要：" + lastToolFailureSummary
					}
					writer.SendMessage(hint)
					writer.SendDone()
					return nil
				}
			} else {
				toolFailures = 0
			}
			messages = append(messages, openai.ChatCompletionMessage{
				Role:       openai.ChatMessageRoleTool,
				ToolCallID: tc.ID,
				Content:    toolResult,
			})
		}
	}

	if pendingFollowUp {
		writer.SendMessage("当前任务步骤较多，已达到本对话的处理轮次上限。若还需要继续处理，请新开一条对话或拆成更小的步骤。")
	}

	writer.SendDone()
	return nil
}

// streamResponse 收集流式响应的结果
type streamResponse struct {
	Content          string
	ReasoningContent string
	ToolCalls        []openai.ToolCall
}

// collectStreamResponse 发起流式请求，收集文本和 tool calls
func (c *Client) collectStreamResponse(ctx context.Context, messages []openai.ChatCompletionMessage, writer SSEWriter) (*streamResponse, error) {
	stream, err := c.CreateChatStream(ctx, messages)
	if err != nil {
		return nil, fmt.Errorf("create chat stream: %w", err)
	}
	defer stream.Close()

	result := &streamResponse{}
	toolCallMap := make(map[int]*openai.ToolCall)

	for {
		chunk, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("recv stream: %w", err)
		}

		if len(chunk.Choices) == 0 {
			continue
		}

		delta := chunk.Choices[0].Delta

		if delta.ReasoningContent != "" {
			result.ReasoningContent += delta.ReasoningContent
			writer.SendThinking(delta.ReasoningContent)
		}

		if delta.Content != "" {
			result.Content += delta.Content
			writer.SendMessage(delta.Content)
		}

		for _, tc := range delta.ToolCalls {
			idx := 0
			if tc.Index != nil {
				idx = *tc.Index
			}

			if existing, ok := toolCallMap[idx]; ok {
				existing.Function.Arguments += tc.Function.Arguments
			} else {
				call := openai.ToolCall{
					ID:   tc.ID,
					Type: tc.Type,
					Function: openai.FunctionCall{
						Name:      tc.Function.Name,
						Arguments: tc.Function.Arguments,
					},
				}
				toolCallMap[idx] = &call
			}
		}
	}

	for i := 0; i < len(toolCallMap); i++ {
		if tc, ok := toolCallMap[i]; ok {
			result.ToolCalls = append(result.ToolCalls, *tc)
		}
	}

	slog.Info("llm stream round complete", "tool_calls", len(result.ToolCalls), "content_len", len(result.Content), "reasoning_len", len(result.ReasoningContent))
	return result, nil
}

// executeToolCall 执行单个 tool call 并返回结果文本
func (c *Client) executeToolCall(ctx context.Context, tc openai.ToolCall, executor *ffmpeg.Executor, writer SSEWriter, state *agentRunState) string {
	switch tc.Function.Name {
	case "execute_write_file":
		return c.execWriteFile(tc.Function.Arguments, state)
	default:
	}

	args, err := ParseExecuteFFmpegArgs(tc.Function.Arguments)
	if err != nil {
		slog.Error("parse tool call args", "err", err, "raw", tc.Function.Arguments)
		return fmt.Sprintf("参数解析失败: %s", err.Error())
	}

	slog.Info("executing tool call", "function", tc.Function.Name, "args", args.Args, "is_intermediate", args.IsIntermediate)

	switch tc.Function.Name {
	case "execute_ffmpeg":
		return c.execFFmpeg(ctx, args, executor, writer, state)
	case "execute_ffprobe":
		return c.execFFprobe(ctx, args.Args, executor, writer)
	default:
		return fmt.Sprintf("未知的工具: %s", tc.Function.Name)
	}
}

// execWriteFile 将文本内容写入会话缓存目录下的文件，供后续 ffmpeg concat 等操作使用
func (c *Client) execWriteFile(arguments string, state *agentRunState) string {
	var wf WriteFileArgs
	if err := json.Unmarshal([]byte(arguments), &wf); err != nil {
		slog.Error("parse write_file args", "err", err, "raw", arguments)
		return fmt.Sprintf("参数解析失败: %s", err.Error())
	}

	if state == nil || state.cacheSessionDir == "" {
		return "写文件失败: 会话缓存目录未初始化"
	}

	cleanName := filepath.Base(filepath.Clean(wf.Filename))
	dest := filepath.Join(state.cacheSessionDir, cleanName)

	slog.Info("executing write_file", "filename", cleanName, "dest", dest, "content_len", len(wf.Content))

	if err := os.WriteFile(dest, []byte(wf.Content), 0o644); err != nil {
		slog.Error("write file failed", "dest", dest, "err", err)
		return fmt.Sprintf("写文件失败: %s", err.Error())
	}

	state.intermediatePaths = append(state.intermediatePaths, dest)
	return fmt.Sprintf("文件已写入: %s", dest)
}

// fixTimeArgs 修正 -ss/-t/-to 后面的时间参数，将模型可能生成的非法时间格式（如 00:00:268.607）转为秒数
func fixTimeArgs(args []string) []string {
	timeFlags := map[string]bool{"-ss": true, "-t": true, "-to": true, "-sseof": true}
	result := make([]string, len(args))
	copy(result, args)
	for i := 0; i < len(result)-1; i++ {
		if !timeFlags[result[i]] {
			continue
		}
		fixed := fixTimestamp(result[i+1])
		if fixed != result[i+1] {
			slog.Debug("fixed time arg", "flag", result[i], "from", result[i+1], "to", fixed)
			result[i+1] = fixed
		}
	}
	return result
}

// fixTimestamp 检测并修正 HH:MM:SS 格式中 SS>=60 的情况（如 00:00:268.607 → 268.607 秒数表示）
func fixTimestamp(ts string) string {
	if !strings.Contains(ts, ":") {
		return ts
	}
	parts := strings.SplitN(ts, ":", 3)
	if len(parts) != 3 {
		return ts
	}
	var secStr string
	if dotIdx := strings.Index(parts[2], "."); dotIdx >= 0 {
		secStr = parts[2][:dotIdx]
	} else {
		secStr = parts[2]
	}
	sec := 0
	for _, c := range secStr {
		if c < '0' || c > '9' {
			return ts
		}
		sec = sec*10 + int(c-'0')
	}
	if sec < 60 {
		return ts
	}
	h := 0
	for _, c := range parts[0] {
		if c < '0' || c > '9' {
			return ts
		}
		h = h*10 + int(c-'0')
	}
	m := 0
	for _, c := range parts[1] {
		if c < '0' || c > '9' {
			return ts
		}
		m = m*10 + int(c-'0')
	}
	totalSec := float64(h*3600 + m*60 + sec)
	if dotIdx := strings.Index(parts[2], "."); dotIdx >= 0 {
		fracStr := parts[2][dotIdx:]
		frac := 0.0
		fmt.Sscanf(fracStr, "%f", &frac)
		totalSec += frac
	}
	return fmt.Sprintf("%.3f", totalSec)
}

// normalizeArgs 将模型可能错误合并为单个字符串的参数拆分为独立元素，
// 同时处理路径中包含空格的情况（被引号包裹的参数不拆分）
func normalizeArgs(args []string) []string {
	var result []string
	for _, a := range args {
		if !strings.Contains(a, " ") {
			result = append(result, a)
			continue
		}
		parts := splitRespectingQuotes(a)
		if len(parts) > 1 {
			slog.Debug("normalized merged arg", "from", a, "to", parts)
			result = append(result, parts...)
		} else {
			result = append(result, a)
		}
	}
	return result
}

// splitRespectingQuotes 按空格拆分字符串，但保留被单/双引号包裹的内容为整体
func splitRespectingQuotes(s string) []string {
	var parts []string
	var cur strings.Builder
	inQuote := rune(0)
	for _, ch := range s {
		switch {
		case inQuote != 0:
			if ch == inQuote {
				inQuote = 0
			} else {
				cur.WriteRune(ch)
			}
		case ch == '\'' || ch == '"':
			inQuote = ch
		case ch == ' ':
			if cur.Len() > 0 {
				parts = append(parts, cur.String())
				cur.Reset()
			}
		default:
			cur.WriteRune(ch)
		}
	}
	if cur.Len() > 0 {
		parts = append(parts, cur.String())
	}
	return parts
}

// containsFlag 检查参数列表中是否已包含指定的 flag
func containsFlag(args []string, flag string) bool {
	for _, a := range args {
		if a == flag {
			return true
		}
	}
	return false
}

// lastNonFlagArg 取参数列表中最后一个非选项参数，通常对应 ffmpeg 输出文件路径
func lastNonFlagArg(args []string) string {
	for i := len(args) - 1; i >= 0; i-- {
		a := args[i]
		if strings.HasPrefix(a, "-") {
			continue
		}
		return a
	}
	return ""
}

func (c *Client) execFFmpeg(ctx context.Context, execArgs ExecuteFFmpegArgs, executor *ffmpeg.Executor, writer SSEWriter, state *agentRunState) string {
	args := normalizeArgs(execArgs.Args)
	if !containsFlag(args, "-y") {
		args = append([]string{"-y"}, args...)
	}
	args = fixTimeArgs(args)

	// 将模型给出的非绝对路径输入参数（-i 后面的值）重写为缓存目录下的绝对路径，
	// 使 concat filelist 等通过 execute_write_file 创建的中间文件能被正确找到
	if state != nil && state.cacheSessionDir != "" {
		args = rewriteRelativeInputs(args, state.cacheSessionDir)
	}

	cmdLine := "ffmpeg " + strings.Join(args, " ")
	execID := fmt.Sprintf("exec-%d", time.Now().UnixNano())
	writer.SendExecStart(execID, cmdLine)
	writer.SendStatus("正在处理中，请稍等...")

	execCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()

	// 将模型给出的输出路径统一改写到会话缓存目录，避免直接污染用户目录；最终文件成功后再复制到源文件旁
	if state != nil && state.cacheSessionDir != "" {
		if orig := lastNonFlagArg(args); orig != "" {
			base := filepath.Base(filepath.Clean(orig))
			destInCache := ensureUniquePath(state.cacheSessionDir, base)
			args = replaceLastOutputArg(args, destInCache)
			slog.Debug("rewrote ffmpeg output path", "from", orig, "to", destInCache)
		}
	}

	slog.Debug("execFFmpeg invoke", "args", args, "is_intermediate", execArgs.IsIntermediate)

	if execArgs.IsIntermediate && state != nil {
		if p := lastNonFlagArg(args); p != "" {
			state.intermediatePaths = append(state.intermediatePaths, filepath.Clean(p))
		}
	}

	result, err := executor.RunFFmpeg(execCtx, args)
	if err != nil {
		slog.Debug("execFFmpeg returned error to model", "err", err)
		stderrUseful := extractUsefulStderr(result.Stderr)
		toolResult := fmt.Sprintf("执行失败 (耗时 %s):\n%s", result.Duration.Round(time.Millisecond), stderrUseful)
		toolResult += buildInputPathReminder(args, result.Stderr, state)
		writer.SendExecDone(execID, toolResult, true)
		return toolResult
	}

	output := fmt.Sprintf("执行成功 (耗时 %s)", result.Duration.Round(time.Millisecond))
	if result.Stderr != "" {
		output += "\nstderr: " + result.Stderr
	}

	// exit 0 仍可能未生成文件或空文件（路径错、-t 0 等），避免模型误判
	if outPath := lastNonFlagArg(args); outPath != "" {
		clean := filepath.Clean(outPath)
		st, statErr := os.Stat(clean)
		if statErr != nil {
			slog.Warn("ffmpeg exit 0 but output missing", "path", clean, "err", statErr)
			output += fmt.Sprintf("\n\n⚠️ 警告：进程返回成功但磁盘上未找到输出文件 %q，请勿对用户声称已生成文件，请根据 stderr 分析原因或重试。", clean)
		} else if st.Size() == 0 {
			slog.Warn("ffmpeg exit 0 but output file is empty", "path", clean)
			output += "\n\n⚠️ 警告：输出文件大小为 0 字节（空文件），请检查 -ss/-t 参数是否正确。常见错误：-t 0 表示提取 0 秒时长，应当使用 -t <秒数> 指定实际时长。"
		} else {
			slog.Debug("ffmpeg output file verified", "path", clean, "size", st.Size())
		}
	}

	writer.SendExecDone(execID, output, false)

	// 最终交付只推送「主输出」一个路径，且绝不包含用户附件中的源文件
	if !execArgs.IsIntermediate {
		cacheOut := ""
		if p := lastNonFlagArg(args); p != "" {
			cacheOut = filepath.Clean(p)
		}
		slog.Debug("file delivery check", "is_intermediate", execArgs.IsIntermediate, "cacheOut", cacheOut, "isAttachment", state.isUserAttachment(cacheOut))
		if cacheOut != "" && !state.isUserAttachment(cacheOut) {
			if st, statErr := os.Stat(cacheOut); statErr == nil && !st.IsDir() {
				if state != nil && state.userSourceDir != "" {
					finalPath := ensureUniquePath(state.userSourceDir, filepath.Base(cacheOut))
					slog.Debug("copying final output", "from", cacheOut, "to", finalPath)
					if cpErr := copyFile(cacheOut, finalPath); cpErr != nil {
						slog.Error("copy final output to user dir failed", "from", cacheOut, "to", finalPath, "err", cpErr)
						writer.SendFile(cacheOut)
					} else {
						slog.Info("copied final output beside user source", "dest", finalPath)
						writer.SendFile(finalPath)
						if rmErr := os.Remove(cacheOut); rmErr != nil {
							slog.Debug("remove cache file after export", "path", cacheOut, "err", rmErr)
						}
					}
				} else {
					slog.Debug("no userSourceDir, sending cache path", "path", cacheOut)
					writer.SendFile(cacheOut)
				}
			} else {
				slog.Debug("file delivery skipped: stat failed or is dir", "path", cacheOut, "statErr", statErr)
			}
		} else if cacheOut == "" {
			slog.Debug("file delivery skipped: no output path detected")
		}
	} else {
		slog.Debug("file delivery skipped: is_intermediate", "is_intermediate", execArgs.IsIntermediate)
	}

	return output
}

// rewriteRelativeInputs 将 -i 后面的非绝对路径参数重写为缓存目录下的绝对路径，
// 使 execute_write_file 创建的文件（如 filelist.txt）在 ffmpeg 命令中能被正确定位
func rewriteRelativeInputs(args []string, cacheDir string) []string {
	result := make([]string, len(args))
	copy(result, args)
	for i := 0; i < len(result)-1; i++ {
		if result[i] != "-i" {
			continue
		}
		val := result[i+1]
		if filepath.IsAbs(val) {
			continue
		}
		candidate := filepath.Join(cacheDir, val)
		if _, err := os.Stat(candidate); err == nil {
			slog.Debug("rewrote relative input to cache path", "from", val, "to", candidate)
			result[i+1] = candidate
		}
	}
	return result
}

// extractUsefulStderr 从 ffmpeg/ffprobe 的 stderr 中提取有价值的错误信息，
// 过滤掉大段的版本/编译配置信息，只保留真正的错误行
func extractUsefulStderr(stderr string) string {
	lines := strings.Split(stderr, "\n")
	var useful []string
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		if strings.HasPrefix(trimmed, "ffmpeg version") ||
			strings.HasPrefix(trimmed, "ffprobe version") ||
			strings.HasPrefix(trimmed, "built with") ||
			strings.HasPrefix(trimmed, "configuration:") ||
			strings.HasPrefix(trimmed, "lib") ||
			strings.HasPrefix(trimmed, "--") {
			continue
		}
		useful = append(useful, trimmed)
	}
	if len(useful) == 0 {
		return stderr
	}
	result := strings.Join(useful, "\n")
	const maxLen = 1000
	if len(result) > maxLen {
		return result[:maxLen] + "…"
	}
	return result
}

// buildInputPathReminder 当 stderr 含"No such file"等路径错误时，提取 -i 参数中的输入路径与附件原始路径做对比，
// 生成提示文本帮助模型定位路径修改问题
func buildInputPathReminder(args []string, stderr string, state *agentRunState) string {
	if !strings.Contains(stderr, "No such file") && !strings.Contains(stderr, "does not exist") {
		return ""
	}
	var inputPaths []string
	for i, a := range args {
		if a == "-i" && i+1 < len(args) {
			inputPaths = append(inputPaths, args[i+1])
		}
	}
	if len(inputPaths) == 0 {
		return ""
	}
	hint := "\n\n⚠️ 检测到文件不存在错误。你当前传入的输入路径为："
	for _, p := range inputPaths {
		hint += fmt.Sprintf("\n  → %s", p)
	}
	if state != nil && len(state.attachmentPaths) > 0 {
		hint += "\n用户附件的正确路径为："
		for p := range state.attachmentPaths {
			hint += fmt.Sprintf("\n  ✓ %s", p)
		}
		hint += "\n请逐字核对上述路径，禁止修改任何字符（包括空格、中文标点）。"
	}
	return hint
}

func (c *Client) execFFprobe(ctx context.Context, rawArgs []string, executor *ffmpeg.Executor, writer SSEWriter) string {
	args := normalizeArgs(rawArgs)
	cmdLine := "ffprobe " + strings.Join(args, " ")
	execID := fmt.Sprintf("exec-%d", time.Now().UnixNano())
	writer.SendExecStart(execID, cmdLine)

	execCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	slog.Debug("execFFprobe invoke", "args", args)

	result, err := executor.RunFFprobe(execCtx, args)
	if err != nil {
		stderrUseful := extractUsefulStderr(result.Stderr)
		toolResult := fmt.Sprintf("ffprobe 执行失败:\n%s", stderrUseful)
		toolResult += buildInputPathReminder(args, result.Stderr, nil)
		writer.SendExecDone(execID, toolResult, true)
		return toolResult
	}

	var toolResult string
	var prettyJSON json.RawMessage
	if json.Unmarshal([]byte(result.Stdout), &prettyJSON) == nil {
		toolResult = result.Stdout
	} else {
		toolResult = result.Stdout + "\n" + result.Stderr
	}

	writer.SendExecDone(execID, toolResult, false)
	return toolResult
}
