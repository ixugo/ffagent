import { useCallback, useEffect, useRef, useState } from "react";
import Sidebar from "../components/Sidebar";
import ChatWindow, { type ChatMessage, type ContentBlock } from "../components/ChatWindow";
import {
  fetchSessions,
  fetchMessages,
  createSession,
  deleteSession,
  type Message,
  type Session,
} from "../services/api";
import { useLocale } from "../services/i18n";
import { startChatSSE } from "../services/sse";

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

  // 用 Map 管理每个会话的 SSE cancel 函数，允许多个 SSE 同时运行
  const sseMapRef = useRef<Map<string, () => void>>(new Map());
  // 用 ref 跟踪当前活跃 session，供 SSE 回调闭包内判断是否应更新 UI
  const activeIdRef = useRef<string | null>(null);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingSession, setPendingSession] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [statusText, setStatusText] = useState("");
  const [streamingBlocks, setStreamingBlocks] = useState<ContentBlock[]>([]);
  const [streamingThinking, setStreamingThinking] = useState("");
  // 正在进行 SSE 流的会话 ID 集合，驱动侧边栏加载指示器
  const [streamingIds, setStreamingIds] = useState<Set<string>>(new Set());
  // 后台 SSE 完成但用户尚未查看的会话 ID 集合
  const [unreadDoneIds, setUnreadDoneIds] = useState<Set<string>>(new Set());

  // 同步更新 activeIdRef
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  const addStreamingId = useCallback((id: string) => {
    setStreamingIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const removeStreamingId = useCallback((id: string) => {
    setStreamingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

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

  // 组件卸载时取消所有活跃 SSE
  useEffect(() => {
    return () => {
      for (const cancel of sseMapRef.current.values()) {
        cancel();
      }
      sseMapRef.current.clear();
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

      const blocks: ContentBlock[] = [];
      let currentTextBuf = "";
      let currentThinkingBuf = "";

      // 判断此 SSE 所属的 session 当前是否是用户正在查看的
      const isActive = () => activeIdRef.current === sessionId;

      const flushThinking = () => {
        if (currentThinkingBuf) {
          blocks.push({ type: "thinking", text: currentThinkingBuf });
          currentThinkingBuf = "";
          if (isActive()) setStreamingThinking("");
        }
      };

      const flushText = () => {
        if (currentTextBuf) {
          blocks.push({ type: "text", text: currentTextBuf });
          currentTextBuf = "";
          if (isActive()) setStreamingText("");
        }
      };

      const buildFullContent = (): string => {
        return blocks
          .filter((b): b is ContentBlock & { type: "text" } => b.type === "text")
          .map((b) => b.text)
          .join("");
      };

      // 若同一会话已有 SSE 在跑，先取消它
      sseMapRef.current.get(sessionId)?.();
      addStreamingId(sessionId);

      const cancelSSE = startChatSSE(sessionId, message, attachments, {
        onThinking: (text) => {
          currentThinkingBuf += text;
          if (isActive()) setStreamingThinking(currentThinkingBuf);
        },
        onMessage: (text) => {
          flushThinking();
          currentTextBuf += text;
          streamingTextRef.current = currentTextBuf;
          if (isActive()) setStreamingText(currentTextBuf);
        },
        onStatus: (text) => {
          if (isActive()) setStatusText(text);
        },
        onFile: (path) => {
          flushThinking();
          flushText();
          blocks.push({ type: "file", path });
          if (isActive()) setStreamingBlocks([...blocks]);
        },
        onExecStart: ({ id, cmd }) => {
          flushThinking();
          flushText();
          blocks.push({
            type: "exec",
            exec: { id, cmd, output: "", error: false, running: true },
          });
          if (isActive()) setStreamingBlocks([...blocks]);
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
          if (isActive()) setStreamingBlocks([...blocks]);
        },
        // 标题更新始终生效，不受会话切换影响
        onTitle: (title) => {
          setSessions((prev) =>
            prev.map((s) => (s.id === sessionId ? { ...s, title } : s))
          );
        },
        onDone: () => {
          sseMapRef.current.delete(sessionId);
          removeStreamingId(sessionId);
          streamingTextRef.current = "";
          flushThinking();
          flushText();

          if (isActive()) {
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
          }
          if (!isActive()) {
            // 非活跃会话完成：标记为"有未读结果"
            setUnreadDoneIds((prev) => {
              const next = new Set(prev);
              next.add(sessionId);
              return next;
            });
          }
        },
        onError: (err) => {
          sseMapRef.current.delete(sessionId);
          removeStreamingId(sessionId);
          streamingTextRef.current = "";
          flushThinking();
          flushText();

          if (isActive()) {
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
          }
        },
        onIncomplete: () => {
          sseMapRef.current.delete(sessionId);
          removeStreamingId(sessionId);
          streamingTextRef.current = "";
          flushThinking();
          flushText();

          if (isActive()) {
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
            setStatusText("");
            setStreamingBlocks([]);
            setLoading(false);
          }
        },
      });

      sseMapRef.current.set(sessionId, cancelSSE);
    },
    [markUserMessageFailed, addStreamingId, removeStreamingId, t]
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

  // 新建对话：不取消其他会话的 SSE，只清空当前 UI 状态
  const handleNewChat = useCallback(() => {
    setLoading(false);
    setActiveId(null);
    setMessages([]);
    setStreamingText("");
    setStreamingThinking("");
    setStatusText("");
    setStreamingBlocks([]);
    setPendingSession(true);
  }, []);

  // 切换会话：不取消后台 SSE，只切换视图
  const handleSelectSession = useCallback(async (id: string) => {
    // 清空当前会话的 streaming UI
    setStreamingText("");
    setStreamingThinking("");
    setStatusText("");
    setStreamingBlocks([]);

    setActiveId(id);
    setPendingSession(false);
    setMessages([]);

    // 查看此会话时清除未读标记
    setUnreadDoneIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

    // 如果目标会话正在流式传输，标记为 loading 状态
    const isTargetStreaming = sseMapRef.current.has(id);
    setLoading(isTargetStreaming);
    if (isTargetStreaming) {
      setStatusText(t("chat.processing"));
    }

    try {
      const result = await fetchMessages(id);
      const msgs: ChatMessage[] = (result.items || []).map(messageToChatMessage);
      setMessages(msgs);
    } catch (e) {
      console.error("Failed to load messages:", e);
    }
  }, [t]);

  // 删除会话：只取消被删除会话的 SSE
  const handleDeleteSession = useCallback(
    async (id: string) => {
      try {
        await deleteSession(id);
        // 取消该会话的 SSE（如果有）并清除未读标记
        const cancel = sseMapRef.current.get(id);
        if (cancel) {
          cancel();
          sseMapRef.current.delete(id);
          removeStreamingId(id);
        }
        setUnreadDoneIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        setSessions((prev) => prev.filter((s) => s.id !== id));
        if (activeId === id) {
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
    [activeId, removeStreamingId]
  );

  return (
    <div style={{ display: "flex", width: "100%", height: "100%", overflow: "hidden" }}>
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        streamingIds={streamingIds}
        unreadDoneIds={unreadDoneIds}
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
