import {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  shell,
} from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

// ESM 下无 __dirname，需要手动构造
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let agentPort = 15123;
let agentProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;

// ─── 二进制路径 ──────────────────────────────────────────────
// 打包后通过 extraResources 放到 process.resourcesPath/binaries/，
// 开发时直接用项目根目录的 resources/binaries/

function getBinariesPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "binaries");
  }
  return path.join(app.getAppPath(), "resources", "binaries");
}

function getAgentBinaryPath(): string {
  const binDir = getBinariesPath();
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "darwin" && arch === "arm64") {
    const p = path.join(binDir, "agent-aarch64-apple-darwin");
    if (fs.existsSync(p)) return p;
  } else if (platform === "win32" && arch === "x64") {
    const p = path.join(binDir, "agent-x86_64-pc-windows-msvc.exe");
    if (fs.existsSync(p)) return p;
  } else if (platform === "darwin" && arch === "x64") {
    const p = path.join(binDir, "agent-x86_64-apple-darwin");
    if (fs.existsSync(p)) return p;
  }

  return path.join(binDir, "agent");
}

// ─── Agent 子进程 ────────────────────────────────────────────
// 与 Go Agent 的契约：stdout 打印 "PORT=<n>\n" 后进入服务状态

function startAgent(): Promise<number> {
  return new Promise((resolve) => {
    const agentBin = getAgentBinaryPath();

    if (!fs.existsSync(agentBin)) {
      console.error(`[electron] agent binary not found: ${agentBin}`);
      resolve(15123);
      return;
    }

    const dataDir = app.getPath("userData");
    const configDir = path.join(dataDir, "configs");
    fs.mkdirSync(configDir, { recursive: true });
    console.log(`[electron] agent config dir: ${configDir}`);

    const ffagentCache = path.join(app.getPath("sessionData"), "cache", "ffagent");
    fs.mkdirSync(ffagentCache, { recursive: true });
    console.log(`[electron] agent cache dir: ${ffagentCache}`);

    const binDir = getBinariesPath();

    const child = spawn(agentBin, ["-conf", configDir, "-ffmpeg-dir", binDir], {
      env: { ...process.env, FFAGENT_CACHE_DIR: ffagentCache },
      cwd: configDir,
      stdio: ["ignore", "pipe", "inherit"],
    });

    agentProcess = child;

    let resolved = false;
    let buffer = "";

    child.stdout!.on("data", (chunk: Buffer) => {
      if (resolved) return;
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) console.log(`[agent] ${trimmed}`);
        if (trimmed.startsWith("PORT=")) {
          const parsed = parseInt(trimmed.slice(5), 10);
          if (!isNaN(parsed) && parsed > 0) {
            agentPort = parsed;
          }
          resolved = true;
          resolve(agentPort);
          return;
        }
      }
    });

    setTimeout(() => {
      if (!resolved) {
        console.warn("[electron] agent port detection timed out, using default");
        resolved = true;
        resolve(agentPort);
      }
    }, 10_000);

    child.on("error", (err) => {
      console.error("[electron] agent spawn error:", err);
      if (!resolved) {
        resolved = true;
        resolve(15123);
      }
    });

    child.on("exit", (code) => {
      console.log(`[electron] agent exited with code ${code}`);
      agentProcess = null;
    });
  });
}

// ─── 窗口 ────────────────────────────────────────────────────

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    title: "FFAgent",
    width: 900,
    height: 700,
    minWidth: 700,
    minHeight: 500,
    titleBarStyle: process.platform === "darwin" ? "hidden" : "default",
    trafficLightPosition: { x: 12, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  win.on("closed", () => {
    mainWindow = null;
  });

  return win;
}

/** 通知渲染进程切换到设置页面，避免独立窗口 */
function notifyToggleSettings(): void {
  mainWindow?.webContents.send("toggle-settings");
}

// ─── 菜单 ────────────────────────────────────────────────────

function buildMenu(): Menu {
  const template: Electron.MenuItemConstructorOptions[] = [];

  if (process.platform === "darwin") {
    template.push({
      label: "FFAgent",
      submenu: [
        { role: "about", label: "About FFAgent" },
        { type: "separator" },
        {
          label: "Settings",
          accelerator: "CmdOrCtrl+,",
          click: () => notifyToggleSettings(),
        },
        { type: "separator" },
        { role: "hide" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }

  template.push({
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ],
  });

  template.push({
    label: "Window",
    submenu: [
      { role: "minimize" },
      { role: "zoom" },
      { role: "close" },
    ],
  });

  return Menu.buildFromTemplate(template);
}

// ─── IPC ─────────────────────────────────────────────────────

function registerIPC(): void {
  ipcMain.handle("get-agent-port", () => agentPort);
  ipcMain.handle("open-settings", () => notifyToggleSettings());
  ipcMain.handle("open-external", (_, url: string) => shell.openExternal(url));
  ipcMain.handle("reveal-in-folder", (_, filePath: string) =>
    shell.showItemInFolder(filePath),
  );
  ipcMain.handle(
    "show-open-dialog",
    async (
      _,
      options: {
        multiple?: boolean;
        filters?: Array<{ name: string; extensions: string[] }>;
      },
    ) => {
      const properties: Array<"openFile" | "multiSelections"> = ["openFile"];
      if (options.multiple) properties.push("multiSelections");

      const result = await dialog.showOpenDialog({
        properties,
        filters: options.filters,
      });
      return result.filePaths;
    },
  );
}

// ─── 生命周期 ────────────────────────────────────────────────

app.whenReady().then(async () => {
  Menu.setApplicationMenu(buildMenu());
  registerIPC();

  agentPort = await startAgent();
  console.log(`[electron] agent started on port ${agentPort}`);

  mainWindow = createMainWindow();

  // vite-plugin-electron preload 热重载
  process.on("message", (msg) => {
    if (msg === "electron-vite&type=hot-reload") {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.reload();
      }
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (agentProcess) {
    agentProcess.kill();
    agentProcess = null;
  }
});
