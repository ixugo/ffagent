import {
  DeleteOutlined,
  GithubOutlined,
  PlusOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { Button, Popconfirm, Typography } from "antd";
import type { Session } from "../services/api";
import { useLocale } from "../services/i18n";

interface SidebarProps {
  sessions: Session[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onOpenSettings: () => void;
}

const GITHUB_URL = "https://github.com/ixugo/ffagent/";

async function openGithubRepo() {
  try {
    await window.electronAPI?.openExternal(GITHUB_URL);
  } catch {
    window.open(GITHUB_URL, "_blank", "noopener,noreferrer");
  }
}

export default function Sidebar({ sessions, activeId, onSelect, onNew, onDelete, onOpenSettings }: SidebarProps) {
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
      {/* macOS 标题栏拖拽区域 + 新建对话按钮 */}
      <div
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
                  className="sidebar-delete-btn"
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
