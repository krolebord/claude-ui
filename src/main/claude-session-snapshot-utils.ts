import type {
  ClaudeActivityState,
  ClaudeSessionSnapshot,
  ClaudeSessionStatus,
  SessionId,
} from "../shared/claude-types";

export interface SessionSnapshotSource {
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

export function toSnapshot(
  record: SessionSnapshotSource,
): ClaudeSessionSnapshot {
  return {
    sessionId: record.sessionId,
    cwd: record.cwd,
    sessionName: record.sessionName,
    status: record.status,
    activityState: record.activityState,
    activityWarning: record.activityWarning,
    lastError: record.lastError,
    createdAt: record.createdAt,
    lastActivityAt: record.lastActivityAt,
  };
}

export function normalizeSessionName(sessionName?: string | null): string | null {
  if (typeof sessionName !== "string") {
    return null;
  }

  const trimmed = sessionName.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeResumeSessionId(
  sessionId?: SessionId,
): SessionId | null {
  if (typeof sessionId !== "string") {
    return null;
  }

  const trimmed = sessionId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeCreatedAt(
  createdAt: string,
  nowFactory: () => string,
): string {
  const normalized = createdAt.trim();
  return normalized.length > 0 ? normalized : nowFactory();
}

export function normalizeLastActivityAt(
  lastActivityAt: string,
  fallbackTimestamp: string,
): string {
  const normalized = lastActivityAt.trim();
  return normalized.length > 0 ? normalized : fallbackTimestamp;
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
