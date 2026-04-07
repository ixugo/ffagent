import { getSSEUrl } from "./api";

export type SSEEventType = "message" | "thinking" | "status" | "file" | "exec_start" | "exec_done" | "title" | "done";

export interface SSECallbacks {
  onMessage?: (text: string) => void;
  /** 模型推理过程的思考片段，增量推送 */
  onThinking?: (text: string) => void;
  onStatus?: (text: string) => void;
  onFile?: (path: string) => void;
  /** 工具开始执行，前端立即渲染"执行中"的终端块 */
  onExecStart?: (data: { id: string; cmd: string }) => void;
  /** 工具执行完成，前端更新对应终端块的结果 */
  onExecDone?: (data: { id: string; output: string; error: boolean }) => void;
  onTitle?: (title: string) => void;
  onDone?: () => void;
  /** 流式失败时携带具体原因，便于在气泡旁展示 */
  onError?: (error: Error) => void;
  /** 连接结束但未收到 done 事件（未正常收尾） */
  onIncomplete?: () => void;
}

// 使用 Tauri HTTP plugin fetch 来消费 SSE 流，绕过 WebView 网络限制
async function getTauriFetch(): Promise<typeof globalThis.fetch> {
  try {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    return tauriFetch;
  } catch {
    return globalThis.fetch;
  }
}

/** 解析并分发单个 SSE 事件块；返回 true 表示已收到 done 应结束整个流 */
function dispatchEventBlock(
  eventBlock: string,
  callbacks: SSECallbacks,
  state: { sawDone: boolean }
): boolean {
  if (!eventBlock.trim()) {
    return false;
  }

  let eventType = "";
  let rawData = "";

  for (const line of eventBlock.split("\n")) {
    if (line.startsWith("event: ")) {
      eventType = line.slice(7).trim();
    } else if (line.startsWith("data: ")) {
      rawData = line.slice(6);
    }
  }

  let data = "";
  if (rawData) {
    try {
      data = decodeURIComponent(escape(atob(rawData)));
    } catch {
      data = rawData;
    }
  }

  switch (eventType) {
    case "message":
      callbacks.onMessage?.(data);
      break;
    case "thinking":
      callbacks.onThinking?.(data);
      break;
    case "status":
      callbacks.onStatus?.(data);
      break;
    case "file":
      callbacks.onFile?.(data);
      break;
    case "exec_start": {
      try {
        const parsed = JSON.parse(data) as { id: string; cmd: string };
        callbacks.onExecStart?.(parsed);
      } catch { /* ignore */ }
      break;
    }
    case "exec_done": {
      try {
        const parsed = JSON.parse(data) as { id: string; output: string; error: boolean };
        callbacks.onExecDone?.(parsed);
      } catch { /* ignore */ }
      break;
    }
    case "title":
      callbacks.onTitle?.(data);
      break;
    case "done":
      state.sawDone = true;
      callbacks.onDone?.();
      return true;
    default:
      break;
  }
  return false;
}

export function startChatSSE(
  sessionId: string,
  message: string,
  attachments: string[],
  callbacks: SSECallbacks
): () => void {
  let aborted = false;
  const controller = new AbortController();

  (async () => {
    const state = { sawDone: false };
    try {
      const fetchFn = await getTauriFetch();
      const url = getSSEUrl(sessionId, message, attachments);
      const response = await fetchFn(url, {
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        callbacks.onError?.(
          new Error(`SSE 请求失败 HTTP ${response.status} ${response.statusText}`)
        );
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (value) {
          buffer += decoder.decode(value, { stream: !done });
        }

        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const block of parts) {
          if (dispatchEventBlock(block, callbacks, state)) {
            return;
          }
        }

        if (done || aborted) {
          break;
        }
      }

      // 连接关闭时尾部可能缺少最后的 \n\n，补上再解析，避免丢失末尾 message/done
      if (!aborted && buffer.trim() !== "") {
        buffer += "\n\n";
        for (const block of buffer.split("\n\n")) {
          if (dispatchEventBlock(block, callbacks, state)) {
            return;
          }
        }
      }

      if (!aborted && !state.sawDone) {
        callbacks.onIncomplete?.();
      }
    } catch (err) {
      if (!aborted && !state.sawDone) {
        callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }
  })();

  return () => {
    aborted = true;
    controller.abort();
  };
}
