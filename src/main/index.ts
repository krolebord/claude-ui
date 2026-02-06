import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, app, dialog, ipcMain, shell } from "electron";
import type {
  ClaudeResizeInput,
  StartClaudeInput,
} from "../shared/claude-types";
import { CLAUDE_IPC_CHANNELS } from "../shared/claude-types";
import { ClaudeActivityMonitor } from "./claude-activity-monitor";
import { ClaudeSessionManager } from "./claude-session";
import { ensureManagedClaudeStatePlugin } from "./claude-state-plugin";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const appRoot = path.join(__dirname, "../..");
const rendererDist = path.join(appRoot, "dist");
const viteDevServerUrl = process.env.VITE_DEV_SERVER_URL;

process.env.APP_ROOT = appRoot;
process.env.VITE_PUBLIC = viteDevServerUrl
  ? path.join(appRoot, "public")
  : rendererDist;

const preload = path.join(__dirname, "../preload/index.mjs");
const indexHtml = path.join(rendererDist, "index.html");

let mainWindow: BrowserWindow | null = null;
let managedPluginDir: string | null = null;
let activityWarning: string | null = null;

function sendToRenderer(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload);
}

function setActivityWarning(nextWarning: string | null): void {
  if (activityWarning === nextWarning) {
    return;
  }

  activityWarning = nextWarning;
  sendToRenderer(CLAUDE_IPC_CHANNELS.activityWarning, activityWarning);
}

const activityMonitor = new ClaudeActivityMonitor({
  emitActivityState: (activityState) =>
    sendToRenderer(CLAUDE_IPC_CHANNELS.activityState, activityState),
  emitHookEvent: (event) =>
    sendToRenderer(CLAUDE_IPC_CHANNELS.hookEvent, event),
});

const claudeSession = new ClaudeSessionManager({
  emitData: (chunk) => sendToRenderer(CLAUDE_IPC_CHANNELS.data, chunk),
  emitExit: (payload) => {
    activityMonitor.stopMonitoring({ preserveState: true });
    sendToRenderer(CLAUDE_IPC_CHANNELS.exit, payload);
  },
  emitError: (payload) => sendToRenderer(CLAUDE_IPC_CHANNELS.error, payload),
  emitStatus: (status) => sendToRenderer(CLAUDE_IPC_CHANNELS.status, status),
});

async function createStateFile(userDataPath: string): Promise<string> {
  const stateDir = path.join(userDataPath, "claude-state");
  const stateFilePath = path.join(stateDir, `${randomUUID()}.ndjson`);

  await mkdir(stateDir, { recursive: true });
  await writeFile(stateFilePath, "", "utf8");

  return stateFilePath;
}

async function initializeManagedPlugin(userDataPath: string): Promise<void> {
  try {
    managedPluginDir = await ensureManagedClaudeStatePlugin(userDataPath);
    setActivityWarning(null);
  } catch (error) {
    managedPluginDir = null;
    const message =
      error instanceof Error
        ? `Hook monitoring plugin failed to load: ${error.message}`
        : "Hook monitoring plugin failed to load.";
    setActivityWarning(message);
  }
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "Claude Wrapper",
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (viteDevServerUrl) {
    await mainWindow.loadURL(viteDevServerUrl);
  } else {
    await mainWindow.loadFile(indexHtml);
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerIpcHandlers(userDataPath: string): void {
  ipcMain.handle(CLAUDE_IPC_CHANNELS.selectFolder, async () => {
    const options: Electron.OpenDialogOptions = {
      title: "Select Project Folder",
      properties: ["openDirectory"],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0] ?? null;
  });

  ipcMain.handle(CLAUDE_IPC_CHANNELS.getStatus, () =>
    claudeSession.getStatus(),
  );

  ipcMain.handle(CLAUDE_IPC_CHANNELS.getActivityState, () =>
    activityMonitor.getState(),
  );

  ipcMain.handle(CLAUDE_IPC_CHANNELS.getActivityWarning, () => activityWarning);

  ipcMain.handle(
    CLAUDE_IPC_CHANNELS.start,
    async (_event, input: StartClaudeInput) => {
      const stateFilePath = await createStateFile(userDataPath);
      activityMonitor.startMonitoring(stateFilePath);

      if (!managedPluginDir) {
        setActivityWarning(
          "Hook monitoring plugin is unavailable. Activity state will remain unknown.",
        );
      } else {
        setActivityWarning(null);
      }

      const result = await claudeSession.start(input, {
        pluginDir: managedPluginDir,
        stateFilePath,
      });

      if (!result.ok) {
        activityMonitor.stopMonitoring();
      }

      return result;
    },
  );

  ipcMain.handle(CLAUDE_IPC_CHANNELS.stop, () => claudeSession.stop());

  ipcMain.on(CLAUDE_IPC_CHANNELS.write, (_event, data: string) => {
    claudeSession.write(data);
  });

  ipcMain.on(
    CLAUDE_IPC_CHANNELS.resize,
    (_event, payload: ClaudeResizeInput) => {
      claudeSession.resize(payload.cols, payload.rows);
    },
  );
}

app.whenReady().then(async () => {
  const userDataPath = app.getPath("userData");
  await initializeManagedPlugin(userDataPath);

  registerIpcHandlers(userDataPath);
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  activityMonitor.stopMonitoring();
  claudeSession.dispose();

  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  activityMonitor.stopMonitoring();
  claudeSession.dispose();
});
