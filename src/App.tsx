import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import enUS from "antd/locale/en_US";
import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { I18nContext, useI18nProvider } from "./services/i18n";
import ChatPage from "./pages/ChatPage";
import SettingsPage from "./pages/SettingsPage";

const antdLocaleMap = {
  "zh-CN": zhCN,
  "en-US": enUS,
} as const;

const NO_DRAG_SELECTORS = "button, a, input, textarea, select, [role='button'], .ant-btn, .ant-popover";

function App() {
  const i18n = useI18nProvider("zh-CN");
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen("toggle-settings", () => {
      setShowSettings((prev) => !prev);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  // data-tauri-drag-region 仅检查 e.target，对于子元素较多的拖拽区域不够可靠，
  // 因此额外使用 mousedown 监听 + startDragging() 兜底
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      const dragRegion = target.closest(".app-drag-region");
      if (!dragRegion) return;
      if (target.closest(NO_DRAG_SELECTORS)) return;
      e.preventDefault();
      getCurrentWindow().startDragging();
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);

  const openSettings = useCallback(() => setShowSettings(true), []);
  const closeSettings = useCallback(() => setShowSettings(false), []);

  return (
    <I18nContext.Provider value={i18n}>
      <ConfigProvider locale={antdLocaleMap[i18n.locale]}>
        {/* 用 display:none 隐藏而非卸载，切换到设置页时保持 SSE 连接不中断 */}
        <div style={{ display: showSettings ? "none" : "flex", height: "100vh" }}>
          <ChatPage onOpenSettings={openSettings} />
        </div>
        {showSettings && <SettingsPage onBack={closeSettings} />}
      </ConfigProvider>
    </I18nContext.Provider>
  );
}

export default App;
