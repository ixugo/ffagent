import { contextBridge, ipcRenderer, webUtils } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  getAgentPort: (): Promise<number> => ipcRenderer.invoke("get-agent-port"),
  openSettings: (): Promise<void> => ipcRenderer.invoke("open-settings"),
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke("open-external", url),
  revealInFolder: (filePath: string): Promise<void> =>
    ipcRenderer.invoke("reveal-in-folder", filePath),
  showOpenDialog: (options: {
    multiple?: boolean;
    filters?: Array<{ name: string; extensions: string[] }>;
  }): Promise<string[]> => ipcRenderer.invoke("show-open-dialog", options),
  onToggleSettings: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on("toggle-settings", handler);
    return () => {
      ipcRenderer.removeListener("toggle-settings", handler);
    };
  },
});
