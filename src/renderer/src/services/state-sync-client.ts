import { claudeIpc } from "@renderer/lib/ipc";
import type {
  ClaudeAllStatesSnapshot,
  ClaudeStateByKey,
  ClaudeStateKey,
  ClaudeStateOp,
  ClaudeStateSetEvent,
  ClaudeStateUpdateEvent,
} from "@shared/claude-types";
import { CLAUDE_STATE_KEYS } from "@shared/claude-types";

interface StateSyncClientOptions {
  onStateChanged: () => void;
}

type MutableContainer = Record<string, unknown> | unknown[];

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isArrayIndex(segment: string): boolean {
  return /^\d+$/.test(segment);
}

function resolveContainer(
  target: MutableContainer,
  path: string[],
): { parent: MutableContainer; key: string } | null {
  if (path.length === 0) {
    return null;
  }

  let cursor: MutableContainer = target;
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index] as string;
    const nextKey = path[index + 1] as string;

    if (Array.isArray(cursor)) {
      const arrayIndex = Number.parseInt(key, 10);
      if (!Number.isFinite(arrayIndex)) {
        return null;
      }

      let child = cursor[arrayIndex];
      if (!Array.isArray(child) && !isObjectLike(child)) {
        child = isArrayIndex(nextKey) ? [] : {};
        cursor[arrayIndex] = child;
      }
      cursor = child as MutableContainer;
      continue;
    }

    let child = cursor[key];
    if (!Array.isArray(child) && !isObjectLike(child)) {
      child = isArrayIndex(nextKey) ? [] : {};
      cursor[key] = child;
    }
    cursor = child as MutableContainer;
  }

  return {
    parent: cursor,
    key: path[path.length - 1] as string,
  };
}

export function applyStateOps(
  target: MutableContainer,
  ops: ClaudeStateOp[],
): void {
  for (const op of ops) {
    const [kind, path] = op;
    if (path.length === 0) {
      continue;
    }

    const resolved = resolveContainer(target, path);
    if (!resolved) {
      continue;
    }

    const { parent, key } = resolved;
    if (kind === "set") {
      const value = structuredClone(op[2]);
      if (Array.isArray(parent)) {
        const index = Number.parseInt(key, 10);
        if (!Number.isFinite(index)) {
          continue;
        }
        parent[index] = value;
      } else {
        parent[key] = value;
      }
      continue;
    }

    if (Array.isArray(parent)) {
      const index = Number.parseInt(key, 10);
      if (!Number.isFinite(index)) {
        continue;
      }
      parent.splice(index, 1);
    } else {
      delete parent[key];
    }
  }
}

export class StateSyncClient {
  private readonly onStateChanged: () => void;
  private readonly versions = new Map<ClaudeStateKey, number>();
  private readonly syncedStates: Partial<ClaudeStateByKey> = {};
  private unsubscribers: Array<() => void> = [];
  private initialized = false;

  constructor(options: StateSyncClientOptions) {
    this.onStateChanged = options.onStateChanged;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    this.unsubscribers = [
      claudeIpc.onClaudeStateSet((payload) => {
        void this.handleStateSet(payload);
      }),
      claudeIpc.onClaudeStateUpdate((payload) => {
        void this.handleStateUpdate(payload);
      }),
    ];

    const snapshot = await claudeIpc.getAllStates();
    await this.applyBootstrapSnapshot(snapshot);
    this.onStateChanged();
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];
    this.versions.clear();
    this.clearSyncedStates();
    this.initialized = false;
  }

  getState<K extends ClaudeStateKey>(key: K): ClaudeStateByKey[K] | undefined {
    const value = this.syncedStates[key];
    if (value === undefined) {
      return undefined;
    }
    return structuredClone(value) as ClaudeStateByKey[K];
  }

  private clearSyncedStates(): void {
    for (const key of CLAUDE_STATE_KEYS) {
      delete this.syncedStates[key];
    }
  }

  private async applyBootstrapSnapshot(
    snapshot: ClaudeAllStatesSnapshot,
  ): Promise<void> {
    for (const key of CLAUDE_STATE_KEYS) {
      const payload = snapshot[key];
      if (!payload) {
        await this.resyncKey(key);
        continue;
      }
      this.applyStateSet(payload);
    }
  }

  private async handleStateSet(payload: ClaudeStateSetEvent): Promise<void> {
    if (this.applyStateSet(payload)) {
      this.onStateChanged();
    }
  }

  private async handleStateUpdate(
    payload: ClaudeStateUpdateEvent,
  ): Promise<void> {
    const key = payload.key;
    if (!this.isKnownKey(key)) {
      return;
    }

    const currentVersion = this.versions.get(key);
    if (currentVersion === undefined) {
      await this.resyncKey(key);
      this.onStateChanged();
      return;
    }

    if (payload.version <= currentVersion) {
      return;
    }

    if (payload.version !== currentVersion + 1) {
      await this.resyncKey(key);
      this.onStateChanged();
      return;
    }

    const target = this.syncedStates[key];
    if (!target || (typeof target !== "object" && !Array.isArray(target))) {
      await this.resyncKey(key);
      this.onStateChanged();
      return;
    }

    try {
      applyStateOps(target as MutableContainer, payload.ops);
      this.versions.set(key, payload.version);
      this.onStateChanged();
    } catch {
      await this.resyncKey(key);
      this.onStateChanged();
    }
  }

  private applyStateSet(payload: ClaudeStateSetEvent): boolean {
    const key = payload.key;
    if (!this.isKnownKey(key)) {
      return false;
    }

    const currentVersion = this.versions.get(key);
    if (currentVersion !== undefined && payload.version < currentVersion) {
      return false;
    }

    if (key === "projects") {
      this.syncedStates.projects = structuredClone(
        payload.state as ClaudeStateByKey["projects"],
      );
    } else if (key === "sessions") {
      this.syncedStates.sessions = structuredClone(
        payload.state as ClaudeStateByKey["sessions"],
      );
    } else if (key === "activeSession") {
      this.syncedStates.activeSession = structuredClone(
        payload.state as ClaudeStateByKey["activeSession"],
      );
    }
    this.versions.set(key, payload.version);
    return true;
  }

  private async resyncKey(key: ClaudeStateKey): Promise<void> {
    const payload = await claudeIpc.getState({ key });
    this.applyStateSet(payload);
  }

  private isKnownKey(key: ClaudeStateKey): key is ClaudeStateKey {
    return CLAUDE_STATE_KEYS.includes(key);
  }
}
