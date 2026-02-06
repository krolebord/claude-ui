import { contextBridge, ipcRenderer } from "electron";
import {
  CLAUDE_IPC_CHANNELS,
  type ClaudeActivityState,
  type ClaudeDesktopApi,
  type ClaudeErrorEvent,
  type ClaudeExitEvent,
  type ClaudeHookEvent,
  type ClaudeSessionStatus,
  type StartClaudeInput,
  type StartClaudeResult,
  type StopClaudeResult,
} from "../shared/claude-types";

function subscribe<T>(
  channel: string,
  callback: (payload: T) => void,
): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => {
    callback(payload);
  };

  ipcRenderer.on(channel, listener);

  return () => {
    ipcRenderer.off(channel, listener);
  };
}

const claudeApi: ClaudeDesktopApi = {
  selectFolder: () => ipcRenderer.invoke(CLAUDE_IPC_CHANNELS.selectFolder),
  getStatus: () => ipcRenderer.invoke(CLAUDE_IPC_CHANNELS.getStatus),
  getActivityState: () =>
    ipcRenderer.invoke(CLAUDE_IPC_CHANNELS.getActivityState),
  getActivityWarning: () =>
    ipcRenderer.invoke(CLAUDE_IPC_CHANNELS.getActivityWarning),
  startClaude: (input: StartClaudeInput): Promise<StartClaudeResult> =>
    ipcRenderer.invoke(CLAUDE_IPC_CHANNELS.start, input),
  stopClaude: (): Promise<StopClaudeResult> =>
    ipcRenderer.invoke(CLAUDE_IPC_CHANNELS.stop),
  writeToClaude: (data: string): void => {
    ipcRenderer.send(CLAUDE_IPC_CHANNELS.write, data);
  },
  resizeClaude: (cols: number, rows: number): void => {
    ipcRenderer.send(CLAUDE_IPC_CHANNELS.resize, { cols, rows });
  },
  onClaudeData: (callback) =>
    subscribe<string>(CLAUDE_IPC_CHANNELS.data, callback),
  onClaudeExit: (callback) =>
    subscribe<ClaudeExitEvent>(CLAUDE_IPC_CHANNELS.exit, callback),
  onClaudeError: (callback) =>
    subscribe<ClaudeErrorEvent>(CLAUDE_IPC_CHANNELS.error, callback),
  onClaudeStatus: (callback) =>
    subscribe<ClaudeSessionStatus>(CLAUDE_IPC_CHANNELS.status, callback),
  onClaudeActivityState: (callback) =>
    subscribe<ClaudeActivityState>(CLAUDE_IPC_CHANNELS.activityState, callback),
  onClaudeActivityWarning: (callback) =>
    subscribe<string | null>(CLAUDE_IPC_CHANNELS.activityWarning, callback),
  onClaudeHookEvent: (callback) =>
    subscribe<ClaudeHookEvent>(CLAUDE_IPC_CHANNELS.hookEvent, callback),
};

contextBridge.exposeInMainWorld("claude", claudeApi);
