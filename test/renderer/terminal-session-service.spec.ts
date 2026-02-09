import type {
  ClaudeActiveSessionChangedEvent,
  ClaudeProject,
  ClaudeSessionDataEvent,
  ClaudeSessionErrorEvent,
  ClaudeSessionExitEvent,
  ClaudeSessionSnapshot,
  ClaudeSessionUpdatedEvent,
  ClaudeSessionsSnapshot,
} from "../../src/shared/claude-types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TerminalSessionService,
} from "../../src/renderer/src/services/terminal-session-service";
import {
  buildProjectSessionGroups,
  getSessionLastActivityLabel,
  getSessionSidebarIndicatorState,
  getSessionTitle,
} from "../../src/renderer/src/services/terminal-session-selectors";

const ipcHarness = vi.hoisted(() => {
  const listeners = {
    data: new Set<(payload: ClaudeSessionDataEvent) => void>(),
    exit: new Set<(payload: ClaudeSessionExitEvent) => void>(),
    error: new Set<(payload: ClaudeSessionErrorEvent) => void>(),
    sessionUpdated: new Set<(payload: ClaudeSessionUpdatedEvent) => void>(),
    activeChanged: new Set<
      (payload: ClaudeActiveSessionChangedEvent) => void
    >(),
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
    addClaudeProject: vi.fn(),
    setClaudeProjectCollapsed: vi.fn(),
    startClaudeSession: vi.fn(),
    stopClaudeSession: vi.fn(),
    deleteClaudeSession: vi.fn(),
    setActiveSession: vi.fn(),
    writeToClaudeSession: vi.fn(),
    resizeClaudeSession: vi.fn(),
    onClaudeSessionData: register(listeners.data),
    onClaudeSessionExit: register(listeners.exit),
    onClaudeSessionError: register(listeners.error),
    onClaudeSessionUpdated: register(listeners.sessionUpdated),
    onClaudeActiveSessionChanged: register(listeners.activeChanged),
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
    projects: [],
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
        lastActivityAt: "2026-02-06T00:00:00.000Z",
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
        lastActivityAt: "2026-02-06T00:00:01.000Z",
      },
    ],
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
    lastActivityAt: "2026-02-06T00:00:00.000Z",
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

  it("maps starting status to loading", () => {
    const state = getSessionSidebarIndicatorState(
      makeIndicatorSession({
        status: "starting",
        activityState: "idle",
      }),
    );

    expect(state).toBe("loading");
  });

  it("maps isLoading flag to loading regardless of session state", () => {
    const state = getSessionSidebarIndicatorState(
      makeIndicatorSession({
        status: "running",
        activityState: "working",
      }),
      { isLoading: true },
    );

    expect(state).toBe("loading");
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

describe("getSessionLastActivityLabel", () => {
  it("formats minute and hour deltas with short labels", () => {
    const now = Date.parse("2026-02-06T01:00:00.000Z");

    expect(
      getSessionLastActivityLabel(
        makeIndicatorSession({
          lastActivityAt: "2026-02-06T00:56:00.000Z",
        }),
        now,
      ),
    ).toBe("4m");

    expect(
      getSessionLastActivityLabel(
        makeIndicatorSession({
          lastActivityAt: "2026-02-06T00:00:00.000Z",
        }),
        now,
      ),
    ).toBe("1h");
  });

  it("returns seconds for very recent activity", () => {
    const now = Date.parse("2026-02-06T01:00:30.000Z");
    const label = getSessionLastActivityLabel(
      makeIndicatorSession({
        lastActivityAt: "2026-02-06T01:00:00.000Z",
      }),
      now,
    );

    expect(label).toBe("30s");
  });

  it("rounds recent activity seconds to 10-second increments", () => {
    const now = Date.parse("2026-02-06T01:00:36.000Z");
    const label = getSessionLastActivityLabel(
      makeIndicatorSession({
        lastActivityAt: "2026-02-06T01:00:00.000Z",
      }),
      now,
    );

    expect(label).toBe("40s");
  });

  it("shows now when rounded seconds is zero", () => {
    const now = Date.parse("2026-02-06T01:00:04.000Z");
    const label = getSessionLastActivityLabel(
      makeIndicatorSession({
        lastActivityAt: "2026-02-06T01:00:00.000Z",
      }),
      now,
    );

    expect(label).toBe("now");
  });

  it("uses month labels for sub-year gaps", () => {
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    const lastActivityAt = new Date(
      now - 360 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const label = getSessionLastActivityLabel(
      makeIndicatorSession({
        lastActivityAt,
      }),
      now,
    );

    expect(label).toBe("12mo");
  });
});

describe("TerminalSessionService", () => {
  beforeEach(() => {
    ipcHarness.reset();
    ipcHarness.claudeIpc.getSessions.mockResolvedValue({
      projects: [],
      sessions: [],
      activeSessionId: null,
    });
    ipcHarness.claudeIpc.addClaudeProject.mockImplementation(
      async ({ path }: { path: string }) => ({
        projects: [{ path, collapsed: false }],
        sessions: [],
        activeSessionId: null,
      }),
    );
    ipcHarness.claudeIpc.setClaudeProjectCollapsed.mockImplementation(
      async ({ path, collapsed }: { path: string; collapsed: boolean }) => ({
        projects: [{ path, collapsed }],
        sessions: [],
        activeSessionId: null,
      }),
    );
    ipcHarness.claudeIpc.selectFolder.mockResolvedValue("/workspace");
    ipcHarness.claudeIpc.stopClaudeSession.mockResolvedValue(undefined);
    ipcHarness.claudeIpc.deleteClaudeSession.mockResolvedValue(undefined);
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

  it("adds a project through IPC and refreshes state from snapshot", async () => {
    const service = new TerminalSessionService();

    await service.actions.addProject();

    const state = service.getSnapshot();
    expect(ipcHarness.claudeIpc.addClaudeProject).toHaveBeenCalledWith({
      path: "/workspace",
    });
    expect(state.projects).toEqual([
      {
        path: "/workspace",
        collapsed: false,
      },
    ]);
  });

  it("ignores duplicate projects without calling add-project IPC", async () => {
    const existingProjects: ClaudeProject[] = [
      {
        path: "/workspace",
        collapsed: false,
      },
    ];
    ipcHarness.claudeIpc.getSessions.mockResolvedValueOnce({
      projects: existingProjects,
      sessions: [],
      activeSessionId: null,
    });
    const service = new TerminalSessionService();
    service.retain();

    await vi.waitFor(() => {
      expect(ipcHarness.claudeIpc.getSessions).toHaveBeenCalledTimes(1);
    });

    await service.actions.addProject();

    expect(service.getSnapshot().projects).toEqual(existingProjects);
    expect(ipcHarness.claudeIpc.addClaudeProject).not.toHaveBeenCalled();

    service.release();
  });

  it("toggles project collapsed state through IPC", async () => {
    ipcHarness.claudeIpc.getSessions.mockResolvedValueOnce({
      projects: [
        {
          path: "/workspace",
          collapsed: false,
        },
      ],
      sessions: [],
      activeSessionId: null,
    });
    ipcHarness.claudeIpc.setClaudeProjectCollapsed.mockResolvedValueOnce({
      projects: [
        {
          path: "/workspace",
          collapsed: true,
        },
      ],
      sessions: [],
      activeSessionId: null,
    });
    const service = new TerminalSessionService();
    service.retain();

    await vi.waitFor(() => {
      expect(ipcHarness.claudeIpc.getSessions).toHaveBeenCalledTimes(1);
    });

    await service.actions.toggleProjectCollapsed("/workspace");

    expect(ipcHarness.claudeIpc.setClaudeProjectCollapsed).toHaveBeenCalledWith(
      {
        path: "/workspace",
        collapsed: true,
      },
    );
    expect(service.getSnapshot().projects).toEqual([
      {
        path: "/workspace",
        collapsed: true,
      },
    ]);

    service.release();
  });

  it("handles new-session dialog state transitions", () => {
    const service = new TerminalSessionService();

    service.actions.openNewSessionDialog("/workspace");
    let state = service.getSnapshot();
    expect(state.newSessionDialog).toEqual({
      open: true,
      projectPath: "/workspace",
      initialPrompt: "",
      sessionName: "",
      model: "opus",
      permissionMode: "default",
    });

    service.actions.updateNewSessionDialog("initialPrompt", "fix the bug");
    state = service.getSnapshot();
    expect(state.newSessionDialog.initialPrompt).toBe("fix the bug");

    service.actions.updateNewSessionDialog("sessionName", "Refactor runner");
    state = service.getSnapshot();
    expect(state.newSessionDialog.sessionName).toBe("Refactor runner");

    service.actions.updateNewSessionDialog("model", "haiku");
    state = service.getSnapshot();
    expect(state.newSessionDialog.model).toBe("haiku");

    service.actions.closeNewSessionDialog();
    state = service.getSnapshot();
    expect(state.newSessionDialog).toEqual({
      open: false,
      projectPath: null,
      initialPrompt: "",
      sessionName: "",
      model: "opus",
      permissionMode: "default",
    });
  });

  it("applies snapshot, clears terminal, focuses, and resets dialog on newSessionStarted", async () => {
    ipcHarness.claudeIpc.getSessions.mockResolvedValueOnce(makeSnapshot());

    const service = new TerminalSessionService();
    service.retain();

    await vi.waitFor(() => {
      expect(ipcHarness.claudeIpc.getSessions).toHaveBeenCalledTimes(1);
    });

    service.actions.openNewSessionDialog("/workspace");

    const terminalClear = vi.fn();
    const terminalFocus = vi.fn();
    service.actions.attachTerminal({
      write: vi.fn(),
      clear: terminalClear,
      focus: terminalFocus,
      getSize: () => ({ cols: 80, rows: 24 }),
    });

    service.actions.newSessionStarted({
      projects: [],
      activeSessionId: "session-3",
      sessions: [
        {
          sessionId: "session-3",
          cwd: "/workspace",
          sessionName: "Refactor runner",
          status: "running",
          activityState: "working",
          activityWarning: null,
          lastError: null,
          createdAt: "2026-02-06T00:00:02.000Z",
          lastActivityAt: "2026-02-06T00:00:02.000Z",
        },
      ],
    });

    const state = service.getSnapshot();
    expect(state.activeSessionId).toBe("session-3");
    expect(state.newSessionDialog.open).toBe(false);
    expect(terminalClear).toHaveBeenCalled();
    expect(terminalFocus).toHaveBeenCalledTimes(1);

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
        lastActivityAt: "2026-02-06T00:00:00.000Z",
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
        lastActivityAt: "2026-02-06T00:00:01.000Z",
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
        lastActivityAt: "2026-02-06T00:00:02.000Z",
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

  it("resumes a stopped session by passing resumeSessionId through start IPC", async () => {
    ipcHarness.claudeIpc.getSessions.mockResolvedValueOnce({
      projects: [],
      activeSessionId: "session-2",
      sessions: [
        {
          sessionId: "session-2",
          cwd: "/workspace/two",
          sessionName: null,
          status: "stopped",
          activityState: "idle",
          activityWarning: null,
          lastError: null,
          createdAt: "2026-02-06T00:00:01.000Z",
          lastActivityAt: "2026-02-06T00:00:01.000Z",
        },
      ],
    });
    ipcHarness.claudeIpc.startClaudeSession.mockResolvedValueOnce({
      ok: true,
      sessionId: "session-2",
      snapshot: {
        projects: [],
        activeSessionId: "session-2",
        sessions: [
          {
            sessionId: "session-2",
            cwd: "/workspace/two",
            sessionName: null,
            status: "running",
            activityState: "working",
            activityWarning: null,
            lastError: null,
            createdAt: "2026-02-06T00:00:01.000Z",
            lastActivityAt: "2026-02-06T00:00:01.000Z",
          },
        ],
      },
    });

    const service = new TerminalSessionService();
    service.retain();

    await vi.waitFor(() => {
      expect(ipcHarness.claudeIpc.getSessions).toHaveBeenCalledTimes(1);
    });

    await service.actions.resumeSession("session-2", { cols: 132, rows: 44 });

    expect(ipcHarness.claudeIpc.startClaudeSession).toHaveBeenCalledWith({
      cwd: "/workspace/two",
      cols: 132,
      rows: 44,
      resumeSessionId: "session-2",
    });

    service.release();
  });

  it("resumes a stopped session with its original permissionMode", async () => {
    ipcHarness.claudeIpc.getSessions.mockResolvedValueOnce({
      projects: [],
      activeSessionId: "session-2",
      sessions: [
        {
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
      ],
    });
    ipcHarness.claudeIpc.startClaudeSession.mockResolvedValueOnce({
      ok: true,
      sessionId: "session-2",
      snapshot: {
        projects: [],
        activeSessionId: "session-2",
        sessions: [
          {
            sessionId: "session-2",
            cwd: "/workspace/two",
            sessionName: null,
            permissionMode: "yolo",
            status: "running",
            activityState: "working",
            activityWarning: null,
            lastError: null,
            createdAt: "2026-02-06T00:00:01.000Z",
            lastActivityAt: "2026-02-06T00:00:01.000Z",
          },
        ],
      },
    });

    const service = new TerminalSessionService();
    service.retain();

    await vi.waitFor(() => {
      expect(ipcHarness.claudeIpc.getSessions).toHaveBeenCalledTimes(1);
    });

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

  it("deletes a specific session and refreshes sessions", async () => {
    ipcHarness.claudeIpc.getSessions
      .mockResolvedValueOnce(makeSnapshot())
      .mockResolvedValueOnce({
        projects: [],
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
            lastActivityAt: "2026-02-06T00:00:00.000Z",
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
      focus: vi.fn(),
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

    ipcHarness.emit.activeChanged({ activeSessionId: "session-2" });
    expect(service.getSnapshot().activeSessionId).toBe("session-2");
    expect(terminalClear).toHaveBeenCalledTimes(2);
    expect(terminalWrite).toHaveBeenCalledTimes(1);
    expect(terminalWrite).toHaveBeenCalledWith("buffered output");
    expect(terminalFocus).toHaveBeenCalledTimes(1);

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

  it("replays only the retained 10,000 lines when activating an inactive session", async () => {
    const maxLines = 10_000;
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

    expect(terminalWrite).not.toHaveBeenCalled();

    ipcHarness.emit.activeChanged({ activeSessionId: "session-2" });

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
    expect(replayed).not.toContain("line-0\n");
    expect(replayed.endsWith("line-10004\n")).toBe(true);

    service.release();
  });

  it("replays only the retained 2MB byte suffix when activating an inactive session", async () => {
    const maxBytes = 2 * 1024 * 1024;
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
      focus: vi.fn(),
      getSize: () => ({ cols: 80, rows: 24 }),
    });

    const token = "0123456789abcdef";
    const oversizedChunk = token.repeat(
      Math.ceil((maxBytes + token.length) / token.length),
    );

    ipcHarness.emit.sessionData({
      sessionId: "session-2",
      chunk: oversizedChunk,
    });

    ipcHarness.emit.activeChanged({ activeSessionId: "session-2" });

    expect(terminalWrite).toHaveBeenCalledTimes(1);

    const replayed = terminalWrite.mock.calls[0]?.[0];
    expect(typeof replayed).toBe("string");
    if (typeof replayed !== "string") {
      throw new Error("Expected replayed terminal output to be a string.");
    }

    const replayedBytes = new TextEncoder().encode(replayed).length;
    expect(replayedBytes).toBeLessThanOrEqual(maxBytes);
    expect(replayed).toBe(oversizedChunk.slice(-maxBytes));

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
        lastActivityAt: "2026-02-06T00:00:00.000Z",
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
