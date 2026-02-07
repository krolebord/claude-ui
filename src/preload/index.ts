import { contextBridge, ipcRenderer } from "electron";
import {
  type AddClaudeProjectInput,
  type AddClaudeProjectResult,
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
  type ClaudeSessionTitleChangedEvent,
  type ClaudeSessionsSnapshot,
  type DeleteClaudeProjectInput,
  type DeleteClaudeProjectResult,
  type DeleteClaudeSessionInput,
  type DeleteClaudeSessionResult,
  type ResizeClaudeSessionInput,
  type SetActiveSessionInput,
  type SetClaudeProjectCollapsedInput,
  type SetClaudeProjectCollapsedResult,
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
  addClaudeProject: (
    input: AddClaudeProjectInput,
  ): Promise<AddClaudeProjectResult> =>
    ipcRenderer.invoke(CLAUDE_IPC_CHANNELS.addProject, input),
  setClaudeProjectCollapsed: (
    input: SetClaudeProjectCollapsedInput,
  ): Promise<SetClaudeProjectCollapsedResult> =>
    ipcRenderer.invoke(CLAUDE_IPC_CHANNELS.setProjectCollapsed, input),
  deleteClaudeProject: (
    input: DeleteClaudeProjectInput,
  ): Promise<DeleteClaudeProjectResult> =>
    ipcRenderer.invoke(CLAUDE_IPC_CHANNELS.deleteProject, input),
  startClaudeSession: (
    input: StartClaudeSessionInput,
  ): Promise<StartClaudeSessionResult> =>
    ipcRenderer.invoke(CLAUDE_IPC_CHANNELS.startSession, input),
  stopClaudeSession: (
    input: StopClaudeSessionInput,
  ): Promise<StopClaudeSessionResult> =>
    ipcRenderer.invoke(CLAUDE_IPC_CHANNELS.stopSession, input),
  deleteClaudeSession: (
    input: DeleteClaudeSessionInput,
  ): Promise<DeleteClaudeSessionResult> =>
    ipcRenderer.invoke(CLAUDE_IPC_CHANNELS.deleteSession, input),
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
  onClaudeSessionTitleChanged: (callback) =>
    subscribe<ClaudeSessionTitleChangedEvent>(
      CLAUDE_IPC_CHANNELS.sessionTitleChanged,
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
