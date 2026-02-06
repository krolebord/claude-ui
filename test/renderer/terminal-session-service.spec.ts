import type {
  ClaudeActiveSessionChangedEvent,
  ClaudeSessionActivityStateEvent,
  ClaudeSessionActivityWarningEvent,
  ClaudeSessionDataEvent,
  ClaudeSessionErrorEvent,
  ClaudeSessionExitEvent,
  ClaudeSessionHookEvent,
  ClaudeSessionSnapshot,
  ClaudeSessionStatusEvent,
  ClaudeSessionsSnapshot,
} from "../../src/shared/claude-types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildProjectSessionGroups,
  getSessionSidebarIndicatorState,
  getSessionTitle,
  TerminalSessionService,
} from "../../src/renderer/src/services/terminal-session-service";

const ipcHarness = vi.hoisted(() => {
  const listeners = {
    data: new Set<(payload: ClaudeSessionDataEvent) => void>(),
    exit: new Set<(payload: ClaudeSessionExitEvent) => void>(),
    error: new Set<(payload: ClaudeSessionErrorEvent) => void>(),
    status: new Set<(payload: ClaudeSessionStatusEvent) => void>(),
    activityState: new Set<(payload: ClaudeSessionActivityStateEvent) => void>(),
    activityWarning: new Set<
      (payload: ClaudeSessionActivityWarningEvent) => void
    >(),
    activeChanged: new Set<(payload: ClaudeActiveSessionChangedEvent) => void>(),
    hookEvent: new Set<(payload: ClaudeSessionHookEvent) => void>(),
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
    getSessions: vi.fn<() => Promise<ClaudeSessionsSnapshot>>(),
    startClaudeSession: vi.fn(),
    stopClaudeSession: vi.fn(),
    deleteClaudeSession: vi.fn(),
    setActiveSession: vi.fn(),
    writeToClaudeSession: vi.fn(),
    resizeClaudeSession: vi.fn(),
    onClaudeSessionData: register(listeners.data),
    onClaudeSessionExit: register(listeners.exit),
    onClaudeSessionError: register(listeners.error),
    onClaudeSessionStatus: register(listeners.status),
    onClaudeSessionActivityState: register(listeners.activityState),
    onClaudeSessionActivityWarning: register(listeners.activityWarning),
    onClaudeActiveSessionChanged: register(listeners.activeChanged),
    onClaudeSessionHookEvent: register(listeners.hookEvent),
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
    activeChanged: (payload: ClaudeActiveSessionChangedEvent) => {
      for (const callback of listeners.activeChanged) {
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

function makeSnapshot(): ClaudeSessionsSnapshot {
  return {
    activeSessionId: "session-1",
    sessions: [
      {
        sessionId: "session-1",
        cwd: "/workspace/one",
        sessionName: "Session One",
        status: "running",
        activityState: "working",
        activityWarning: null,
        lastError: null,
        createdAt: "2026-02-06T00:00:00.000Z",
      },
      {
        sessionId: "session-2",
        cwd: "/workspace/two",
        sessionName: null,
        status: "running",
        activityState: "working",
        activityWarning: null,
        lastError: null,
        createdAt: "2026-02-06T00:00:01.000Z",
      },
    ],
  };
}

function createStorageMock(initialProjects?: Array<{ path: string; collapsed: boolean }>) {
  const values = new Map<string, string>();

  if (initialProjects) {
    values.set("claude-ui.projects.v1", JSON.stringify(initialProjects));
  }

  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

function makeIndicatorSession(
  overrides?: Partial<ClaudeSessionSnapshot>,
): ClaudeSessionSnapshot {
  return {
    sessionId: "session-indicator",
    cwd: "/workspace",
    sessionName: "Indicator session",
    status: "idle",
    activityState: "idle",
    activityWarning: null,
    lastError: null,
    createdAt: "2026-02-06T00:00:00.000Z",
    ...overrides,
  };
}

describe("getSessionSidebarIndicatorState", () => {
  it("prioritizes error over activity state", () => {
    const state = getSessionSidebarIndicatorState(
      makeIndicatorSession({
        status: "error",
        activityState: "awaiting_approval",
      }),
    );

    expect(state).toBe("error");
  });

  it("maps stopped status to stopped indicator", () => {
    const state = getSessionSidebarIndicatorState(
      makeIndicatorSession({
        status: "stopped",
        activityState: "working",
      }),
    );

    expect(state).toBe("stopped");
  });

  it("maps awaiting approval activity to awaiting_approval", () => {
    const state = getSessionSidebarIndicatorState(
      makeIndicatorSession({
        status: "running",
        activityState: "awaiting_approval",
      }),
    );

    expect(state).toBe("awaiting_approval");
  });

  it("maps awaiting user response activity to awaiting_user_response", () => {
    const state = getSessionSidebarIndicatorState(
      makeIndicatorSession({
        status: "running",
        activityState: "awaiting_user_response",
      }),
    );

    expect(state).toBe("awaiting_user_response");
  });

  it("maps starting status to pending", () => {
    const state = getSessionSidebarIndicatorState(
      makeIndicatorSession({
        status: "starting",
        activityState: "idle",
      }),
    );

    expect(state).toBe("pending");
  });

  it("maps working activity to pending", () => {
    const state = getSessionSidebarIndicatorState(
      makeIndicatorSession({
        status: "running",
        activityState: "working",
      }),
    );

    expect(state).toBe("pending");
  });

  it("maps running session to running when no higher-priority state applies", () => {
    const state = getSessionSidebarIndicatorState(
      makeIndicatorSession({
        status: "running",
        activityState: "unknown",
      }),
    );

    expect(state).toBe("running");
  });

  it("falls back to idle when no higher-priority state applies", () => {
    const state = getSessionSidebarIndicatorState(
      makeIndicatorSession({
        status: "idle",
        activityState: "unknown",
      }),
    );

    expect(state).toBe("idle");
  });
});

describe("TerminalSessionService", () => {
  beforeEach(() => {
    ipcHarness.reset();
    ipcHarness.claudeIpc.getSessions.mockResolvedValue({
      sessions: [],
      activeSessionId: null,
    });
    ipcHarness.claudeIpc.selectFolder.mockResolvedValue("/workspace");
    ipcHarness.claudeIpc.stopClaudeSession.mockResolvedValue({ ok: true });
    ipcHarness.claudeIpc.deleteClaudeSession.mockResolvedValue({ ok: true });
    ipcHarness.claudeIpc.setActiveSession.mockResolvedValue(undefined);
  });

  it("hydrates initial sessions from preload including session names", async () => {
    ipcHarness.claudeIpc.getSessions.mockResolvedValueOnce(makeSnapshot());

    const service = new TerminalSessionService();
    service.retain();

    await vi.waitFor(() => {
      expect(ipcHarness.claudeIpc.getSessions).toHaveBeenCalledTimes(1);
    });

    const state = service.getSnapshot();
    expect(state.activeSessionId).toBe("session-1");
    expect(Object.keys(state.sessionsById)).toHaveLength(2);
    expect(state.sessionsById["session-1"]?.sessionName).toBe("Session One");

    service.release();
  });

  it("adds a project and persists project list", async () => {
    const storage = createStorageMock();
    const service = new TerminalSessionService({ storage });

    await service.actions.addProject();

    const state = service.getSnapshot();
    expect(state.projects).toEqual([
      {
        path: "/workspace",
        collapsed: false,
      },
    ]);
    expect(storage.setItem).toHaveBeenCalledWith(
      "claude-ui.projects.v1",
      JSON.stringify(state.projects),
    );
  });

  it("ignores duplicate projects without changing persisted list", async () => {
    const storage = createStorageMock([{ path: "/workspace", collapsed: false }]);
    const service = new TerminalSessionService({ storage });

    await service.actions.addProject();

    expect(service.getSnapshot().projects).toEqual([
      {
        path: "/workspace",
        collapsed: false,
      },
    ]);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("handles new-session dialog state transitions", () => {
    const service = new TerminalSessionService();

    service.actions.openNewSessionDialog("/workspace");
    let state = service.getSnapshot();
    expect(state.newSessionDialog).toEqual({
      open: true,
      projectPath: "/workspace",
      sessionName: "",
    });

    service.actions.setNewSessionName("Refactor runner");
    state = service.getSnapshot();
    expect(state.newSessionDialog.sessionName).toBe("Refactor runner");

    service.actions.closeNewSessionDialog();
    state = service.getSnapshot();
    expect(state.newSessionDialog).toEqual({
      open: false,
      projectPath: null,
      sessionName: "",
    });
  });

  it("confirms new session with session name without stopping the existing session", async () => {
    ipcHarness.claudeIpc.getSessions.mockResolvedValueOnce(makeSnapshot());
    ipcHarness.claudeIpc.startClaudeSession.mockResolvedValue({
      ok: true,
      sessionId: "session-3",
      snapshot: {
        activeSessionId: "session-3",
        sessions: [
          {
            sessionId: "session-1",
            cwd: "/workspace/one",
            sessionName: "Session One",
            status: "running",
            activityState: "working",
            activityWarning: null,
            lastError: null,
            createdAt: "2026-02-06T00:00:00.000Z",
          },
          {
            sessionId: "session-3",
            cwd: "/workspace",
            sessionName: "Refactor runner",
            status: "running",
            activityState: "working",
            activityWarning: null,
            lastError: null,
            createdAt: "2026-02-06T00:00:02.000Z",
          },
        ],
      },
    });

    const service = new TerminalSessionService();
    service.retain();

    await vi.waitFor(() => {
      expect(ipcHarness.claudeIpc.getSessions).toHaveBeenCalledTimes(1);
    });

    service.actions.openNewSessionDialog("/workspace");
    service.actions.setNewSessionName("Refactor runner");
    await service.actions.confirmNewSession({ cols: 80, rows: 24 });

    expect(ipcHarness.claudeIpc.stopClaudeSession).not.toHaveBeenCalled();
    expect(ipcHarness.claudeIpc.startClaudeSession).toHaveBeenCalledWith({
      cwd: "/workspace",
      sessionName: "Refactor runner",
      cols: 80,
      rows: 24,
    });

    expect(service.getSnapshot().activeSessionId).toBe("session-3");
    service.release();
  });

  it("sorts sessions newest-first inside each project group", () => {
    const sessionsById: Record<string, ClaudeSessionSnapshot> = {
      "session-1": {
        sessionId: "session-1",
        cwd: "/workspace",
        sessionName: null,
        status: "running",
        activityState: "working",
        activityWarning: null,
        lastError: null,
        createdAt: "2026-02-06T00:00:00.000Z",
      },
      "session-2": {
        sessionId: "session-2",
        cwd: "/workspace",
        sessionName: "new",
        status: "running",
        activityState: "working",
        activityWarning: null,
        lastError: null,
        createdAt: "2026-02-06T00:00:01.000Z",
      },
      "session-3": {
        sessionId: "session-3",
        cwd: "/not-listed",
        sessionName: null,
        status: "running",
        activityState: "working",
        activityWarning: null,
        lastError: null,
        createdAt: "2026-02-06T00:00:02.000Z",
      },
    };

    const groups = buildProjectSessionGroups({
      projects: [{ path: "/workspace", collapsed: false }],
      sessionsById,
    });

    expect(groups).toHaveLength(2);
    expect(groups[0]?.path).toBe("/workspace");
    expect(groups[0]?.sessions.map((session) => session.sessionId)).toEqual([
      "session-2",
      "session-1",
    ]);
    expect(groups[1]?.path).toBe("/not-listed");
  });

  it("stops a specific session by id", async () => {
    ipcHarness.claudeIpc.getSessions.mockResolvedValueOnce(makeSnapshot());

    const service = new TerminalSessionService();
    service.retain();

    await vi.waitFor(() => {
      expect(ipcHarness.claudeIpc.getSessions).toHaveBeenCalledTimes(1);
    });

    await service.actions.stopSession("session-2");

    expect(ipcHarness.claudeIpc.stopClaudeSession).toHaveBeenCalledWith({
      sessionId: "session-2",
    });

    service.release();
  });

  it("deletes a specific session and refreshes sessions", async () => {
    ipcHarness.claudeIpc.getSessions
      .mockResolvedValueOnce(makeSnapshot())
      .mockResolvedValueOnce({
        activeSessionId: "session-1",
        sessions: [
          {
            sessionId: "session-1",
            cwd: "/workspace/one",
            sessionName: "Session One",
            status: "running",
            activityState: "working",
            activityWarning: null,
            lastError: null,
            createdAt: "2026-02-06T00:00:00.000Z",
          },
        ],
      });

    const service = new TerminalSessionService();
    service.retain();

    await vi.waitFor(() => {
      expect(ipcHarness.claudeIpc.getSessions).toHaveBeenCalledTimes(1);
    });

    await service.actions.deleteSession("session-2");

    expect(ipcHarness.claudeIpc.deleteClaudeSession).toHaveBeenCalledWith({
      sessionId: "session-2",
    });

    await vi.waitFor(() => {
      expect(ipcHarness.claudeIpc.getSessions).toHaveBeenCalledTimes(2);
    });
    expect(service.getSnapshot().sessionsById["session-2"]).toBeUndefined();

    service.release();
  });

  it("forwards terminal chunks only from the active session", async () => {
    ipcHarness.claudeIpc.getSessions.mockResolvedValueOnce(makeSnapshot());

    const service = new TerminalSessionService();
    service.retain();

    await vi.waitFor(() => {
      expect(ipcHarness.claudeIpc.getSessions).toHaveBeenCalledTimes(1);
    });

    const terminalWrite = vi.fn();
    service.actions.attachTerminal({
      write: terminalWrite,
      clear: vi.fn(),
      getSize: () => ({ cols: 80, rows: 24 }),
    });

    ipcHarness.emit.sessionData({ sessionId: "session-2", chunk: "ignored" });
    ipcHarness.emit.sessionData({ sessionId: "session-1", chunk: "visible" });

    expect(terminalWrite).toHaveBeenCalledTimes(1);
    expect(terminalWrite).toHaveBeenCalledWith("visible");

    service.release();
  });

  it("switches active session only after active-session event and replays once", async () => {
    ipcHarness.claudeIpc.getSessions.mockResolvedValueOnce(makeSnapshot());

    const service = new TerminalSessionService();
    service.retain();

    await vi.waitFor(() => {
      expect(ipcHarness.claudeIpc.getSessions).toHaveBeenCalledTimes(1);
    });

    const terminalWrite = vi.fn();
    const terminalClear = vi.fn();
    service.actions.attachTerminal({
      write: terminalWrite,
      clear: terminalClear,
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

    ipcHarness.emit.activeChanged({ activeSessionId: "session-2" });
    expect(service.getSnapshot().activeSessionId).toBe("session-2");
    expect(terminalClear).toHaveBeenCalledTimes(2);
    expect(terminalWrite).toHaveBeenCalledTimes(1);
    expect(terminalWrite).toHaveBeenCalledWith("buffered output");

    ipcHarness.emit.sessionData({
      sessionId: "session-2",
      chunk: "visible after switch",
    });
    expect(terminalWrite).toHaveBeenCalledTimes(2);
    expect(terminalWrite).toHaveBeenLastCalledWith("visible after switch");

    ipcHarness.emit.activeChanged({ activeSessionId: "session-2" });
    expect(terminalWrite).toHaveBeenCalledTimes(2);

    expect(terminalClear).toHaveBeenCalledTimes(2);

    service.release();
  });

  it("uses fallback label when session name is blank", () => {
    expect(
      getSessionTitle({
        sessionId: "session-abcdef12",
        cwd: "/workspace",
        sessionName: " ",
        status: "running",
        activityState: "working",
        activityWarning: null,
        lastError: null,
        createdAt: "2026-02-06T00:00:00.000Z",
      }),
    ).toBe("Session session-");
  });

  it("keeps errors scoped per session and sets ui error for active session", async () => {
    ipcHarness.claudeIpc.getSessions.mockResolvedValueOnce(makeSnapshot());

    const service = new TerminalSessionService();
    service.retain();

    await vi.waitFor(() => {
      expect(ipcHarness.claudeIpc.getSessions).toHaveBeenCalledTimes(1);
    });

    ipcHarness.emit.sessionError({
      sessionId: "session-2",
      message: "background session failed",
    });

    let state = service.getSnapshot();
    expect(state.sessionsById["session-2"]?.lastError).toBe(
      "background session failed",
    );
    expect(state.errorMessage).toBe("");

    ipcHarness.emit.sessionError({
      sessionId: "session-1",
      message: "active session failed",
    });

    state = service.getSnapshot();
    expect(state.sessionsById["session-1"]?.lastError).toBe(
      "active session failed",
    );
    expect(state.errorMessage).toBe("active session failed");

    service.release();
  });
});
