import { FolderOpenOutlined } from "@ant-design/icons";
import { Button, message } from "antd";
import { useLocale } from "../services/i18n";

interface FileLinkProps {
  path: string;
  /** 用户蓝色气泡内：浅色底与反色文字，与助手侧灰底卡片区分 */
  variant?: "default" | "inUserBubble";
}

/**
 * 在访达/资源管理器中显示并选中该文件；Tauri 下用 revealItemInDir，失败时再尝试打开父目录
 */
export default function FileLink({ path, variant = "default" }: FileLinkProps) {
  const { t } = useLocale();
  const trimmed = path.trim();
  const inUser = variant === "inUserBubble";

  const handleClick = async () => {
    if (!trimmed) return;

    try {
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      await revealItemInDir(trimmed);
    } catch (e) {
      console.error("Failed to reveal in folder:", e);
      try {
        const { openPath } = await import("@tauri-apps/plugin-opener");
        const last = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
        const dir = last > 0 ? trimmed.slice(0, last) : trimmed;
        await openPath(dir || trimmed);
      } catch (e2) {
        console.error("Fallback openPath failed:", e2);
        message.error(t("file.openFolderFailed"));
      }
    }
  };

  const fileName = trimmed.split(/[/\\]/).pop() || path;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        background: inUser ? "rgba(255,255,255,0.22)" : "#f6f6f6",
        borderRadius: 8,
        margin: "4px 0",
        cursor: "pointer",
        border: inUser ? "1px solid rgba(255,255,255,0.35)" : undefined,
      }}
      onClick={handleClick}
    >
      <FolderOpenOutlined
        style={{ fontSize: 18, color: inUser ? "#fff" : "#1677ff", flexShrink: 0 }}
      />
      <div style={{ flex: 1, overflow: "hidden", minWidth: 0 }}>
        <div
          style={{
            fontWeight: 500,
            fontSize: 14,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: inUser ? "#fff" : undefined,
          }}
        >
          {fileName}
        </div>
        <div
          style={{
            fontSize: 12,
            color: inUser ? "rgba(255,255,255,0.8)" : "#999",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {path}
        </div>
      </div>
      <Button
        type="link"
        size="small"
        style={{
          color: inUser ? "#fff" : undefined,
          flexShrink: 0,
          padding: "0 4px",
        }}
      >
        {t("file.openFolder")}
      </Button>
    </div>
  );
}
