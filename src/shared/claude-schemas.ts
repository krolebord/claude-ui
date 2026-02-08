import * as z from "zod";

export const claudeSessionStatusSchema = z.enum([
  "idle",
  "starting",
  "running",
  "stopped",
  "error",
]);

export const claudeActivityStateSchema = z.enum([
  "idle",
  "working",
  "awaiting_approval",
  "awaiting_user_response",
  "unknown",
]);

export const claudeModelSchema = z.enum(["opus", "sonnet", "haiku"]);

export const claudePermissionModeSchema = z.enum([
  "default",
  "acceptEdits",
  "plan",
  "yolo",
]);

const nullableNonEmptyString = z.string().trim().min(1).nullable().catch(null);

const timestampWithFallback = (fallback: string) =>
  z.string().trim().min(1).catch(fallback);

export const claudeProjectSchema = z.object({
  path: z.string().trim().min(1),
  collapsed: z.boolean().catch(false),
  defaultModel: claudeModelSchema.optional().catch(undefined),
  defaultPermissionMode: claudePermissionModeSchema.optional().catch(undefined),
});

export function claudeSessionSnapshotSchema(epochFallback: string) {
  return z
    .object({
      sessionId: z.string().trim().min(1),
      cwd: z.string().trim().min(1),
      sessionName: nullableNonEmptyString,
      status: claudeSessionStatusSchema.catch("stopped"),
      activityState: claudeActivityStateSchema.catch("unknown"),
      activityWarning: nullableNonEmptyString,
      lastError: nullableNonEmptyString,
      createdAt: timestampWithFallback(epochFallback),
      lastActivityAt: z.string().trim().min(1).nullish().catch(null),
    })
    .transform((snapshot) => ({
      ...snapshot,
      lastActivityAt: snapshot.lastActivityAt ?? snapshot.createdAt,
    }));
}

export const claudeHookEventSchema = z.object({
  timestamp: z.string(),
  session_id: z.string(),
  hook_event_name: z.string(),
  cwd: z.string().optional(),
  prompt: z.string().optional(),
  transcript_path: z.string().optional(),
  notification_type: z.string().optional(),
  tool_name: z.string().optional(),
  reason: z.string().optional(),
  stop_hook_active: z.boolean().optional(),
});

export const activeSessionIdSchema = z
  .string()
  .trim()
  .min(1)
  .nullable()
  .catch(null);

export function parseArraySafe<T>(schema: z.ZodType<T>, raw: unknown): T[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const results: T[] = [];
  for (const item of raw) {
    const result = schema.safeParse(item);
    if (result.success) {
      results.push(result.data);
    }
  }
  return results;
}
