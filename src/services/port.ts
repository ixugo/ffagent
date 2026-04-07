import { setAgentPort } from "./api";

declare global {
  interface Window {
    __AGENT_PORT__?: number;
  }
}

/**
 * 与 Rust 侧同步 Agent 端口：优先 invoke（避免 setup 阶段主窗口未就绪导致 __AGENT_PORT__ 未注入）
 */
export async function initAgentPort(): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const port = await invoke<number>("get_agent_port");
    if (typeof port === "number" && port > 0) {
      setAgentPort(port);
    }
  } catch {
    const w = window.__AGENT_PORT__;
    if (typeof w === "number" && w > 0) {
      setAgentPort(w);
    } else {
      setAgentPort(15123);
    }
  }

  try {
    const { listen } = await import("@tauri-apps/api/event");
    await listen<number>("agent-port", (event) => {
      setAgentPort(event.payload);
    });
  } catch {
    // 非 Tauri 环境下忽略
  }
}
