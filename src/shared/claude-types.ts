import { z } from "zod";

export const claudeSessionStatusSchema = z.enum([
  "idle",
  "starting",
  "stopping",
  "running",
  "stopped",
  "error",
]);

export type ClaudeSessionStatus = z.infer<typeof claudeSessionStatusSchema>;

export const claudeActivityStateSchema = z.enum([
  "idle",
  "working",
  "awaiting_approval",
  "awaiting_user_response",
  "unknown",
]);

export type ClaudeActivityState = z.infer<typeof claudeActivityStateSchema>;

export const claudeModelSchema = z.enum(["opus", "sonnet", "haiku"]);

export type ClaudeModel = z.infer<typeof claudeModelSchema>;

export const claudePermissionModeSchema = z.enum([
  "default",
  "acceptEdits",
  "plan",
  "yolo",
]);

export type ClaudePermissionMode = z.infer<typeof claudePermissionModeSchema>;

export const claudeEffortSchema = z.enum(["low", "medium", "high"]);

export type ClaudeEffort = z.infer<typeof claudeEffortSchema>;

export const haikuModelOverrideSchema = z.enum([
  "claude-sonnet-4-5-20250929",
  "claude-opus-4-6",
]);

export type HaikuModelOverride = z.infer<typeof haikuModelOverrideSchema>;

export interface ClaudeProject {
  path: string;
  collapsed: boolean;
  defaultModel?: ClaudeModel;
  defaultPermissionMode?: ClaudePermissionMode;
  defaultEffort?: ClaudeEffort;
  defaultHaikuModelOverride?: HaikuModelOverride;
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
