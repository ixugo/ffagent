import { CloseOutlined, PaperClipOutlined, PlusOutlined } from "@ant-design/icons";
import { Tag } from "antd";
import { useLocale } from "../services/i18n";

/** 附件项使用稳定 id，避免用数组下标作 React key 导致删除错乱 */
export interface AttachmentItem {
  id: string;
  path: string;
}

interface AttachmentBarProps {
  items: AttachmentItem[];
  onRemove: (id: string) => void;
  onAdd: () => void;
}

export default function AttachmentBar({ items, onRemove, onAdd }: AttachmentBarProps) {
  const { t } = useLocale();

  if (items.length === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        padding: "6px 12px",
        borderTop: "1px solid #f0f0f0",
        background: "#fafafa",
        alignItems: "center",
      }}
    >
      {items.map((item) => {
        const name =
          item.path.split(/[/\\]/).pop() || item.path;
        return (
          <Tag
            key={item.id}
            closable
            onClose={() => onRemove(item.id)}
            closeIcon={<CloseOutlined />}
            style={{
              display: "inline-flex",
              alignItems: "center",
              maxWidth: 280,
              margin: 0,
            }}
          >
            <PaperClipOutlined style={{ marginRight: 4, flexShrink: 0 }} />
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
                flex: 1,
              }}
              title={item.path}
            >
              {name}
            </span>
          </Tag>
        );
      })}
      <Tag
        onClick={onAdd}
        style={{ cursor: "pointer", borderStyle: "dashed", flexShrink: 0 }}
      >
        <PlusOutlined /> {t("chat.attachBarAdd")}
      </Tag>
    </div>
  );
}
