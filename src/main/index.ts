import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, app, dialog, ipcMain, shell } from "electron";
import fixPath from "fix-path";

fixPath();
import type {
  AddClaudeProjectInput,
  DeleteClaudeProjectInput,
  DeleteClaudeSessionInput,
  ResizeClaudeSessionInput,
  SetActiveSessionInput,
  SetClaudeProjectCollapsedInput,
  SetClaudeProjectDefaultsInput,
  StartClaudeSessionInput,
  StopClaudeSessionInput,
  WriteClaudeSessionInput,
} from "../shared/claude-types";
import { CLAUDE_IPC_CHANNELS } from "../shared/claude-types";
import { ClaudeProjectStore } from "./claude-project-store";
import { ClaudeSessionService } from "./claude-session-service";
import { ClaudeSessionSnapshotStore } from "./claude-session-snapshot-store";
import { ensureManagedClaudeStatePlugin } from "./claude-state-plugin";
import log from "./logger";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const appRoot = path.join(__dirname, "../..");
const rendererDist = path.join(appRoot, "dist");
const viteDevServerUrl = process.env.VITE_DEV_SERVER_URL;
const shouldOpenDevTools =
  Boolean(viteDevServerUrl) || process.env.ELECTRON_OPEN_DEVTOOLS === "1";

process.env.APP_ROOT = appRoot;
process.env.VITE_PUBLIC = viteDevServerUrl
  ? path.join(appRoot, "public")
  : rendererDist;

const preload = path.join(__dirname, "../preload/index.mjs");
const indexHtml = path.join(rendererDist, "index.html");

let mainWindow: BrowserWindow | null = null;
let sessionService: ClaudeSessionService | null = null;
let managedPluginDir: string | null = null;
let pluginWarning: string | null = null;

function sendToRenderer(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload);
}

async function initializeManagedPlugin(userDataPath: string): Promise<void> {
  try {
    managedPluginDir = await ensureManagedClaudeStatePlugin(userDataPath);
    pluginWarning = null;
  } catch (error) {
    managedPluginDir = null;
    pluginWarning =
      error instanceof Error
        ? `Hook monitoring plugin failed to load: ${error.message}`
        : "Hook monitoring plugin failed to load.";
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

  if (shouldOpenDevTools) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
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

function registerIpcHandlers(): void {
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

  ipcMain.handle(
    CLAUDE_IPC_CHANNELS.getSessions,
    () =>
      sessionService?.getSessionsSnapshot() ?? {
        projects: [],
        sessions: [],
        activeSessionId: null,
      },
  );

  ipcMain.handle(
    CLAUDE_IPC_CHANNELS.addProject,
    (_event, input: AddClaudeProjectInput) =>
      sessionService?.addProject(input) ?? {
        ok: true,
        snapshot: {
          projects: [],
          sessions: [],
          activeSessionId: null,
        },
      },
  );

  ipcMain.handle(
    CLAUDE_IPC_CHANNELS.setProjectCollapsed,
    (_event, input: SetClaudeProjectCollapsedInput) =>
      sessionService?.setProjectCollapsed(input) ?? {
        ok: true,
        snapshot: {
          projects: [],
          sessions: [],
          activeSessionId: null,
        },
      },
  );

  ipcMain.handle(
    CLAUDE_IPC_CHANNELS.setProjectDefaults,
    (_event, input: SetClaudeProjectDefaultsInput) =>
      sessionService?.setProjectDefaults(input) ?? {
        ok: true,
        snapshot: {
          projects: [],
          sessions: [],
          activeSessionId: null,
        },
      },
  );

  ipcMain.handle(
    CLAUDE_IPC_CHANNELS.deleteProject,
    (_event, input: DeleteClaudeProjectInput) =>
      sessionService?.deleteProject(input) ?? {
        ok: true,
        snapshot: {
          projects: [],
          sessions: [],
          activeSessionId: null,
        },
      },
  );

  ipcMain.handle(
    CLAUDE_IPC_CHANNELS.startSession,
    async (_event, input: StartClaudeSessionInput) => {
      if (!sessionService) {
        return {
          ok: false,
          message: "Session service is unavailable.",
        };
      }

      return sessionService.startSession(input);
    },
  );

  ipcMain.handle(
    CLAUDE_IPC_CHANNELS.stopSession,
    (_event, input: StopClaudeSessionInput) =>
      sessionService?.stopSession(input) ?? Promise.resolve({ ok: true }),
  );

  ipcMain.handle(
    CLAUDE_IPC_CHANNELS.deleteSession,
    (_event, input: DeleteClaudeSessionInput) =>
      sessionService?.deleteSession(input) ?? Promise.resolve({ ok: true }),
  );

  ipcMain.handle(
    CLAUDE_IPC_CHANNELS.setActiveSession,
    (_event, input: SetActiveSessionInput) =>
      sessionService?.setActiveSession(input.sessionId) ?? Promise.resolve(),
  );

  ipcMain.on(
    CLAUDE_IPC_CHANNELS.writeSession,
    (_event, input: WriteClaudeSessionInput) => {
      sessionService?.writeToSession(input.sessionId, input.data);
    },
  );

  ipcMain.on(
    CLAUDE_IPC_CHANNELS.resizeSession,
    (_event, input: ResizeClaudeSessionInput) => {
      sessionService?.resizeSession(input.sessionId, input.cols, input.rows);
    },
  );
}

app.whenReady().then(async () => {
  const userDataPath = app.getPath("userData");
  log.info("App starting", {
    platform: process.platform,
    userDataPath,
  });

  await initializeManagedPlugin(userDataPath);
  log.info("Plugin initialization result", {
    pluginDir: managedPluginDir,
    pluginWarning,
  });

  sessionService = new ClaudeSessionService({
    userDataPath,
    pluginDir: managedPluginDir,
    pluginWarning,
    projectStore: new ClaudeProjectStore(),
    sessionSnapshotStore: new ClaudeSessionSnapshotStore(),
    callbacks: {
      emitSessionData: (payload) =>
        sendToRenderer(CLAUDE_IPC_CHANNELS.sessionData, payload),
      emitSessionExit: (payload) =>
        sendToRenderer(CLAUDE_IPC_CHANNELS.sessionExit, payload),
      emitSessionError: (payload) =>
        sendToRenderer(CLAUDE_IPC_CHANNELS.sessionError, payload),
      emitSessionStatus: (payload) =>
        sendToRenderer(CLAUDE_IPC_CHANNELS.sessionStatus, payload),
      emitSessionActivityState: (payload) =>
        sendToRenderer(CLAUDE_IPC_CHANNELS.sessionActivityState, payload),
      emitSessionActivityWarning: (payload) =>
        sendToRenderer(CLAUDE_IPC_CHANNELS.sessionActivityWarning, payload),
      emitSessionTitleChanged: (payload) =>
        sendToRenderer(CLAUDE_IPC_CHANNELS.sessionTitleChanged, payload),
      emitActiveSessionChanged: (payload) =>
        sendToRenderer(CLAUDE_IPC_CHANNELS.activeSessionChanged, payload),
      emitSessionHookEvent: (payload) =>
        sendToRenderer(CLAUDE_IPC_CHANNELS.sessionHookEvent, payload),
    },
  });

  log.info("Session service created");

  registerIpcHandlers();
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  sessionService?.dispose();

  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  sessionService?.dispose();
});
