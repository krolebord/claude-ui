export const CLAUDE_IPC_CHANNELS = {
  selectFolder: "claude:select-folder",
  getStatus: "claude:get-status",
  getActivityState: "claude:get-activity-state",
  getActivityWarning: "claude:get-activity-warning",
  start: "claude:start",
  stop: "claude:stop",
  write: "claude:write",
  resize: "claude:resize",
  data: "claude:data",
  exit: "claude:exit",
  error: "claude:error",
  status: "claude:status",
  activityState: "claude:activity-state",
  activityWarning: "claude:activity-warning",
  hookEvent: "claude:hook-event",
} as const;

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

export interface StartClaudeInput {
  cwd: string;
  cols: number;
  rows: number;
}

export type StartClaudeResult = { ok: true } | { ok: false; message: string };

export interface StopClaudeResult {
  ok: true;
}

export interface ClaudeExitEvent {
  exitCode: number | null;
  signal?: number;
}

export interface ClaudeErrorEvent {
  message: string;
}

export interface ClaudeResizeInput {
  cols: number;
  rows: number;
}

export interface ClaudeHookEvent {
  timestamp: string;
  session_id: string;
  hook_event_name: string;
  cwd?: string;
  transcript_path?: string;
  notification_type?: string;
  tool_name?: string;
  reason?: string;
  stop_hook_active?: boolean;
}

export interface ClaudeActivityWarningEvent {
  message: string;
}

export interface ClaudeDesktopApi {
  selectFolder: () => Promise<string | null>;
  getStatus: () => Promise<ClaudeSessionStatus>;
  getActivityState: () => Promise<ClaudeActivityState>;
  getActivityWarning: () => Promise<string | null>;
  startClaude: (input: StartClaudeInput) => Promise<StartClaudeResult>;
  stopClaude: () => Promise<StopClaudeResult>;
  writeToClaude: (data: string) => void;
  resizeClaude: (cols: number, rows: number) => void;
  onClaudeData: (callback: (chunk: string) => void) => () => void;
  onClaudeExit: (callback: (payload: ClaudeExitEvent) => void) => () => void;
  onClaudeError: (callback: (payload: ClaudeErrorEvent) => void) => () => void;
  onClaudeStatus: (
    callback: (status: ClaudeSessionStatus) => void,
  ) => () => void;
  onClaudeActivityState: (
    callback: (status: ClaudeActivityState) => void,
  ) => () => void;
  onClaudeActivityWarning: (
    callback: (warning: string | null) => void,
  ) => () => void;
  onClaudeHookEvent: (callback: (event: ClaudeHookEvent) => void) => () => void;
}
