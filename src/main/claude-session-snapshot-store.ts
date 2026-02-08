import Store from "electron-store";
import type { ClaudeSessionSnapshot, SessionId } from "../shared/claude-types";
import {
  activeSessionIdSchema,
  claudeSessionSnapshotSchema,
  parseArraySafe,
} from "../shared/claude-schemas";

const SESSIONS_KEY = "sessionSnapshots";
const ACTIVE_SESSION_ID_KEY = "activeSessionId";

interface ClaudeSessionSnapshotStoreSchema {
  sessionSnapshots: unknown;
  activeSessionId: unknown;
}

function parseSessionSnapshots(rawSessions: unknown): ClaudeSessionSnapshot[] {
  const schema = claudeSessionSnapshotSchema(new Date(0).toISOString());
  const parsed = parseArraySafe(schema, rawSessions);

  const seenSessionIds = new Set<SessionId>();
  const snapshots: ClaudeSessionSnapshot[] = [];

  for (const snapshot of parsed) {
    if (seenSessionIds.has(snapshot.sessionId)) {
      continue;
    }
    seenSessionIds.add(snapshot.sessionId);
    snapshots.push(snapshot);
  }

  return snapshots;
}

function parseActiveSessionId(raw: unknown): SessionId | null {
  return activeSessionIdSchema.parse(raw);
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
