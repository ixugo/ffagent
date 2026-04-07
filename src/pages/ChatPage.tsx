import { useCallback, useEffect, useRef, useState } from "react";
import Sidebar from "../components/Sidebar";
import ChatWindow, { type ChatMessage, type ContentBlock } from "../components/ChatWindow";
import {
  fetchSessions,
  createSession,
  deleteSession,
  type Message,
  type Session,
} from "../services/api";
import { useLocale } from "../services/i18n";
import { startChatSSE } from "../services/sse";

/** 将库里的 attachments JSON 解析为路径列表，供历史消息还原展示 */
function parseAttachmentPaths(raw: string): string[] {
  if (!raw || raw === "null") return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (Array.isArray(v)) {
      return v.filter((x): x is string => typeof x === "string");
    }
  } catch {
    /* 旧数据或非 JSON */
  }
  return [];
}

function messageToChatMessage(m: Message): ChatMessage {
  const paths = parseAttachmentPaths(m.attachments);
  const role = m.role as "user" | "assistant";
  return {
    id: m.id,
    role,
    content: m.content,
    files: paths.length > 0 ? paths : undefined,
  };
}

/** 生成列表项稳定且不易碰撞的 id，减轻 StrictMode / 快速连点导致 key 重复与气泡异常 */
function newMsgId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

interface ChatPageProps {
  onOpenSettings: () => void;
}

export default function ChatPage({ onOpenSettings }: ChatPageProps) {
  const { t } = useLocale();
  const streamingTextRef = useRef("");
  const sseCancelRef = useRef<(() => void) | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingSession, setPendingSession] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [statusText, setStatusText] = useState("");
  const [streamingBlocks, setStreamingBlocks] = useState<ContentBlock[]>([]);
  const [streamingThinking, setStreamingThinking] = useState("");

  const loadSessions = useCallback(async () => {
    try {
      const result = await fetchSessions();
      setSessions(result.items || []);
    } catch (e) {
      console.error("Failed to load sessions:", e);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    return () => {
      sseCancelRef.current?.();
      sseCancelRef.current = null;
    };
  }, []);

  const markUserMessageFailed = useCallback((userMsgId: string, err: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === userMsgId ? { ...m, sendFailed: true, sendError: err } : m
      )
    );
  }, []);

  const runAssistantStream = useCallback(
    (
      userMsgId: string,
      sessionId: string,
      message: string,
      attachments: string[]
    ) => {
      setLoading(true);
      setStreamingText("");
      streamingTextRef.current = "";
      setStatusText(t("chat.processing"));
      setStreamingBlocks([]);
      setStreamingThinking("");

      // 有序内容块序列：text/exec/file/thinking 按 SSE 事件到达顺序排列
      const blocks: ContentBlock[] = [];
      let currentTextBuf = "";
      let currentThinkingBuf = "";

      // 将当前累积的思考内容刷入 blocks
      const flushThinking = () => {
        if (currentThinkingBuf) {
          blocks.push({ type: "thinking", text: currentThinkingBuf });
          currentThinkingBuf = "";
          setStreamingThinking("");
        }
      };

      // 将当前累积的文本刷入 blocks，确保终端/文件块插在正确位置
      const flushText = () => {
        if (currentTextBuf) {
          blocks.push({ type: "text", text: currentTextBuf });
          currentTextBuf = "";
          setStreamingText("");
        }
      };

      // 从 blocks 构建完整的纯文本（用于持久化 content 字段）
      const buildFullContent = (): string => {
        return blocks
          .filter((b): b is ContentBlock & { type: "text" } => b.type === "text")
          .map((b) => b.text)
          .join("");
      };

      sseCancelRef.current?.();
      const cancelSSE = startChatSSE(sessionId, message, attachments, {
        onThinking: (text) => {
          currentThinkingBuf += text;
          setStreamingThinking(currentThinkingBuf);
        },
        onMessage: (text) => {
          flushThinking();
          currentTextBuf += text;
          streamingTextRef.current = currentTextBuf;
          setStreamingText(currentTextBuf);
        },
        onStatus: (text) => {
          setStatusText(text);
        },
        onFile: (path) => {
          flushThinking();
          flushText();
          blocks.push({ type: "file", path });
          setStreamingBlocks([...blocks]);
        },
        onExecStart: ({ id, cmd }) => {
          flushThinking();
          flushText();
          blocks.push({
            type: "exec",
            exec: { id, cmd, output: "", error: false, running: true },
          });
          setStreamingBlocks([...blocks]);
        },
        onExecDone: ({ id, output, error }) => {
          const idx = blocks.findIndex(
            (b) => b.type === "exec" && b.exec.id === id
          );
          if (idx >= 0) {
            const block = blocks[idx] as ContentBlock & { type: "exec" };
            blocks[idx] = {
              type: "exec",
              exec: { ...block.exec, output, error, running: false },
            };
          }
          setStreamingBlocks([...blocks]);
        },
        onTitle: (title) => {
          setSessions((prev) =>
            prev.map((s) => (s.id === sessionId ? { ...s, title } : s))
          );
        },
        onDone: () => {
          sseCancelRef.current = null;
          streamingTextRef.current = "";
          flushThinking();
          flushText();
          if (blocks.length > 0) {
            const assistantMsg: ChatMessage = {
              id: newMsgId("assistant"),
              role: "assistant",
              content: buildFullContent(),
              blocks: [...blocks],
            };
            setMessages((prev) => [...prev, assistantMsg]);
          }
          setStreamingText("");
          setStreamingThinking("");
          setStatusText("");
          setStreamingBlocks([]);
          setLoading(false);
        },
        onError: (err) => {
          sseCancelRef.current = null;
          streamingTextRef.current = "";
          flushThinking();
          flushText();

          if (blocks.length > 0) {
            setMessages((prev) => [
              ...prev,
              {
                id: newMsgId("assistant"),
                role: "assistant",
                content: buildFullContent(),
                blocks: [...blocks],
              },
            ]);
          }

          markUserMessageFailed(userMsgId, err.message);
          setLoading(false);
          setStreamingText("");
          setStreamingThinking("");
          setStatusText("");
          setStreamingBlocks([]);
        },
        onIncomplete: () => {
          sseCancelRef.current = null;
          setLoading(false);
          setStatusText("");
          streamingTextRef.current = "";
          flushThinking();
          flushText();
          const note = t("chat.streamIncomplete");
          blocks.push({ type: "text", text: `\n\n——\n${note}` });
          setMessages((prev) => [
            ...prev,
            {
              id: newMsgId("assistant"),
              role: "assistant",
              content: buildFullContent(),
              blocks: [...blocks],
            },
          ]);
          setStreamingText("");
          setStreamingThinking("");
          setStreamingBlocks([]);
        },
      });
      sseCancelRef.current = cancelSSE;
    },
    [markUserMessageFailed, t]
  );

  const handleSend = useCallback(
    async (message: string, attachments: string[]) => {
      const userMsgId = newMsgId("user");
      const userMsg: ChatMessage = {
        id: userMsgId,
        role: "user",
        content: message,
        files: attachments.length > 0 ? [...attachments] : undefined,
        requestPayload: { text: message, attachments: [...attachments] },
        sendFailed: false,
      };
      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);
      setStatusText(t("chat.processing"));

      let sessionId = activeId;
      if (pendingSession || !sessionId) {
        try {
          const session = await createSession();
          sessionId = session.id;
          setActiveId(sessionId);
          setPendingSession(false);
          setSessions((prev) => [session, ...prev]);
        } catch (e) {
          const err = e instanceof Error ? e.message : String(e);
          setLoading(false);
          setStatusText("");
          markUserMessageFailed(userMsgId, err);
          return;
        }
      }

      runAssistantStream(userMsgId, sessionId, message, attachments);
    },
    [activeId, pendingSession, markUserMessageFailed, runAssistantStream, t]
  );

  const handleRetrySend = useCallback(
    (failedMessageId: string) => {
      const m = messages.find((x) => x.id === failedMessageId);
      if (!m?.requestPayload) return;

      const newUserId = newMsgId("user");
      const dup: ChatMessage = {
        id: newUserId,
        role: "user",
        content: m.content,
        files: m.files ? [...m.files] : undefined,
        requestPayload: {
          text: m.requestPayload.text,
          attachments: [...m.requestPayload.attachments],
        },
        sendFailed: false,
      };
      setMessages((prev) => [...prev, dup]);
      setLoading(true);
      setStatusText(t("chat.processing"));

      void (async () => {
        let sessionId = activeId;
        const { text, attachments } = dup.requestPayload!;

        if (pendingSession || !sessionId) {
          try {
            const session = await createSession();
            sessionId = session.id;
            setActiveId(sessionId);
            setPendingSession(false);
            setSessions((prev) => [session, ...prev]);
          } catch (e) {
            const err = e instanceof Error ? e.message : String(e);
            setLoading(false);
            setStatusText("");
            markUserMessageFailed(newUserId, err);
            return;
          }
        }

        runAssistantStream(newUserId, sessionId, text, attachments);
      })();
    },
    [
      messages,
      activeId,
      pendingSession,
      markUserMessageFailed,
      runAssistantStream,
      t,
    ]
  );

  const handleNewChat = useCallback(() => {
    sseCancelRef.current?.();
    sseCancelRef.current = null;
    setLoading(false);
    setActiveId(null);
    setMessages([]);
    setStreamingText("");
    setStreamingThinking("");
    setStatusText("");
    setStreamingBlocks([]);
    setPendingSession(true);
  }, []);

  const handleSelectSession = useCallback(async (id: string) => {
    sseCancelRef.current?.();
    sseCancelRef.current = null;
    setLoading(false);
    setActiveId(id);
    setPendingSession(false);
    setStreamingText("");
    setStreamingThinking("");
    setStatusText("");
    setStreamingBlocks([]);
    setMessages([]);

    try {
      const { fetchMessages } = await import("../services/api");
      const result = await fetchMessages(id);
      const msgs: ChatMessage[] = (result.items || []).map(messageToChatMessage);
      setMessages(msgs);
    } catch (e) {
      console.error("Failed to load messages:", e);
    }
  }, []);

  const handleDeleteSession = useCallback(
    async (id: string) => {
      try {
        await deleteSession(id);
        setSessions((prev) => prev.filter((s) => s.id !== id));
        if (activeId === id) {
          sseCancelRef.current?.();
          sseCancelRef.current = null;
          setActiveId(null);
          setMessages([]);
          setStreamingText("");
          setStreamingThinking("");
          setStatusText("");
          setStreamingBlocks([]);
          setPendingSession(true);
          setLoading(false);
        }
      } catch (e) {
        console.error("Failed to delete session:", e);
      }
    },
    [activeId]
  );

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        onSelect={handleSelectSession}
        onNew={handleNewChat}
        onDelete={handleDeleteSession}
        onOpenSettings={onOpenSettings}
      />
      <ChatWindow
        messages={messages}
        loading={loading}
        streamingText={streamingText}
        streamingThinking={streamingThinking}
        streamingBlocks={streamingBlocks}
        statusText={statusText}
        onSend={handleSend}
        onRetrySend={handleRetrySend}
      />
    </div>
  );
}
