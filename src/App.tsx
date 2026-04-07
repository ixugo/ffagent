import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import enUS from "antd/locale/en_US";
import { useCallback, useEffect, useState } from "react";
import { I18nContext, useI18nProvider } from "./services/i18n";
import ChatPage from "./pages/ChatPage";
import SettingsPage from "./pages/SettingsPage";

const antdLocaleMap = {
  "zh-CN": zhCN,
  "en-US": enUS,
} as const;

function App() {
  const i18n = useI18nProvider("zh-CN");
  const [showSettings, setShowSettings] = useState(false);

  // 监听 Electron 菜单快捷键 Cmd+, 触发的设置切换
  useEffect(() => {
    const unsub = window.electronAPI?.onToggleSettings(() => {
      setShowSettings((prev) => !prev);
    });
    return () => unsub?.();
  }, []);

  const openSettings = useCallback(() => setShowSettings(true), []);
  const closeSettings = useCallback(() => setShowSettings(false), []);

  return (
    <I18nContext.Provider value={i18n}>
      <ConfigProvider locale={antdLocaleMap[i18n.locale]}>
        {showSettings ? (
          <SettingsPage onBack={closeSettings} />
        ) : (
          <ChatPage onOpenSettings={openSettings} />
        )}
      </ConfigProvider>
    </I18nContext.Provider>
  );
}

export default App;
