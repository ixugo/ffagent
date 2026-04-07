const DEFAULT_PORT = 15123;

let agentPort = DEFAULT_PORT;

export function setAgentPort(port: number) {
  agentPort = port;
}

function baseURL(): string {
  return `http://127.0.0.1:${agentPort}`;
}

// 使用 Tauri HTTP 插件绕过 WebView 网络限制
async function getTauriFetch(): Promise<typeof globalThis.fetch> {
  try {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    return tauriFetch;
  } catch {
    return globalThis.fetch;
  }
}

let cachedFetch: typeof globalThis.fetch | null = null;

async function getFetch(): Promise<typeof globalThis.fetch> {
  if (!cachedFetch) {
    cachedFetch = await getTauriFetch();
  }
  return cachedFetch;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const fetchFn = await getFetch();
  const resp = await fetchFn(`${baseURL()}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(
      `HTTP ${resp.status}: ${text.slice(0, 400) || resp.statusText}`
    );
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

export interface Config {
  id: string;
  value: string;
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

export async function getConfig(id: string): Promise<Config> {
  return request<Config>(`/api/configs/${id}`);
}

export async function saveConfig(id: string, value: object): Promise<Config> {
  const existing = await getConfig(id).catch(() => null);
  if (existing) {
    return request<Config>(`/api/configs/${id}`, {
      method: "PUT",
      body: JSON.stringify({ value: JSON.stringify(value) }),
    });
  }
  return request<Config>("/api/configs", {
    method: "POST",
    body: JSON.stringify({ id, value: JSON.stringify(value) }),
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
