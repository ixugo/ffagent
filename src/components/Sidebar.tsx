import { useEffect, useRef } from "react";
import {
  DeleteOutlined,
  GithubOutlined,
  LoadingOutlined,
  PlusOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { Button, Popconfirm, Typography } from "antd";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Session } from "../services/api";
import { useLocale } from "../services/i18n";

interface SidebarProps {
  sessions: Session[];
  activeId: string | null;
  streamingIds: Set<string>;
  unreadDoneIds: Set<string>;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onOpenSettings: () => void;
}

const GITHUB_URL = "https://github.com/ixugo/ffagent/";

async function openGithubRepo() {
  try {
    await openUrl(GITHUB_URL);
  } catch {
    window.open(GITHUB_URL, "_blank", "noopener,noreferrer");
  }
}

// --- 全局同步旋转控制器：一个 RAF 驱动所有 spinner ---

const SPIN_DURATION_MS = 1500;
const spinnerElements = new Set<HTMLSpanElement>();
let globalRafId: number | null = null;

function spinTick() {
  const angle = ((performance.now() % SPIN_DURATION_MS) / SPIN_DURATION_MS) * 360;
  for (const el of spinnerElements) {
    el.style.transform = `rotate(${angle}deg)`;
  }
  globalRafId = requestAnimationFrame(spinTick);
}

function registerSpinner(el: HTMLSpanElement) {
  spinnerElements.add(el);
  if (globalRafId === null) {
    globalRafId = requestAnimationFrame(spinTick);
  }
}

function unregisterSpinner(el: HTMLSpanElement) {
  spinnerElements.delete(el);
  if (spinnerElements.size === 0 && globalRafId !== null) {
    cancelAnimationFrame(globalRafId);
    globalRafId = null;
  }
}

// 全局同步旋转的 spinner 组件：所有实例共享同一 RAF 循环
function SyncSpinner() {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    registerSpinner(el);
    return () => unregisterSpinner(el);
  }, []);

  return (
    <span ref={ref} style={{ display: "inline-flex" }}>
      <LoadingOutlined style={{ color: "#1890ff", fontSize: 14 }} />
    </span>
  );
}

// --- Sidebar 组件 ---

export default function Sidebar({
  sessions,
  activeId,
  streamingIds,
  unreadDoneIds,
  onSelect,
  onNew,
  onDelete,
  onOpenSettings,
}: SidebarProps) {
  const { t } = useLocale();

  return (
    <div
      style={{
        width: 200,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#f5f5f5",
      }}
    >
      {/* 标题栏拖拽区域 + 新建对话按钮 */}
      <div
        data-tauri-drag-region
        className="app-drag-region"
        style={{
          height: 48,
          flexShrink: 0,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "flex-end",
          padding: "0 12px 6px",
        }}
      >
        <Button
          type="text"
          size="small"
          icon={<PlusOutlined />}
          onClick={onNew}
          style={{ fontSize: 13, color: "#666" }}
        >
          {t("sidebar.newChat")}
        </Button>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "8px 8px 0" }}>
        {sessions.length === 0 ? (
          <Typography.Text
            type="secondary"
            style={{ display: "block", textAlign: "center", padding: 24 }}
          >
            {t("sidebar.noSessions")}
          </Typography.Text>
        ) : (
          sessions.map((session) => {
            const isActive = session.id === activeId;
            const isStreaming = streamingIds.has(session.id);
            const hasUnreadDone = unreadDoneIds.has(session.id);
            const bgColor = isActive ? "#e6f4ff" : "#f5f5f5";
            return (
              <div
                key={session.id}
                className="sidebar-session-item"
                onClick={() => onSelect(session.id)}
                style={{
                  position: "relative",
                  cursor: "pointer",
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: bgColor,
                  marginBottom: 2,
                  overflow: "hidden",
                }}
              >
                <span
                  style={{
                    fontSize: 14,
                    display: "block",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                  }}
                >
                  {session.title || t("sidebar.newChat")}
                </span>
                <div
                  className="sidebar-action-area"
                  style={{
                    position: "absolute",
                    right: 0,
                    top: 0,
                    bottom: 0,
                    display: "flex",
                    alignItems: "center",
                    paddingRight: 8,
                    paddingLeft: 20,
                    background: `linear-gradient(to right, transparent, ${bgColor} 40%)`,
                  }}
                >
                  {isStreaming && (
                    <span className="sidebar-loading-indicator">
                      <SyncSpinner />
                    </span>
                  )}
                  {/* 后台任务完成但未查看：显示小黑点 */}
                  {hasUnreadDone && !isStreaming && (
                    <span className="sidebar-unread-dot" />
                  )}
                  <span className="sidebar-delete-btn">
                    <Popconfirm
                      title={t("sidebar.confirmDeleteTitle")}
                      description={t("sidebar.confirmDeleteDesc")}
                      okText={t("sidebar.confirmDeleteOk")}
                      cancelText={t("sidebar.confirmDeleteCancel")}
                      okButtonProps={{ danger: true }}
                      onConfirm={(e) => {
                        e?.stopPropagation();
                        onDelete(session.id);
                      }}
                    >
                      <DeleteOutlined
                        onClick={(e) => e.stopPropagation()}
                        style={{ color: "#999", fontSize: 14 }}
                      />
                    </Popconfirm>
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div
        style={{
          padding: "10px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <Button
          type="text"
          size="small"
          icon={<SettingOutlined style={{ fontSize: 16 }} />}
          aria-label={t("sidebar.settings")}
          onClick={onOpenSettings}
          style={{ color: "#666", fontSize: 13 }}
        >
          {t("sidebar.settings")}
        </Button>
        <Button
          type="text"
          size="small"
          icon={<GithubOutlined style={{ fontSize: 18 }} />}
          aria-label="GitHub"
          onClick={() => void openGithubRepo()}
          style={{ color: "#666" }}
        />
      </div>
    </div>
  );
}
