import type {
  ClaudeAllStatesSnapshot,
  ClaudeStateSetEvent,
  ClaudeStateUpdateEvent,
  ClaudeUsageResult,
} from "../../src/shared/claude-types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StateSyncClient } from "../../src/renderer/src/services/state-sync-client";

const ipcHarness = vi.hoisted(() => {
  const listeners = {
    stateSet: new Set<(payload: ClaudeStateSetEvent) => void>(),
    stateUpdate: new Set<(payload: ClaudeStateUpdateEvent) => void>(),
  };

  const register = <T>(bucket: Set<(payload: T) => void>) =>
    vi.fn((callback: (payload: T) => void) => {
      bucket.add(callback);
      return () => {
        bucket.delete(callback);
      };
    });

  const claudeIpc = {
    selectFolder: vi.fn(),
    getAllStates: vi.fn<() => Promise<ClaudeAllStatesSnapshot>>(),
    getState: vi.fn<() => Promise<ClaudeStateSetEvent>>(),
    addClaudeProject: vi.fn(),
    setClaudeProjectCollapsed: vi.fn(),
    setClaudeProjectDefaults: vi.fn(),
    startClaudeSession: vi.fn(),
    stopClaudeSession: vi.fn(),
    deleteClaudeProject: vi.fn(),
    deleteClaudeSession: vi.fn(),
    setActiveSession: vi.fn(),
    writeToClaudeSession: vi.fn(),
    resizeClaudeSession: vi.fn(),
    onClaudeSessionData: vi.fn(),
    onClaudeStateSet: register(listeners.stateSet),
    onClaudeStateUpdate: register(listeners.stateUpdate),
    onClaudeSessionExit: vi.fn(),
    onClaudeSessionError: vi.fn(),
    getUsage: vi.fn<() => Promise<ClaudeUsageResult>>(),
    openLogFolder: vi.fn(),
    openStatePluginFolder: vi.fn(),
    openSessionFilesFolder: vi.fn(),
  };

  const emit = {
    stateSet: (payload: ClaudeStateSetEvent) => {
      for (const callback of listeners.stateSet) {
        callback(payload);
      }
    },
    stateUpdate: (payload: ClaudeStateUpdateEvent) => {
      for (const callback of listeners.stateUpdate) {
        callback(payload);
      }
    },
  };

  const reset = () => {
    vi.clearAllMocks();
    Object.values(listeners).forEach((bucket) => bucket.clear());
  };

  return { claudeIpc, emit, reset };
});

vi.mock("@renderer/lib/ipc", () => ({
  claudeIpc: ipcHarness.claudeIpc,
}));

function createAllStates(): ClaudeAllStatesSnapshot {
  return {
    projects: {
      key: "projects",
      version: 0,
      state: [],
    },
    sessions: {
      key: "sessions",
      version: 0,
      state: {},
    },
    activeSession: {
      key: "activeSession",
      version: 0,
      state: { activeSessionId: null },
    },
  };
}

describe("StateSyncClient", () => {
  beforeEach(() => {
    ipcHarness.reset();
    ipcHarness.claudeIpc.getAllStates.mockResolvedValue(createAllStates());
    ipcHarness.claudeIpc.getState.mockResolvedValue({
      key: "projects",
      version: 0,
      state: [],
    });
  });

  it("bootstraps by hydrating all required keys", async () => {
    const onStateChanged = vi.fn();
    const client = new StateSyncClient({ onStateChanged });

    await client.initialize();

    expect(ipcHarness.claudeIpc.getAllStates).toHaveBeenCalledTimes(1);
    expect(onStateChanged).toHaveBeenCalledTimes(1);
    expect(client.getState("activeSession")?.activeSessionId).toBeNull();
  });

  it("replays incremental ops when versions are contiguous", async () => {
    const client = new StateSyncClient({ onStateChanged: vi.fn() });
    await client.initialize();

    ipcHarness.emit.stateUpdate({
      key: "projects",
      version: 1,
      ops: [
        [
          "set",
          ["0"],
          { path: "/workspace", collapsed: false },
          undefined,
        ],
      ],
    });

    await vi.waitFor(() => {
      expect(client.getState("projects")).toEqual([
        { path: "/workspace", collapsed: false },
      ]);
    });
  });

  it("requests keyed full-state resync on version gaps", async () => {
    ipcHarness.claudeIpc.getState.mockResolvedValueOnce({
      key: "projects",
      version: 3,
      state: [{ path: "/resynced", collapsed: false }],
    });

    const client = new StateSyncClient({ onStateChanged: vi.fn() });
    await client.initialize();

    ipcHarness.emit.stateUpdate({
      key: "projects",
      version: 2,
      ops: [
        [
          "set",
          ["0"],
          { path: "/gap", collapsed: false },
          undefined,
        ],
      ],
    });

    await vi.waitFor(() => {
      expect(ipcHarness.claudeIpc.getState).toHaveBeenCalledWith({
        key: "projects",
      });
    });
    expect(client.getState("projects")).toEqual([
      { path: "/resynced", collapsed: false },
    ]);
  });

  it("ignores stale bootstrap state after a newer pre-bootstrap resync", async () => {
    let resolveBootstrap: ((snapshot: ClaudeAllStatesSnapshot) => void) | null =
      null;
    const bootstrapPromise = new Promise<ClaudeAllStatesSnapshot>((resolve) => {
      resolveBootstrap = resolve;
    });
    ipcHarness.claudeIpc.getAllStates.mockReturnValueOnce(bootstrapPromise);
    ipcHarness.claudeIpc.getState.mockResolvedValueOnce({
      key: "projects",
      version: 2,
      state: [{ path: "/newer", collapsed: false }],
    });

    const client = new StateSyncClient({ onStateChanged: vi.fn() });
    const initializePromise = client.initialize();

    ipcHarness.emit.stateUpdate({
      key: "projects",
      version: 1,
      ops: [
        [
          "set",
          ["0"],
          { path: "/from-op", collapsed: false },
          undefined,
        ],
      ],
    });

    await vi.waitFor(() => {
      expect(ipcHarness.claudeIpc.getState).toHaveBeenCalledWith({
        key: "projects",
      });
    });
    expect(client.getState("projects")).toEqual([
      { path: "/newer", collapsed: false },
    ]);

    if (!resolveBootstrap) {
      throw new Error("Expected bootstrap resolver to be initialized.");
    }

    resolveBootstrap({
      projects: {
        key: "projects",
        version: 0,
        state: [{ path: "/stale", collapsed: false }],
      },
      sessions: {
        key: "sessions",
        version: 0,
        state: {},
      },
      activeSession: {
        key: "activeSession",
        version: 0,
        state: { activeSessionId: null },
      },
    });

    await initializePromise;
    expect(client.getState("projects")).toEqual([
      { path: "/newer", collapsed: false },
    ]);
  });
});

