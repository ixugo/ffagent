import { useEffect, useState } from "react";
import {
  Form,
  Input,
  Button,
  Select,
  message,
  Typography,
  Popconfirm,
  Menu,
} from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import {
  clearAgentCache,
  fetchAppInfo,
  fetchCacheStats,
  getConfig,
  saveConfig,
} from "../services/api";
import { useLocale } from "../services/i18n";

interface OpenAIConfig {
  base_url: string;
  api_key: string;
  model: string;
}

interface AppConfig {
  language: string;
}

interface SettingsPageProps {
  onBack: () => void;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

type SettingsSection = "general" | "model";

export default function SettingsPage({ onBack }: SettingsPageProps) {
  const { t, locale, setLocale } = useLocale();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [cacheBytes, setCacheBytes] = useState<number | null>(null);
  const [cachePath, setCachePath] = useState("");
  const [cacheLoading, setCacheLoading] = useState(false);
  const [cacheClearing, setCacheClearing] = useState(false);
  const [logDir, setLogDir] = useState("");
  const [configDir, setConfigDir] = useState("");
  const [activeSection, setActiveSection] =
    useState<SettingsSection>("general");

  useEffect(() => {
    loadConfigs();
    loadCacheStats();
    void (async () => {
      try {
        const info = await fetchAppInfo();
        setLogDir(info.log_dir || "");
        setConfigDir(info.config_dir || "");
      } catch {
        setLogDir("");
        setConfigDir("");
      }
    })();
  }, []);

  const loadCacheStats = async () => {
    setCacheLoading(true);
    try {
      const s = await fetchCacheStats();
      setCacheBytes(s.bytes);
      setCachePath(s.path || "");
    } catch (e) {
      console.error("fetchCacheStats:", e);
      setCacheBytes(null);
      setCachePath("");
      message.warning(t("settings.cacheLoadFailed"));
    } finally {
      setCacheLoading(false);
    }
  };

  const loadConfigs = async () => {
    try {
      const openaiCfg = await getConfig("openai");
      if (openaiCfg?.value) {
        const parsed: OpenAIConfig = JSON.parse(openaiCfg.value);
        form.setFieldsValue({
          base_url: parsed.base_url,
          api_key: parsed.api_key,
          model: parsed.model,
        });
      }
    } catch {
      form.setFieldsValue({
        base_url: "http://127.0.0.1:1234/v1",
        api_key: "",
        model: "",
      });
    }

    try {
      const appCfg = await getConfig("app");
      if (appCfg?.value) {
        const parsed: AppConfig = JSON.parse(appCfg.value);
        form.setFieldsValue({ language: parsed.language });
      }
    } catch {
      form.setFieldsValue({ language: locale });
    }
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);

      await saveConfig("openai", {
        base_url: values.base_url,
        api_key: values.api_key,
        model: values.model,
      });

      await saveConfig("app", {
        language: values.language,
      });

      if (values.language !== locale) {
        setLocale(values.language);
      }

      message.success(t("settings.saved"));
    } catch (e) {
      console.error("Save settings error:", e);
    } finally {
      setSaving(false);
    }
  };

  const handleClearCache = async () => {
    setCacheClearing(true);
    try {
      await clearAgentCache();
      message.success(t("settings.cacheCleared"));
      await loadCacheStats();
    } catch (e) {
      console.error("Clear cache error:", e);
    } finally {
      setCacheClearing(false);
    }
  };

  const menuItems = [
    { key: "general" as const, label: t("settings.menuGeneral") },
    { key: "model" as const, label: t("settings.menuModel") },
  ];

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      {/* 左侧菜单栏 */}
      <div
        style={{
          width: 200,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#f5f5f5",
          flexShrink: 0,
        }}
      >
        {/* macOS 标题栏拖拽区域（留空给红绿灯按钮） */}
        <div
          className="app-drag-region"
          style={{ height: 48, flexShrink: 0 }}
        />

        {/* 返回按钮放在红绿灯下方，避免遮挡 */}
        <div style={{ padding: "2px 12px 8px" }}>
          <Button
            type="text"
            size="small"
            icon={<ArrowLeftOutlined />}
            onClick={onBack}
            style={{ fontSize: 13, color: "#666" }}
          >
            {t("settings.back")}
          </Button>
        </div>

        <Menu
          mode="inline"
          selectedKeys={[activeSection]}
          onClick={({ key }) => setActiveSection(key as SettingsSection)}
          items={menuItems}
          style={{
            background: "transparent",
            border: "none",
            flex: 1,
          }}
        />
      </div>

      {/* 右侧内容区域 */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          height: "100%",
          background: "#fff",
        }}
      >
        {/* macOS 标题栏拖拽区域 */}
        <div
          className="app-drag-region"
          style={{ height: 48, flexShrink: 0 }}
        />

        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "0 32px 32px",
            maxWidth: 560,
          }}
        >
          {/* ── 基本设置 ── */}
          {activeSection === "general" && (
            <>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 24,
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                <Typography.Title level={4} style={{ margin: 0 }}>
                  {t("settings.menuGeneral")}
                </Typography.Title>
                <Button type="primary" onClick={handleSave} loading={saving}>
                  {t("settings.save")}
                </Button>
              </div>

              <Form form={form} layout="vertical">
                <Form.Item name="language" label={t("settings.language")}>
                  <Select>
                    <Select.Option value="zh-CN">{t("lang.zh")}</Select.Option>
                    <Select.Option value="en-US">{t("lang.en")}</Select.Option>
                  </Select>
                </Form.Item>
              </Form>

              <Typography.Title level={5} style={{ marginTop: 32 }}>
                {t("settings.dirsTitle")}
              </Typography.Title>
              {logDir ? (
                <Typography.Paragraph
                  type="secondary"
                  style={{ wordBreak: "break-all", marginBottom: 8 }}
                >
                  {t("settings.logDir")}: {logDir}
                </Typography.Paragraph>
              ) : null}
              {configDir ? (
                <Typography.Paragraph
                  type="secondary"
                  style={{ wordBreak: "break-all", marginBottom: 16 }}
                >
                  {t("settings.configDir")}: {configDir}
                </Typography.Paragraph>
              ) : null}

              <Typography.Title level={5} style={{ marginTop: 8 }}>
                {t("settings.cacheTitle")}
              </Typography.Title>
              <Typography.Paragraph
                type="secondary"
                style={{ marginBottom: 8 }}
              >
                {t("settings.cacheSize")}:{" "}
                {cacheBytes === null ? "—" : formatBytes(cacheBytes)}
              </Typography.Paragraph>
              {cachePath ? (
                <Typography.Paragraph
                  type="secondary"
                  style={{ wordBreak: "break-all", marginBottom: 16 }}
                >
                  {t("settings.cachePath")}: {cachePath}
                </Typography.Paragraph>
              ) : null}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <Button
                  onClick={() => void loadCacheStats()}
                  loading={cacheLoading}
                >
                  {t("settings.cacheRefresh")}
                </Button>
                <Popconfirm
                  title={t("settings.cacheClearConfirm")}
                  onConfirm={handleClearCache}
                  okText={t("sidebar.confirmDeleteOk")}
                  cancelText={t("sidebar.confirmDeleteCancel")}
                  disabled={!cachePath}
                >
                  <Button
                    danger
                    loading={cacheClearing}
                    disabled={cacheLoading || !cachePath}
                  >
                    {t("settings.cacheClear")}
                  </Button>
                </Popconfirm>
              </div>
            </>
          )}

          {/* ── 模型设置 ── */}
          {activeSection === "model" && (
            <>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 24,
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                <Typography.Title level={4} style={{ margin: 0 }}>
                  {t("settings.menuModel")}
                </Typography.Title>
                <Button type="primary" onClick={handleSave} loading={saving}>
                  {t("settings.save")}
                </Button>
              </div>

              <Form form={form} layout="vertical">
                <Form.Item
                  name="base_url"
                  label={t("settings.apiUrl")}
                  rules={[{ required: true }]}
                >
                  <Input placeholder="http://127.0.0.1:1234/v1" />
                </Form.Item>

                <Form.Item name="api_key" label={t("settings.apiKey")}>
                  <Input.Password placeholder="sk-..." />
                </Form.Item>

                <Form.Item
                  name="model"
                  label={t("settings.model")}
                  rules={[{ required: true }]}
                >
                  <Input placeholder="gpt-4o" />
                </Form.Item>
              </Form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
