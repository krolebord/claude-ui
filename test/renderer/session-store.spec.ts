import type {
  ClaudeAllStatesSnapshot,
  ClaudeSessionDataEvent,
  ClaudeSessionErrorEvent,
  ClaudeStateSetEvent,
  ClaudeStateUpdateEvent,
  ClaudeUsageResult,
} from "../../src/shared/claude-types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionStore } from "../../src/renderer/src/services/session-store";

const ipcHarness = vi.hoisted(() => {
  const listeners = {
    data: new Set<(payload: ClaudeSessionDataEvent) => void>(),
    error: new Set<(payload: ClaudeSessionErrorEvent) => void>(),
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
    selectFolder: vi.fn<() => Promise<string | null>>(),
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
    onClaudeSessionData: register(listeners.data),
    onClaudeSessionError: register(listeners.error),
    onClaudeStateSet: register(listeners.stateSet),
    onClaudeStateUpdate: register(listeners.stateUpdate),
    onClaudeSessionExit: vi.fn(),
    getUsage: vi.fn<() => Promise<ClaudeUsageResult>>(),
    openLogFolder: vi.fn(),
    openStatePluginFolder: vi.fn(),
    openSessionFilesFolder: vi.fn(),
  };

  const emit = {
    sessionData: (payload: ClaudeSessionDataEvent) => {
      for (const callback of listeners.data) {
        callback(payload);
      }
    },
    sessionError: (payload: ClaudeSessionErrorEvent) => {
      for (const callback of listeners.error) {
        callback(payload);
      }
    },
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

function makeAllStatesSnapshot(): ClaudeAllStatesSnapshot {
  return {
    projects: {
      key: "projects",
      version: 0,
      state: [],
    },
    sessions: {
      key: "sessions",
      version: 0,
      state: {
        "session-1": {
          sessionId: "session-1",
          cwd: "/workspace/one",
          sessionName: "Session One",
          status: "running",
          activityState: "working",
          activityWarning: null,
          lastError: null,
          createdAt: "2026-02-06T00:00:00.000Z",
          lastActivityAt: "2026-02-06T00:00:00.000Z",
        },
        "session-2": {
          sessionId: "session-2",
          cwd: "/workspace/two",
          sessionName: null,
          permissionMode: "yolo",
          status: "stopped",
          activityState: "idle",
          activityWarning: null,
          lastError: null,
          createdAt: "2026-02-06T00:00:01.000Z",
          lastActivityAt: "2026-02-06T00:00:01.000Z",
        },
      },
    },
    activeSession: {
      key: "activeSession",
      version: 0,
      state: {
        activeSessionId: "session-1",
      },
    },
  };
}

async function waitForStoreReady(service: SessionStore): Promise<void> {
  await vi.waitFor(() => {
    expect(service.getSnapshot().activeSessionId).toBe("session-1");
  });
}

describe("SessionStore", () => {
  beforeEach(() => {
    ipcHarness.reset();
    ipcHarness.claudeIpc.getAllStates.mockResolvedValue(makeAllStatesSnapshot());
    ipcHarness.claudeIpc.selectFolder.mockResolvedValue("/workspace");
    ipcHarness.claudeIpc.addClaudeProject.mockResolvedValue(undefined);
    ipcHarness.claudeIpc.setClaudeProjectCollapsed.mockResolvedValue(undefined);
    ipcHarness.claudeIpc.setClaudeProjectDefaults.mockResolvedValue(undefined);
    ipcHarness.claudeIpc.startClaudeSession.mockResolvedValue({
      ok: true,
      sessionId: "session-3",
    });
    ipcHarness.claudeIpc.stopClaudeSession.mockResolvedValue(undefined);
    ipcHarness.claudeIpc.deleteClaudeSession.mockResolvedValue(undefined);
    ipcHarness.claudeIpc.deleteClaudeProject.mockResolvedValue(undefined);
    ipcHarness.claudeIpc.setActiveSession.mockResolvedValue(undefined);
    ipcHarness.claudeIpc.getState.mockResolvedValue({
      key: "projects",
      version: 1,
      state: [],
    });
  });

  it("hydrates initial state from getAllStates", async () => {
    const service = new SessionStore();
    service.retain();

    await waitForStoreReady(service);

    const state = service.getSnapshot();
    expect(state.activeSessionId).toBe("session-1");
    expect(Object.keys(state.sessionsById)).toEqual(["session-1", "session-2"]);
    expect(state.sessionsById["session-1"]?.sessionName).toBe("Session One");

    service.release();
  });

  it("adds a project through command IPC and applies project state via state-set", async () => {
    const service = new SessionStore();
    service.retain();
    await waitForStoreReady(service);

    await service.actions.addProject();
    expect(ipcHarness.claudeIpc.addClaudeProject).toHaveBeenCalledWith({
      path: "/workspace",
    });

    ipcHarness.emit.stateSet({
      key: "projects",
      version: 1,
      state: [{ path: "/workspace", collapsed: false }],
    });

    expect(service.getSnapshot().projects).toEqual([
      { path: "/workspace", collapsed: false },
    ]);

    service.release();
  });

  it("resumes a stopped session with its original permissionMode", async () => {
    const service = new SessionStore();
    service.retain();
    await waitForStoreReady(service);

    await service.actions.resumeSession("session-2", { cols: 132, rows: 44 });

    expect(ipcHarness.claudeIpc.startClaudeSession).toHaveBeenCalledWith({
      cwd: "/workspace/two",
      cols: 132,
      rows: 44,
      resumeSessionId: "session-2",
      permissionMode: "yolo",
    });
    service.release();
  });

  it("forwards terminal chunks only from the active session", async () => {
    const service = new SessionStore();
    service.retain();
    await waitForStoreReady(service);

    const terminalWrite = vi.fn();
    service.actions.attachTerminal({
      write: terminalWrite,
      clear: vi.fn(),
      focus: vi.fn(),
      getSize: () => ({ cols: 80, rows: 24 }),
    });

    ipcHarness.emit.sessionData({ sessionId: "session-2", chunk: "ignored" });
    ipcHarness.emit.sessionData({ sessionId: "session-1", chunk: "visible" });

    expect(terminalWrite).toHaveBeenCalledTimes(1);
    expect(terminalWrite).toHaveBeenCalledWith("visible");
    service.release();
  });

  it("switches active session only after state-set and replays buffered output once", async () => {
    const service = new SessionStore();
    service.retain();
    await waitForStoreReady(service);

    const terminalWrite = vi.fn();
    const terminalClear = vi.fn();
    const terminalFocus = vi.fn();
    service.actions.attachTerminal({
      write: terminalWrite,
      clear: terminalClear,
      focus: terminalFocus,
      getSize: () => ({ cols: 80, rows: 24 }),
    });

    ipcHarness.emit.sessionData({
      sessionId: "session-2",
      chunk: "buffered output",
    });

    await service.actions.setActiveSession("session-2");

    expect(ipcHarness.claudeIpc.setActiveSession).toHaveBeenCalledWith({
      sessionId: "session-2",
    });
    expect(service.getSnapshot().activeSessionId).toBe("session-1");
    expect(terminalWrite).not.toHaveBeenCalled();
    expect(terminalClear).toHaveBeenCalledTimes(1);
    expect(terminalFocus).not.toHaveBeenCalled();

    ipcHarness.emit.stateSet({
      key: "activeSession",
      version: 1,
      state: { activeSessionId: "session-2" },
    });

    expect(service.getSnapshot().activeSessionId).toBe("session-2");
    expect(terminalClear).toHaveBeenCalledTimes(2);
    expect(terminalWrite).toHaveBeenCalledTimes(1);
    expect(terminalWrite).toHaveBeenCalledWith("buffered output");
    expect(terminalFocus).toHaveBeenCalledTimes(1);
    service.release();
  });

  it("replays only the retained 10,000 lines for inactive session buffers", async () => {
    const maxLines = 10_000;
    const service = new SessionStore();
    service.retain();
    await waitForStoreReady(service);

    const terminalWrite = vi.fn();
    service.actions.attachTerminal({
      write: terminalWrite,
      clear: vi.fn(),
      focus: vi.fn(),
      getSize: () => ({ cols: 80, rows: 24 }),
    });

    const largeLineChunk = Array.from(
      { length: maxLines + 5 },
      (_, index) => `line-${index}\n`,
    ).join("");

    ipcHarness.emit.sessionData({
      sessionId: "session-2",
      chunk: largeLineChunk,
    });

    ipcHarness.emit.stateSet({
      key: "activeSession",
      version: 1,
      state: { activeSessionId: "session-2" },
    });

    expect(terminalWrite).toHaveBeenCalledTimes(1);
    const replayed = terminalWrite.mock.calls[0]?.[0];
    expect(typeof replayed).toBe("string");
    if (typeof replayed !== "string") {
      throw new Error("Expected replayed terminal output to be a string.");
    }

    const replayedLines = replayed.split("\n");
    expect(replayedLines).toHaveLength(maxLines + 1);
    expect(replayedLines[0]).toBe("line-5");
    expect(replayedLines[maxLines - 1]).toBe("line-10004");
    service.release();
  });

  it("sets UI error message only when session error belongs to active session", async () => {
    const service = new SessionStore();
    service.retain();
    await waitForStoreReady(service);

    ipcHarness.emit.sessionError({
      sessionId: "session-2",
      message: "background session failed",
    });
    expect(service.getSnapshot().errorMessage).toBe("");

    ipcHarness.emit.sessionError({
      sessionId: "session-1",
      message: "active session failed",
    });
    expect(service.getSnapshot().errorMessage).toBe("active session failed");
    service.release();
  });
});
