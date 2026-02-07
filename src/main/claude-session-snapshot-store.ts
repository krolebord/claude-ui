import Store from "electron-store";
import type {
  ClaudeActivityState,
  ClaudeSessionSnapshot,
  ClaudeSessionStatus,
  SessionId,
} from "../shared/claude-types";

const SESSIONS_KEY = "sessionSnapshots";
const ACTIVE_SESSION_ID_KEY = "activeSessionId";

const VALID_SESSION_STATUSES = new Set<ClaudeSessionStatus>([
  "idle",
  "starting",
  "running",
  "stopped",
  "error",
]);

const VALID_ACTIVITY_STATES = new Set<ClaudeActivityState>([
  "idle",
  "working",
  "awaiting_approval",
  "awaiting_user_response",
  "unknown",
]);

interface ClaudeSessionSnapshotStoreSchema {
  sessionSnapshots: unknown;
  activeSessionId: unknown;
}

function parseSessionStatus(rawStatus: unknown): ClaudeSessionStatus {
  if (typeof rawStatus !== "string") {
    return "stopped";
  }

  return VALID_SESSION_STATUSES.has(rawStatus as ClaudeSessionStatus)
    ? (rawStatus as ClaudeSessionStatus)
    : "stopped";
}

function parseActivityState(rawState: unknown): ClaudeActivityState {
  if (typeof rawState !== "string") {
    return "unknown";
  }

  return VALID_ACTIVITY_STATES.has(rawState as ClaudeActivityState)
    ? (rawState as ClaudeActivityState)
    : "unknown";
}

function parseOptionalString(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }

  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseSessionSnapshots(rawSessions: unknown): ClaudeSessionSnapshot[] {
  if (!Array.isArray(rawSessions)) {
    return [];
  }

  const seenSessionIds = new Set<SessionId>();
  const snapshots: ClaudeSessionSnapshot[] = [];

  for (const candidate of rawSessions) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const sessionId =
      "sessionId" in candidate && typeof candidate.sessionId === "string"
        ? candidate.sessionId.trim()
        : "";
    const cwd =
      "cwd" in candidate && typeof candidate.cwd === "string"
        ? candidate.cwd.trim()
        : "";

    if (!sessionId || !cwd || seenSessionIds.has(sessionId)) {
      continue;
    }

    seenSessionIds.add(sessionId);
    snapshots.push({
      sessionId,
      cwd,
      sessionName:
        "sessionName" in candidate
          ? parseOptionalString(candidate.sessionName)
          : null,
      status:
        "status" in candidate
          ? parseSessionStatus(candidate.status)
          : "stopped",
      activityState:
        "activityState" in candidate
          ? parseActivityState(candidate.activityState)
          : "unknown",
      activityWarning:
        "activityWarning" in candidate
          ? parseOptionalString(candidate.activityWarning)
          : null,
      lastError:
        "lastError" in candidate
          ? parseOptionalString(candidate.lastError)
          : null,
      createdAt:
        "createdAt" in candidate && typeof candidate.createdAt === "string"
          ? candidate.createdAt.trim() || new Date(0).toISOString()
          : new Date(0).toISOString(),
    });
  }

  return snapshots;
}

function parseActiveSessionId(raw: unknown): SessionId | null {
  if (typeof raw !== "string") {
    return null;
  }

  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : null;
}

export interface ClaudeSessionSnapshotState {
  sessions: ClaudeSessionSnapshot[];
  activeSessionId: SessionId | null;
}

export interface ClaudeSessionSnapshotStoreLike {
  readSessionSnapshotState: () => ClaudeSessionSnapshotState;
  writeSessionSnapshotState: (state: ClaudeSessionSnapshotState) => void;
}

export class ClaudeSessionSnapshotStore
  implements ClaudeSessionSnapshotStoreLike
{
  private readonly store: Store<ClaudeSessionSnapshotStoreSchema>;

  constructor(store?: Store<ClaudeSessionSnapshotStoreSchema>) {
    this.store =
      store ??
      new Store<ClaudeSessionSnapshotStoreSchema>({
        name: "claude-ui",
        defaults: {
          [SESSIONS_KEY]: [],
          [ACTIVE_SESSION_ID_KEY]: null,
        },
      });
  }

  readSessionSnapshotState(): ClaudeSessionSnapshotState {
    return {
      sessions: parseSessionSnapshots(this.store.get(SESSIONS_KEY)),
      activeSessionId: parseActiveSessionId(
        this.store.get(ACTIVE_SESSION_ID_KEY),
      ),
    };
  }

  writeSessionSnapshotState(state: ClaudeSessionSnapshotState): void {
    this.store.set(SESSIONS_KEY, parseSessionSnapshots(state.sessions));
    this.store.set(
      ACTIVE_SESSION_ID_KEY,
      parseActiveSessionId(state.activeSessionId),
    );
  }
}
