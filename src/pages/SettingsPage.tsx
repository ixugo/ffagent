import { useEffect, useState } from "react";
import { Form, Input, Button, Select, message, Typography, Popconfirm } from "antd";
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

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export default function SettingsPage() {
  const { t, locale, setLocale } = useLocale();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [cacheBytes, setCacheBytes] = useState<number | null>(null);
  const [cachePath, setCachePath] = useState("");
  const [cacheLoading, setCacheLoading] = useState(false);
  const [cacheClearing, setCacheClearing] = useState(false);
  const [logDir, setLogDir] = useState("");
  const [configDir, setConfigDir] = useState("");

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

  return (
    <div style={{ padding: "24px 24px 80px", maxWidth: 480, height: "100vh", overflow: "auto" }}>
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
          {t("settings.title")}
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
      <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
        {t("settings.cacheSizeHint")}
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
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
        <Button onClick={() => void loadCacheStats()} loading={cacheLoading}>
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
    </div>
  );
}
