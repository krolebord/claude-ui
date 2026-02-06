import { contextBridge, ipcRenderer } from "electron";
import {
  CLAUDE_IPC_CHANNELS,
  type ClaudeActiveSessionChangedEvent,
  type ClaudeDesktopApi,
  type ClaudeSessionActivityStateEvent,
  type ClaudeSessionActivityWarningEvent,
  type ClaudeSessionDataEvent,
  type ClaudeSessionErrorEvent,
  type ClaudeSessionExitEvent,
  type ClaudeSessionHookEvent,
  type ClaudeSessionStatusEvent,
  type ClaudeSessionsSnapshot,
  type ResizeClaudeSessionInput,
  type SetActiveSessionInput,
  type StartClaudeSessionInput,
  type StartClaudeSessionResult,
  type StopClaudeSessionInput,
  type StopClaudeSessionResult,
  type WriteClaudeSessionInput,
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
  getSessions: (): Promise<ClaudeSessionsSnapshot> =>
    ipcRenderer.invoke(CLAUDE_IPC_CHANNELS.getSessions),
  startClaudeSession: (
    input: StartClaudeSessionInput,
  ): Promise<StartClaudeSessionResult> =>
    ipcRenderer.invoke(CLAUDE_IPC_CHANNELS.startSession, input),
  stopClaudeSession: (
    input: StopClaudeSessionInput,
  ): Promise<StopClaudeSessionResult> =>
    ipcRenderer.invoke(CLAUDE_IPC_CHANNELS.stopSession, input),
  setActiveSession: (input: SetActiveSessionInput): Promise<void> =>
    ipcRenderer.invoke(CLAUDE_IPC_CHANNELS.setActiveSession, input),
  writeToClaudeSession: (input: WriteClaudeSessionInput): void => {
    ipcRenderer.send(CLAUDE_IPC_CHANNELS.writeSession, input);
  },
  resizeClaudeSession: (input: ResizeClaudeSessionInput): void => {
    ipcRenderer.send(CLAUDE_IPC_CHANNELS.resizeSession, input);
  },
  onClaudeSessionData: (callback) =>
    subscribe<ClaudeSessionDataEvent>(
      CLAUDE_IPC_CHANNELS.sessionData,
      callback,
    ),
  onClaudeSessionExit: (callback) =>
    subscribe<ClaudeSessionExitEvent>(
      CLAUDE_IPC_CHANNELS.sessionExit,
      callback,
    ),
  onClaudeSessionError: (callback) =>
    subscribe<ClaudeSessionErrorEvent>(
      CLAUDE_IPC_CHANNELS.sessionError,
      callback,
    ),
  onClaudeSessionStatus: (callback) =>
    subscribe<ClaudeSessionStatusEvent>(
      CLAUDE_IPC_CHANNELS.sessionStatus,
      callback,
    ),
  onClaudeSessionActivityState: (callback) =>
    subscribe<ClaudeSessionActivityStateEvent>(
      CLAUDE_IPC_CHANNELS.sessionActivityState,
      callback,
    ),
  onClaudeSessionActivityWarning: (callback) =>
    subscribe<ClaudeSessionActivityWarningEvent>(
      CLAUDE_IPC_CHANNELS.sessionActivityWarning,
      callback,
    ),
  onClaudeActiveSessionChanged: (callback) =>
    subscribe<ClaudeActiveSessionChangedEvent>(
      CLAUDE_IPC_CHANNELS.activeSessionChanged,
      callback,
    ),
  onClaudeSessionHookEvent: (callback) =>
    subscribe<ClaudeSessionHookEvent>(
      CLAUDE_IPC_CHANNELS.sessionHookEvent,
      callback,
    ),
};

contextBridge.exposeInMainWorld("claude", claudeApi);
