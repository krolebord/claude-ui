import type {
  ClaudeActiveSessionChangedEvent,
  ClaudeSessionActivityStateEvent,
  ClaudeSessionActivityWarningEvent,
  ClaudeSessionDataEvent,
  ClaudeSessionErrorEvent,
  ClaudeSessionExitEvent,
  ClaudeSessionHookEvent,
  ClaudeSessionStatusEvent,
  ClaudeSessionTitleChangedEvent,
  ClaudeSessionsSnapshot,
  DeleteClaudeSessionInput,
  DeleteClaudeSessionResult,
  ResizeClaudeSessionInput,
  SetActiveSessionInput,
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
  onClaudeSessionStatus: (
    callback: (payload: ClaudeSessionStatusEvent) => void,
  ): (() => void) => window.claude.onClaudeSessionStatus(callback),
  onClaudeSessionActivityState: (
    callback: (payload: ClaudeSessionActivityStateEvent) => void,
  ): (() => void) => window.claude.onClaudeSessionActivityState(callback),
  onClaudeSessionActivityWarning: (
    callback: (payload: ClaudeSessionActivityWarningEvent) => void,
  ): (() => void) => window.claude.onClaudeSessionActivityWarning(callback),
  onClaudeSessionTitleChanged: (
    callback: (payload: ClaudeSessionTitleChangedEvent) => void,
  ): (() => void) => window.claude.onClaudeSessionTitleChanged(callback),
  onClaudeActiveSessionChanged: (
    callback: (payload: ClaudeActiveSessionChangedEvent) => void,
  ): (() => void) => window.claude.onClaudeActiveSessionChanged(callback),
  onClaudeSessionHookEvent: (
    callback: (payload: ClaudeSessionHookEvent) => void,
  ): (() => void) => window.claude.onClaudeSessionHookEvent(callback),
};
