import type { ClaudeSessionSnapshot } from "../shared/claude-types";

export function toSnapshot<T extends ClaudeSessionSnapshot>(
  record: T,
): ClaudeSessionSnapshot {
  const {
    sessionId,
    cwd,
    sessionName,
    status,
    activityState,
    activityWarning,
    lastError,
    createdAt,
    lastActivityAt,
  } = record;
  return {
    sessionId,
    cwd,
    sessionName,
    status,
    activityState,
    activityWarning,
    lastError,
    createdAt,
    lastActivityAt,
  };
}

export function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeStringWithFallback(
  value: string,
  fallback: string,
): string {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
}

export function isTimestampNewer(next: string, current: string): boolean {
  if (next === current) {
    return false;
  }

  const nextTimestamp = Date.parse(next);
  const currentTimestamp = Date.parse(current);
  const nextIsValid = !Number.isNaN(nextTimestamp);
  const currentIsValid = !Number.isNaN(currentTimestamp);

  if (nextIsValid && currentIsValid) {
    return nextTimestamp > currentTimestamp;
  }

  if (nextIsValid && !currentIsValid) {
    return true;
  }

  if (!nextIsValid && currentIsValid) {
    return false;
  }

  return true;
}
