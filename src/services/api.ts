const DEFAULT_PORT = 15123;

let agentPort = DEFAULT_PORT;

export function setAgentPort(port: number) {
  agentPort = port;
}

function baseURL(): string {
  return `http://127.0.0.1:${agentPort}`;
}

/** 从 goddd Fail JSON 中提取 msg + details，便于界面展示真实原因 */
function formatApiErrorBody(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  try {
    const j = JSON.parse(trimmed) as {
      msg?: string;
      details?: unknown;
      reason?: string;
    };
    const parts: string[] = [];
    if (typeof j.msg === "string" && j.msg.trim()) parts.push(j.msg.trim());
    if (Array.isArray(j.details) && j.details.length > 0) {
      parts.push(j.details.map(String).join("; "));
    }
    if (parts.length === 0 && typeof j.reason === "string" && j.reason.trim()) {
      parts.push(j.reason.trim());
    }
    if (parts.length > 0) return parts.join(" — ");
  } catch {
    /* 非 JSON */
  }
  return trimmed.length > 600 ? `${trimmed.slice(0, 600)}…` : trimmed;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(`${baseURL()}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  const text = await resp.text();
  if (!resp.ok) {
    const detail = formatApiErrorBody(text) || resp.statusText || String(resp.status);
    throw new Error(`HTTP ${resp.status}: ${detail}`);
  }
  if (!text.trim()) {
    return {} as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`响应不是合法 JSON: ${text.slice(0, 200)}`);
  }
}

export interface Session {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  session_id: string;
  role: string;
  content: string;
  attachments: string;
  created_at: string;
}

export interface PageResult<T> {
  items: T[];
  total: number;
}

export interface Metadata {
  id: string;
  ext: string;
  created_at: string;
  updated_at: string;
}

export async function fetchSessions(): Promise<PageResult<Session>> {
  return request<PageResult<Session>>("/api/sessions?size=100&sort=-created_at");
}

export async function createSession(title?: string): Promise<Session> {
  return request<Session>("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ title: title || "" }),
  });
}

export async function deleteSession(id: string): Promise<void> {
  await request(`/api/sessions/${id}`, { method: "DELETE" });
}

export async function fetchMessages(sessionId: string): Promise<PageResult<Message>> {
  return request<PageResult<Message>>(
    `/api/messages?session_id=${encodeURIComponent(sessionId)}&size=200&sort=created_at`
  );
}

export async function getMetadata(id: string): Promise<Metadata> {
  return request<Metadata>(`/api/metadatas/${encodeURIComponent(id)}`);
}

/** 幂等保存：服务端不存在则创建，已存在则更新 ext 字段 */
export async function saveMetadata(id: string, value: object): Promise<Metadata> {
  return request<Metadata>(`/api/metadatas/${encodeURIComponent(id)}`, {
    method: "POST",
    body: JSON.stringify({ ext: JSON.stringify(value) }),
  });
}

export interface AppInfo {
  config_dir: string;
  log_dir: string;
  cache_root: string;
}

export async function fetchAppInfo(): Promise<AppInfo> {
  return request<AppInfo>("/api/app/info");
}

export interface CacheStats {
  path: string;
  bytes: number;
}

export async function fetchCacheStats(): Promise<CacheStats> {
  return request<CacheStats>("/api/cache/stats");
}

export async function clearAgentCache(): Promise<void> {
  await request<{ ok: boolean }>("/api/cache/clear", { method: "POST" });
}

export function getSSEUrl(sessionId: string, message: string, attachments: string[]): string {
  const params = new URLSearchParams({
    session_id: sessionId,
    message,
    attachments: JSON.stringify(attachments),
  });
  return `${baseURL()}/api/chat/sse?${params.toString()}`;
}
