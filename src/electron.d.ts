/** Electron preload 通过 contextBridge 注入的桥接 API */
interface ElectronAPI {
  getPathForFile(file: File): string;
  getAgentPort(): Promise<number>;
  openSettings(): Promise<void>;
  openExternal(url: string): Promise<void>;
  revealInFolder(filePath: string): Promise<void>;
  showOpenDialog(options: {
    multiple?: boolean;
    filters?: Array<{ name: string; extensions: string[] }>;
  }): Promise<string[]>;
  onToggleSettings(callback: () => void): () => void;
}

interface Window {
  electronAPI?: ElectronAPI;
}
