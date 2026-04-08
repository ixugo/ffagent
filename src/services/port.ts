import { invoke } from "@tauri-apps/api/core";
import { setAgentPort } from "./api";

/**
 * 通过 Tauri invoke 获取 Go Agent 实际监听端口，注入到 API 层
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
}
