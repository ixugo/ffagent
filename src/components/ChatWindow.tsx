import { useRef, useState, useEffect, useCallback } from "react";
import { Input, Button, Spin, Tooltip } from "antd";
import {
  SendOutlined,
  PaperClipOutlined,
  ExclamationCircleOutlined,
  RightOutlined,
  DownOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
} from "@ant-design/icons";
import { XMarkdown } from "@ant-design/x-markdown";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useLocale } from "../services/i18n";
import FileLink from "./FileLink";
import AttachmentBar, { type AttachmentItem } from "./AttachmentBar";

function newAttachmentId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function pathsToAttachmentItems(paths: string[]): AttachmentItem[] {
  return paths.map((path) => ({ id: newAttachmentId(), path }));
}


/** 终端执行记录 */
export interface ExecRecord {
  id: string;
  cmd: string;
  output: string;
  error: boolean;
  /** 是否正在执行中（尚未收到 exec_done） */
  running?: boolean;
}

/** 混合内容块：assistant 消息由这些块按时间顺序排列组成 */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "exec"; exec: ExecRecord }
  | { type: "file"; path: string }
  | { type: "thinking"; text: string };

/** 单条聊天展示数据；用户消息可携带重发载荷与失败状态 */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  files?: string[];
  /** assistant 消息的有序内容块（文字、终端、文件交错），替代原来分离的 content/execs/files */
  blocks?: ContentBlock[];
  sendFailed?: boolean;
  sendError?: string;
  /** 重发时使用的原始文本与附件路径 */
  requestPayload?: { text: string; attachments: string[] };
}

/** 单个终端命令块：可折叠，默认始终折叠，仅用户手动展开后保持展开 */
function TerminalBlock({ exec }: { exec: ExecRecord }) {
  const [expanded, setExpanded] = useState(false);

  const cmdName = exec.cmd.split(" ")[0];
  const truncatedCmd = exec.cmd.length > 60 ? exec.cmd.slice(0, 57) + "..." : exec.cmd;

  return (
    <div
      style={{
        margin: "6px 0",
        borderRadius: 8,
        overflow: "hidden",
        border: "1px solid #333",
        background: "#1e1e1e",
        fontSize: 13,
        fontFamily: "'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace",
      }}
    >
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          cursor: "pointer",
          userSelect: "none",
          color: "#ccc",
        }}
      >
        {expanded ? (
          <DownOutlined style={{ fontSize: 10, color: "#888" }} />
        ) : (
          <RightOutlined style={{ fontSize: 10, color: "#888" }} />
        )}
        {exec.running ? (
          <Spin size="small" />
        ) : exec.error ? (
          <CloseCircleFilled style={{ color: "#ff4d4f", fontSize: 14 }} />
        ) : (
          <CheckCircleFilled style={{ color: "#52c41a", fontSize: 14 }} />
        )}
        <span style={{ color: "#569cd6" }}>{cmdName}</span>
        <span style={{ color: "#888", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {truncatedCmd}
        </span>
      </div>
      {expanded && (
        <div
          style={{
            borderTop: "1px solid #333",
            padding: "8px 12px",
            maxHeight: 300,
            overflow: "auto",
          }}
        >
          <pre
            style={{
              margin: 0,
              color: "#569cd6",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              lineHeight: 1.5,
            }}
          >
            <span style={{ color: "#888" }}>$</span> {exec.cmd}
          </pre>
          {exec.running && (
            <div style={{ margin: "8px 0 0", color: "#888" }}>
              <Spin size="small" style={{ marginRight: 6 }} />
              执行中...
            </div>
          )}
          {exec.output && (
            <pre
              style={{
                margin: "8px 0 0",
                color: exec.error ? "#ff6b6b" : "#d4d4d4",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                lineHeight: 1.4,
              }}
            >
              {exec.output}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

/** 思考/推理过程展示块：默认折叠，可展开查看模型的内部推理 */
function ThinkingBlock({ text, streaming }: { text: string; streaming?: boolean }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        margin: "6px 0",
        borderRadius: 8,
        overflow: "hidden",
        border: "1px solid #e6d8ff",
        background: "#faf5ff",
        fontSize: 13,
      }}
    >
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          cursor: "pointer",
          userSelect: "none",
          color: "#722ed1",
        }}
      >
        {expanded ? (
          <DownOutlined style={{ fontSize: 10, color: "#b37feb" }} />
        ) : (
          <RightOutlined style={{ fontSize: 10, color: "#b37feb" }} />
        )}
        {streaming && <Spin size="small" />}
        <span style={{ fontWeight: 500 }}>
          {streaming ? "思考中..." : "思考过程"}
        </span>
      </div>
      {expanded && (
        <div
          style={{
            borderTop: "1px solid #e6d8ff",
            padding: "8px 12px",
            maxHeight: 400,
            overflow: "auto",
          }}
        >
          <div className="chat-markdown-body" style={{ color: "#595959" }}>
            <XMarkdown content={text} />
          </div>
        </div>
      )}
    </div>
  );
}

interface ChatWindowProps {
  messages: ChatMessage[];
  loading: boolean;
  streamingText: string;
  /** 流式过程中正在产生的思考内容 */
  streamingThinking: string;
  /** 流式过程中已到达的内容块（终端、文件等），实时展示 */
  streamingBlocks: ContentBlock[];
  statusText: string;
  onSend: (message: string, attachments: string[]) => void;
  /** 点击感叹号重发该条用户消息 */
  onRetrySend?: (messageId: string) => void;
}

export default function ChatWindow({
  messages,
  loading,
  streamingText,
  streamingThinking,
  streamingBlocks,
  statusText,
  onSend,
  onRetrySend,
}: ChatWindowProps) {
  const { t } = useLocale();
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  // Tauri drag-drop：通过 webview window 的 onDragDropEvent 获取拖入文件的绝对路径
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const appWindow = getCurrentWebviewWindow();
    appWindow.onDragDropEvent((event) => {
      if (event.payload.type === "drop") {
        const paths = event.payload.paths;
        if (paths.length > 0) {
          setAttachments((prev) => [...prev, ...pathsToAttachmentItems(paths)]);
        }
      }
    }).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, []);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    onSend(
      text,
      attachments.map((a) => a.path)
    );
    setInput("");
    setAttachments([]);
  }, [input, attachments, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSelectFile = async () => {
    try {
      const result = await openFileDialog({
        multiple: true,
        filters: [
          {
            name: "Media",
            extensions: [
              "mp4", "mkv", "avi", "mov", "webm", "flv", "m4v", "ts",
              "mp3", "wav", "aac", "flac", "ogg",
              "jpg", "jpeg", "png", "gif", "bmp",
            ],
          },
        ],
      });
      if (result) {
        const paths = (Array.isArray(result) ? result : [result]).map(
          (f) => (typeof f === "string" ? f : f.path),
        );
        if (paths.length > 0) {
          setAttachments((prev) => [...prev, ...pathsToAttachmentItems(paths)]);
        }
      }
    } catch (e) {
      console.error("File dialog error:", e);
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((x) => x.id !== id));
  };

  return (
    <div
      ref={wrapperRef}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#fff",
      }}
    >
      {/* 标题栏拖拽区域 */}
      <div data-tauri-drag-region className="app-drag-region" style={{ height: 48, flexShrink: 0 }} />
      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflow: "auto",
          padding: "0 24px 16px",
        }}
      >
        {messages.length === 0 && !streamingText && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "#999",
              fontSize: 15,
            }}
          >
            {t("chat.welcome")}
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              display: "flex",
              justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
              marginBottom: 12,
              alignItems: "flex-start",
              gap: 8,
            }}
          >
            {msg.role === "user" && msg.sendFailed && (
              <Tooltip title={msg.sendError || t("chat.networkError")}>
                <ExclamationCircleOutlined
                  role="button"
                  aria-label={t("chat.retrySend")}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRetrySend?.(msg.id);
                  }}
                  style={{
                    color: "#ff4d4f",
                    fontSize: 18,
                    cursor: "pointer",
                    marginTop: 10,
                    flexShrink: 0,
                  }}
                />
              </Tooltip>
            )}
            {msg.role === "assistant" ? (
              <div style={{ maxWidth: "75%", fontSize: 14, lineHeight: 1.6 }}>
                {msg.blocks && msg.blocks.length > 0
                  ? msg.blocks.map((block, i) => {
                      if (block.type === "thinking" && block.text) {
                        return <ThinkingBlock key={i} text={block.text} />;
                      }
                      if (block.type === "text" && block.text) {
                        return (
                          <div key={i} className="chat-markdown-body">
                            <XMarkdown content={block.text} />
                          </div>
                        );
                      }
                      if (block.type === "exec") {
                        return <TerminalBlock key={i} exec={block.exec} />;
                      }
                      if (block.type === "file") {
                        return (
                          <div key={i} style={{ marginTop: 4 }}>
                            <FileLink path={block.path} variant="default" />
                          </div>
                        );
                      }
                      return null;
                    })
                  : (
                    <>
                      {msg.content && (
                        <div className="chat-markdown-body">
                          <XMarkdown content={msg.content} />
                        </div>
                      )}
                      {msg.files?.map((f) => (
                        <div key={f} style={{ marginTop: 4 }}>
                          <FileLink path={f} variant="default" />
                        </div>
                      ))}
                    </>
                  )}
              </div>
            ) : (
              <div>
                <div
                  style={{
                    padding: "10px 14px",
                    borderRadius: 12,
                    background: "#1677ff",
                    color: "#fff",
                    fontSize: 14,
                    lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    border: msg.sendFailed ? "1px solid #ffccc7" : undefined,
                  }}
                >
                  {msg.content}
                </div>
                {msg.files && msg.files.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    {msg.files.map((f) => (
                      <div key={f} style={{ marginTop: 4 }}>
                        <FileLink path={f} variant="default" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {(streamingText || streamingThinking || streamingBlocks.length > 0) && (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-start",
              marginBottom: 12,
            }}
          >
            <div
              style={{
                maxWidth: "75%",
                fontSize: 14,
                lineHeight: 1.6,
              }}
            >
              {streamingBlocks.map((block, i) => {
                if (block.type === "thinking" && block.text) {
                  return <ThinkingBlock key={`sb-${i}`} text={block.text} />;
                }
                if (block.type === "exec") {
                  return <TerminalBlock key={`sb-${i}`} exec={block.exec} />;
                }
                if (block.type === "file") {
                  return (
                    <div key={`sb-${i}`} style={{ marginTop: 4 }}>
                      <FileLink path={block.path} variant="default" />
                    </div>
                  );
                }
                if (block.type === "text" && block.text) {
                  return (
                    <div key={`sb-${i}`} className="chat-markdown-body">
                      <XMarkdown content={block.text} />
                    </div>
                  );
                }
                return null;
              })}
              {streamingThinking && (
                <ThinkingBlock text={streamingThinking} streaming />
              )}
              {streamingText && (
                <div className="chat-markdown-body">
                  <XMarkdown content={streamingText} />
                </div>
              )}
            </div>
          </div>
        )}

        {statusText && (
          <div style={{ textAlign: "center", color: "#999", fontSize: 13, padding: 8 }}>
            <Spin size="small" style={{ marginRight: 8 }} />
            {statusText}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div style={{ padding: "8px 16px 16px" }}>
        <AttachmentBar
          items={attachments}
          onRemove={removeAttachment}
          onAdd={handleSelectFile}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            background: "#f5f5f5",
            borderRadius: 20,
            padding: "6px 8px 6px 6px",
            gap: 4,
            border: "1px solid #e0e0e0",
          }}
        >
          <Button
            icon={<PaperClipOutlined style={{ fontSize: 16 }} />}
            onClick={handleSelectFile}
            type="text"
            shape="circle"
            size="small"
            style={{
              flexShrink: 0,
              color: "#999",
              width: 32,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          />
          <Input.TextArea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("chat.placeholder")}
            autoSize={{ minRows: 1, maxRows: 4 }}
            style={{
              flex: 1,
              border: "none",
              background: "transparent",
              boxShadow: "none",
              resize: "none",
              fontSize: 14,
              padding: "6px 0",
            }}
            disabled={loading}
          />
          <Button
            type="primary"
            shape="circle"
            size="small"
            icon={<SendOutlined rotate={-45} style={{ fontSize: 13 }} />}
            onClick={handleSend}
            disabled={!input.trim() || loading}
            style={{ flexShrink: 0, width: 28, height: 28, minWidth: 28 }}
          />
        </div>
      </div>
    </div>
  );
}
