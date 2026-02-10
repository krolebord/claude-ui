import { contextBridge, ipcRenderer } from "electron";
import {
  type AddClaudeProjectInput,
  CLAUDE_IPC_CHANNELS,
  type ClaudeAllStatesSnapshot,
  type ClaudeDesktopApi,
  type ClaudeSessionDataEvent,
  type ClaudeSessionErrorEvent,
  type ClaudeSessionExitEvent,
  type ClaudeStateSetEvent,
  type ClaudeStateUpdateEvent,
  type ClaudeUsageResult,
  type DeleteClaudeProjectInput,
  type DeleteClaudeSessionInput,
  type GetClaudeStateInput,
  type ResizeClaudeSessionInput,
  type SetActiveSessionInput,
  type SetClaudeProjectCollapsedInput,
  type SetClaudeProjectDefaultsInput,
  type StartClaudeSessionInput,
  type StartClaudeSessionResult,
  type StopClaudeSessionInput,
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
  getAllStates: (): Promise<ClaudeAllStatesSnapshot> =>
    ipcRenderer.invoke(CLAUDE_IPC_CHANNELS.getAllStates),
  getState: (input: GetClaudeStateInput): Promise<ClaudeStateSetEvent> =>
    ipcRenderer.invoke(CLAUDE_IPC_CHANNELS.getState, input),
  addClaudeProject: (input: AddClaudeProjectInput): Promise<void> =>
    ipcRenderer.invoke(CLAUDE_IPC_CHANNELS.addProject, input),
  setClaudeProjectCollapsed: (
    input: SetClaudeProjectCollapsedInput,
  ): Promise<void> =>
    ipcRenderer.invoke(CLAUDE_IPC_CHANNELS.setProjectCollapsed, input),
  setClaudeProjectDefaults: (
    input: SetClaudeProjectDefaultsInput,
  ): Promise<void> =>
    ipcRenderer.invoke(CLAUDE_IPC_CHANNELS.setProjectDefaults, input),
  deleteClaudeProject: (input: DeleteClaudeProjectInput): Promise<void> =>
    ipcRenderer.invoke(CLAUDE_IPC_CHANNELS.deleteProject, input),
  startClaudeSession: (
    input: StartClaudeSessionInput,
  ): Promise<StartClaudeSessionResult> =>
    ipcRenderer.invoke(CLAUDE_IPC_CHANNELS.startSession, input),
  stopClaudeSession: (input: StopClaudeSessionInput): Promise<void> =>
    ipcRenderer.invoke(CLAUDE_IPC_CHANNELS.stopSession, input),
  deleteClaudeSession: (input: DeleteClaudeSessionInput): Promise<void> =>
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
  onClaudeStateSet: (callback) =>
    subscribe<ClaudeStateSetEvent>(CLAUDE_IPC_CHANNELS.stateSet, callback),
  onClaudeStateUpdate: (callback) =>
    subscribe<ClaudeStateUpdateEvent>(
      CLAUDE_IPC_CHANNELS.stateUpdate,
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
  getUsage: (): Promise<ClaudeUsageResult> =>
    ipcRenderer.invoke(CLAUDE_IPC_CHANNELS.getUsage),
  openLogFolder: (): Promise<void> =>
    ipcRenderer.invoke(CLAUDE_IPC_CHANNELS.openLogFolder),
  openStatePluginFolder: (): Promise<void> =>
    ipcRenderer.invoke(CLAUDE_IPC_CHANNELS.openStatePluginFolder),
  openSessionFilesFolder: (): Promise<void> =>
    ipcRenderer.invoke(CLAUDE_IPC_CHANNELS.openSessionFilesFolder),
};

contextBridge.exposeInMainWorld("claude", claudeApi);
