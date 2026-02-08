import type {
  AddClaudeProjectInput,
  AddClaudeProjectResult,
  ClaudeActiveSessionChangedEvent,
  ClaudeSessionDataEvent,
  ClaudeSessionErrorEvent,
  ClaudeSessionExitEvent,
  ClaudeSessionUpdatedEvent,
  ClaudeSessionsSnapshot,
  ClaudeUsageResult,
  ClaudeUsageUpdateEvent,
  DeleteClaudeProjectInput,
  DeleteClaudeProjectResult,
  DeleteClaudeSessionInput,
  DeleteClaudeSessionResult,
  ResizeClaudeSessionInput,
  SetActiveSessionInput,
  SetClaudeProjectCollapsedInput,
  SetClaudeProjectCollapsedResult,
  SetClaudeProjectDefaultsInput,
  SetClaudeProjectDefaultsResult,
  StartClaudeSessionInput,
  StartClaudeSessionResult,
  StopClaudeSessionInput,
  StopClaudeSessionResult,
  WriteClaudeSessionInput,
} from "@shared/claude-types";

export const claudeIpc = {
  selectFolder: (): Promise<string | null> => window.claude.selectFolder(),
  getSessions: (): Promise<ClaudeSessionsSnapshot> =>
    window.claude.getSessions(),
  addClaudeProject: (
    input: AddClaudeProjectInput,
  ): Promise<AddClaudeProjectResult> => window.claude.addClaudeProject(input),
  setClaudeProjectCollapsed: (
    input: SetClaudeProjectCollapsedInput,
  ): Promise<SetClaudeProjectCollapsedResult> =>
    window.claude.setClaudeProjectCollapsed(input),
  setClaudeProjectDefaults: (
    input: SetClaudeProjectDefaultsInput,
  ): Promise<SetClaudeProjectDefaultsResult> =>
    window.claude.setClaudeProjectDefaults(input),
  deleteClaudeProject: (
    input: DeleteClaudeProjectInput,
  ): Promise<DeleteClaudeProjectResult> =>
    window.claude.deleteClaudeProject(input),
  startClaudeSession: (
    input: StartClaudeSessionInput,
  ): Promise<StartClaudeSessionResult> =>
    window.claude.startClaudeSession(input),
  stopClaudeSession: (
    input: StopClaudeSessionInput,
  ): Promise<StopClaudeSessionResult> => window.claude.stopClaudeSession(input),
  deleteClaudeSession: (
    input: DeleteClaudeSessionInput,
  ): Promise<DeleteClaudeSessionResult> =>
    window.claude.deleteClaudeSession(input),
  setActiveSession: (input: SetActiveSessionInput): Promise<void> =>
    window.claude.setActiveSession(input),
  writeToClaudeSession: (input: WriteClaudeSessionInput): void =>
    window.claude.writeToClaudeSession(input),
  resizeClaudeSession: (input: ResizeClaudeSessionInput): void =>
    window.claude.resizeClaudeSession(input),
  onClaudeSessionData: (
    callback: (payload: ClaudeSessionDataEvent) => void,
  ): (() => void) => window.claude.onClaudeSessionData(callback),
  onClaudeSessionExit: (
    callback: (payload: ClaudeSessionExitEvent) => void,
  ): (() => void) => window.claude.onClaudeSessionExit(callback),
  onClaudeSessionError: (
    callback: (payload: ClaudeSessionErrorEvent) => void,
  ): (() => void) => window.claude.onClaudeSessionError(callback),
  onClaudeSessionUpdated: (
    callback: (payload: ClaudeSessionUpdatedEvent) => void,
  ): (() => void) => window.claude.onClaudeSessionUpdated(callback),
  onClaudeActiveSessionChanged: (
    callback: (payload: ClaudeActiveSessionChangedEvent) => void,
  ): (() => void) => window.claude.onClaudeActiveSessionChanged(callback),
  startUsageMonitor: (): Promise<ClaudeUsageResult> =>
    window.claude.startUsageMonitor(),
  stopUsageMonitor: (): Promise<void> => window.claude.stopUsageMonitor(),
  onClaudeUsageUpdate: (
    callback: (payload: ClaudeUsageUpdateEvent) => void,
  ): (() => void) => window.claude.onClaudeUsageUpdate(callback),
  openLogFolder: (): Promise<void> => window.claude.openLogFolder(),
};
