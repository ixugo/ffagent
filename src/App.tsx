import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import enUS from "antd/locale/en_US";
import { useEffect, useState } from "react";
import { I18nContext, useI18nProvider } from "./services/i18n";
import ChatPage from "./pages/ChatPage";
import SettingsPage from "./pages/SettingsPage";

const antdLocaleMap = {
  "zh-CN": zhCN,
  "en-US": enUS,
} as const;

function App() {
  const i18n = useI18nProvider("zh-CN");
  const [hashRoute, setHashRoute] = useState(() => window.location.hash);

  useEffect(() => {
    const sync = () => setHashRoute(window.location.hash);
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const isSettingsWindow = hashRoute === "#/settings";

  return (
    <I18nContext.Provider value={i18n}>
      <ConfigProvider locale={antdLocaleMap[i18n.locale]}>
        {isSettingsWindow ? <SettingsPage /> : <ChatPage />}
      </ConfigProvider>
    </I18nContext.Provider>
  );
}

export default App;
