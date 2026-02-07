export const CLAUDE_IPC_CHANNELS = {
  selectFolder: "claude:select-folder",
  getSessions: "claude:get-sessions",
  addProject: "claude:add-project",
  setProjectCollapsed: "claude:set-project-collapsed",
  startSession: "claude:start-session",
  stopSession: "claude:stop-session",
  deleteSession: "claude:delete-session",
  deleteProject: "claude:delete-project",
  setActiveSession: "claude:set-active-session",
  writeSession: "claude:write-session",
  resizeSession: "claude:resize-session",
  sessionData: "claude:session-data",
  sessionExit: "claude:session-exit",
  sessionError: "claude:session-error",
  sessionStatus: "claude:session-status",
  sessionActivityState: "claude:session-activity-state",
  sessionActivityWarning: "claude:session-activity-warning",
  sessionHookEvent: "claude:session-hook-event",
  sessionTitleChanged: "claude:session-title-changed",
  activeSessionChanged: "claude:active-session-changed",
} as const;

export type SessionId = string;

export type ClaudeModel = "opus" | "sonnet" | "haiku";

export type ClaudeSessionStatus =
  | "idle"
  | "starting"
  | "running"
  | "stopped"
  | "error";

export type ClaudeActivityState =
  | "idle"
  | "working"
  | "awaiting_approval"
  | "awaiting_user_response"
  | "unknown";

export interface ClaudeProject {
  path: string;
  collapsed: boolean;
}

export interface ClaudeSessionSnapshot {
  sessionId: SessionId;
  cwd: string;
  sessionName: string | null;
  status: ClaudeSessionStatus;
  activityState: ClaudeActivityState;
  activityWarning: string | null;
  lastError: string | null;
  createdAt: string;
  lastActivityAt: string;
}

export interface ClaudeSessionsSnapshot {
  projects: ClaudeProject[];
  sessions: ClaudeSessionSnapshot[];
  activeSessionId: SessionId | null;
}

export interface AddClaudeProjectInput {
  path: string;
}

export interface AddClaudeProjectResult {
  ok: true;
  snapshot: ClaudeSessionsSnapshot;
}

export interface SetClaudeProjectCollapsedInput {
  path: string;
  collapsed: boolean;
}

export interface SetClaudeProjectCollapsedResult {
  ok: true;
  snapshot: ClaudeSessionsSnapshot;
}

export interface StartClaudeSessionInput {
  cwd: string;
  cols: number;
  rows: number;
  resumeSessionId?: SessionId;
  sessionName?: string | null;
  dangerouslySkipPermissions?: boolean;
  model?: ClaudeModel;
  initialPrompt?: string;
}

export type StartClaudeSessionResult =
  | {
      ok: true;
      sessionId: SessionId;
      snapshot: ClaudeSessionsSnapshot;
    }
  | {
      ok: false;
      message: string;
    };

export interface StopClaudeSessionInput {
  sessionId: SessionId;
}

export interface StopClaudeSessionResult {
  ok: true;
}

export interface DeleteClaudeProjectInput {
  path: string;
}

export interface DeleteClaudeProjectResult {
  ok: true;
  snapshot: ClaudeSessionsSnapshot;
}

export interface DeleteClaudeSessionInput {
  sessionId: SessionId;
}

export interface DeleteClaudeSessionResult {
  ok: true;
}

export interface SetActiveSessionInput {
  sessionId: SessionId;
}

export interface WriteClaudeSessionInput {
  sessionId: SessionId;
  data: string;
}

export interface ResizeClaudeSessionInput {
  sessionId: SessionId;
  cols: number;
  rows: number;
}

export interface ClaudeSessionDataEvent {
  sessionId: SessionId;
  chunk: string;
}

export interface ClaudeSessionExitEvent {
  sessionId: SessionId;
  exitCode: number | null;
  signal?: number;
}

export interface ClaudeSessionErrorEvent {
  sessionId: SessionId;
  message: string;
}

export interface ClaudeSessionStatusEvent {
  sessionId: SessionId;
  status: ClaudeSessionStatus;
}

export interface ClaudeSessionActivityStateEvent {
  sessionId: SessionId;
  activityState: ClaudeActivityState;
}

export interface ClaudeSessionActivityWarningEvent {
  sessionId: SessionId;
  warning: string | null;
}

export interface ClaudeSessionTitleChangedEvent {
  sessionId: SessionId;
  title: string;
}

export interface ClaudeActiveSessionChangedEvent {
  activeSessionId: SessionId | null;
}

export interface ClaudeHookEvent {
  timestamp: string;
  session_id: string;
  hook_event_name: string;
  cwd?: string;
  prompt?: string;
  transcript_path?: string;
  notification_type?: string;
  tool_name?: string;
  reason?: string;
  stop_hook_active?: boolean;
}

export interface ClaudeSessionHookEvent {
  sessionId: SessionId;
  event: ClaudeHookEvent;
}

export interface ClaudeDesktopApi {
  selectFolder: () => Promise<string | null>;
  getSessions: () => Promise<ClaudeSessionsSnapshot>;
  addClaudeProject: (
    input: AddClaudeProjectInput,
  ) => Promise<AddClaudeProjectResult>;
  setClaudeProjectCollapsed: (
    input: SetClaudeProjectCollapsedInput,
  ) => Promise<SetClaudeProjectCollapsedResult>;
  startClaudeSession: (
    input: StartClaudeSessionInput,
  ) => Promise<StartClaudeSessionResult>;
  stopClaudeSession: (
    input: StopClaudeSessionInput,
  ) => Promise<StopClaudeSessionResult>;
  deleteClaudeProject: (
    input: DeleteClaudeProjectInput,
  ) => Promise<DeleteClaudeProjectResult>;
  deleteClaudeSession: (
    input: DeleteClaudeSessionInput,
  ) => Promise<DeleteClaudeSessionResult>;
  setActiveSession: (input: SetActiveSessionInput) => Promise<void>;
  writeToClaudeSession: (input: WriteClaudeSessionInput) => void;
  resizeClaudeSession: (input: ResizeClaudeSessionInput) => void;
  onClaudeSessionData: (
    callback: (payload: ClaudeSessionDataEvent) => void,
  ) => () => void;
  onClaudeSessionExit: (
    callback: (payload: ClaudeSessionExitEvent) => void,
  ) => () => void;
  onClaudeSessionError: (
    callback: (payload: ClaudeSessionErrorEvent) => void,
  ) => () => void;
  onClaudeSessionStatus: (
    callback: (payload: ClaudeSessionStatusEvent) => void,
  ) => () => void;
  onClaudeSessionActivityState: (
    callback: (payload: ClaudeSessionActivityStateEvent) => void,
  ) => () => void;
  onClaudeSessionActivityWarning: (
    callback: (payload: ClaudeSessionActivityWarningEvent) => void,
  ) => () => void;
  onClaudeSessionTitleChanged: (
    callback: (payload: ClaudeSessionTitleChangedEvent) => void,
  ) => () => void;
  onClaudeActiveSessionChanged: (
    callback: (payload: ClaudeActiveSessionChangedEvent) => void,
  ) => () => void;
  onClaudeSessionHookEvent: (
    callback: (payload: ClaudeSessionHookEvent) => void,
  ) => () => void;
}
