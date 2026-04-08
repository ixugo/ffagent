import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { setAgentPort } from "./api";

/**
 * 通过 Tauri invoke 获取 Go Agent 实际监听端口，注入到 API 层；
 * 同时监听 agent-port-ready 事件，在端口变更时实时更新
 */
export async function initAgentPort(): Promise<void> {
  try {
    const port = await invoke<number>("get_agent_port");
    if (typeof port === "number" && port > 0) {
      setAgentPort(port);
    }
  } catch {
    setAgentPort(15123);
  }

  listen<number>("agent-port-ready", (event) => {
    const port = event.payload;
    if (typeof port === "number" && port > 0) {
      setAgentPort(port);
    }
  });
}
