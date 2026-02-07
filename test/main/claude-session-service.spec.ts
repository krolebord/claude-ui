import type {
  ClaudeActivityState,
  ClaudeProject,
  ClaudeSessionSnapshot,
  ClaudeSessionStatus,
  SessionId,
  StartClaudeSessionInput,
} from "../../src/shared/claude-types";
import { describe, expect, it, vi } from "vitest";
import { ClaudeSessionService } from "../../src/main/claude-session-service";

interface SessionManagerCallbacks {
  emitData: (chunk: string) => void;
  emitExit: (payload: { exitCode: number | null; signal?: number }) => void;
  emitError: (payload: { message: string }) => void;
  emitStatus: (status: ClaudeSessionStatus) => void;
}

interface ActivityMonitorCallbacks {
  emitActivityState: (state: ClaudeActivityState) => void;
  emitHookEvent: (event: Record<string, unknown>) => void;
}

interface MockSessionManager {
  callbacks: SessionManagerCallbacks;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

interface MockActivityMonitor {
  callbacks: ActivityMonitorCallbacks;
  startMonitoring: ReturnType<typeof vi.fn>;
  stopMonitoring: ReturnType<typeof vi.fn>;
}

function createHarness(options?: {
  initialProjects?: ClaudeProject[];
  initialSessionSnapshotState?: {
    sessions: ClaudeSessionSnapshot[];
    activeSessionId: SessionId | null;
  };
  nowFactory?: () => string;
}) {
  const managerMocks: MockSessionManager[] = [];
  const monitorMocks: MockActivityMonitor[] = [];
  const eventLog = {
    sessionData: [] as Array<{ sessionId: string; chunk: string }>,
    sessionExit: [] as Array<{ sessionId: string; exitCode: number | null }>,
    sessionError: [] as Array<{ sessionId: string; message: string }>,
    sessionStatus: [] as Array<{
      sessionId: string;
      status: ClaudeSessionStatus;
    }>,
    sessionActivityState: [] as Array<{
      sessionId: string;
      activityState: ClaudeActivityState;
    }>,
    sessionActivityWarning: [] as Array<{
      sessionId: string;
      warning: string | null;
    }>,
    sessionTitleChanged: [] as Array<{ sessionId: string; title: string }>,
    activeChanged: [] as Array<{ activeSessionId: string | null }>,
  };

  const sessionIds = ["session-1", "session-2", "session-3"];
  let sessionIdIndex = 0;
  const storedProjects: ClaudeProject[] = [...(options?.initialProjects ?? [])];
  const projectStore = {
    readProjects: vi.fn(() => storedProjects),
    writeProjects: vi.fn((projects: ClaudeProject[]) => {
      storedProjects.length = 0;
      storedProjects.push(...projects);
    }),
  };
  const storedSessionSnapshotState = {
    sessions: [
      ...(options?.initialSessionSnapshotState?.sessions ?? []),
    ] as ClaudeSessionSnapshot[],
    activeSessionId:
      options?.initialSessionSnapshotState?.activeSessionId ?? null,
  };
  const sessionSnapshotStore = {
    readSessionSnapshotState: vi.fn(() => ({
      sessions: storedSessionSnapshotState.sessions,
      activeSessionId: storedSessionSnapshotState.activeSessionId,
    })),
    writeSessionSnapshotState: vi.fn(
      (state: {
        sessions: ClaudeSessionSnapshot[];
        activeSessionId: SessionId | null;
      }) => {
        storedSessionSnapshotState.sessions = [...state.sessions];
        storedSessionSnapshotState.activeSessionId = state.activeSessionId;
      },
    ),
  };

  const service = new ClaudeSessionService({
    userDataPath: "/tmp",
    pluginDir: "/plugin",
    pluginWarning: null,
    callbacks: {
      emitSessionData: (payload) => {
        eventLog.sessionData.push(payload);
      },
      emitSessionExit: (payload) => {
        eventLog.sessionExit.push(payload);
      },
      emitSessionError: (payload) => {
        eventLog.sessionError.push(payload);
      },
      emitSessionStatus: (payload) => {
        eventLog.sessionStatus.push(payload);
      },
      emitSessionActivityState: (payload) => {
        eventLog.sessionActivityState.push(payload);
      },
      emitSessionActivityWarning: (payload) => {
        eventLog.sessionActivityWarning.push(payload);
      },
      emitSessionTitleChanged: (payload) => {
        eventLog.sessionTitleChanged.push(payload);
      },
      emitActiveSessionChanged: (payload) => {
        eventLog.activeChanged.push(payload);
      },
    },
    generateTitleFactory: vi.fn(async () => "Generated Title"),
    sessionManagerFactory: (callbacks) => {
      const manager: MockSessionManager = {
        callbacks,
        start: vi.fn(async () => ({ ok: true as const })),
        stop: vi.fn(async () => ({ ok: true as const })),
        write: vi.fn(),
        resize: vi.fn(),
        dispose: vi.fn(),
      };

      managerMocks.push(manager);
      return manager;
    },
    activityMonitorFactory: (callbacks) => {
      const monitor: MockActivityMonitor = {
        callbacks: callbacks as ActivityMonitorCallbacks,
        startMonitoring: vi.fn(),
        stopMonitoring: vi.fn(),
      };

      monitorMocks.push(monitor);
      return monitor;
    },
    stateFileFactory: async () => "/tmp/claude-state.ndjson",
    sessionIdFactory: () =>
      sessionIds[sessionIdIndex++] ?? `session-${sessionIdIndex}`,
    nowFactory: options?.nowFactory ?? (() => "2026-02-06T00:00:00.000Z"),
    projectStore,
    sessionSnapshotStore,
  });

  return {
    service,
    managerMocks,
    monitorMocks,
    eventLog,
    projectStore,
    sessionSnapshotStore,
    storedProjects,
    storedSessionSnapshotState,
  };
}

const START_INPUT: StartClaudeSessionInput = {
  cwd: "/workspace",
  cols: 80,
  rows: 24,
};

describe("ClaudeSessionService", () => {
  it("adds projects and persists them", () => {
    const harness = createHarness();

    const first = harness.service.addProject({
      path: " /workspace ",
    });
    const second = harness.service.addProject({
      path: "/workspace",
    });

    expect(first.snapshot.projects).toEqual([
      {
        path: "/workspace",
        collapsed: false,
      },
    ]);
    expect(second.snapshot.projects).toEqual([
      {
        path: "/workspace",
        collapsed: false,
      },
    ]);
    expect(harness.projectStore.writeProjects).toHaveBeenCalledTimes(1);
    expect(harness.storedProjects).toEqual([
      {
        path: "/workspace",
        collapsed: false,
      },
    ]);
  });

  it("toggles project collapsed state and persists changes", () => {
    const harness = createHarness();

    harness.service.addProject({ path: "/workspace" });
    const result = harness.service.setProjectCollapsed({
      path: "/workspace",
      collapsed: true,
    });

    expect(result.snapshot.projects).toEqual([
      {
        path: "/workspace",
        collapsed: true,
      },
    ]);
    expect(harness.projectStore.writeProjects).toHaveBeenCalledTimes(2);
    expect(harness.storedProjects).toEqual([
      {
        path: "/workspace",
        collapsed: true,
      },
    ]);
  });

  it("ignores collapse updates for unknown projects", () => {
    const harness = createHarness();

    const result = harness.service.setProjectCollapsed({
      path: "/workspace",
      collapsed: true,
    });

    expect(result.snapshot.projects).toEqual([]);
    expect(harness.projectStore.writeProjects).not.toHaveBeenCalled();
  });

  it("hydrates persisted sessions and marks them as stopped", () => {
    const harness = createHarness({
      initialSessionSnapshotState: {
        sessions: [
          {
            sessionId: "session-1",
            cwd: "/workspace",
            sessionName: "Recovered Session",
            status: "running",
            activityState: "working",
            activityWarning: null,
            lastError: null,
            createdAt: "2026-02-05T00:00:00.000Z",
            lastActivityAt: "2026-02-05T00:00:00.000Z",
          },
        ],
        activeSessionId: "session-1",
      },
    });

    const snapshot = harness.service.getSessionsSnapshot();
    expect(snapshot.activeSessionId).toBe("session-1");
    expect(snapshot.sessions).toEqual([
      {
        sessionId: "session-1",
        cwd: "/workspace",
        sessionName: "Recovered Session",
        status: "stopped",
        activityState: "idle",
        activityWarning: null,
        lastError: null,
        createdAt: "2026-02-05T00:00:00.000Z",
        lastActivityAt: "2026-02-05T00:00:00.000Z",
      },
    ]);
  });

  it("avoids session ID collisions with hydrated sessions", async () => {
    const harness = createHarness({
      initialSessionSnapshotState: {
        sessions: [
          {
            sessionId: "session-1",
            cwd: "/workspace",
            sessionName: "Recovered Session",
            status: "stopped",
            activityState: "idle",
            activityWarning: null,
            lastError: null,
            createdAt: "2026-02-05T00:00:00.000Z",
            lastActivityAt: "2026-02-05T00:00:00.000Z",
          },
        ],
        activeSessionId: "session-1",
      },
    });

    const result = await harness.service.startSession(START_INPUT);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.sessionId).toBe("session-2");
    const snapshot = harness.service.getSessionsSnapshot();
    expect(snapshot.sessions.map((session) => session.sessionId)).toEqual([
      "session-1",
      "session-2",
    ]);
  });

  it("resumes hydrated sessions after relaunch", async () => {
    const harness = createHarness({
      initialSessionSnapshotState: {
        sessions: [
          {
            sessionId: "session-1",
            cwd: "/workspace",
            sessionName: "Recovered Session",
            status: "stopped",
            activityState: "idle",
            activityWarning: null,
            lastError: null,
            createdAt: "2026-02-05T00:00:00.000Z",
            lastActivityAt: "2026-02-05T00:00:00.000Z",
          },
        ],
        activeSessionId: "session-1",
      },
    });

    const result = await harness.service.startSession({
      ...START_INPUT,
      resumeSessionId: "session-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.sessionId).toBe("session-1");
    expect(harness.managerMocks).toHaveLength(1);
    expect(harness.managerMocks[0]?.start).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/workspace",
      }),
      expect.objectContaining({
        resumeSessionId: "session-1",
      }),
    );
  });

  it("creates distinct session IDs and keeps snapshots", async () => {
    const harness = createHarness();

    const first = await harness.service.startSession(START_INPUT);
    const second = await harness.service.startSession(START_INPUT);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    if (!first.ok || !second.ok) {
      return;
    }

    expect(first.sessionId).toBe("session-1");
    expect(second.sessionId).toBe("session-2");
    expect(second.snapshot.sessions).toHaveLength(2);
    expect(second.snapshot.activeSessionId).toBe("session-2");
    expect(second.snapshot.sessions[0]?.sessionName).toBeNull();
    expect(second.snapshot.sessions[1]?.sessionName).toBeNull();
    expect(harness.storedSessionSnapshotState.sessions).toHaveLength(2);
    expect(harness.storedSessionSnapshotState.activeSessionId).toBe(
      "session-2",
    );
  });

  it("stores session name when provided", async () => {
    const harness = createHarness();

    const result = await harness.service.startSession({
      ...START_INPUT,
      sessionName: "Refactor terminal service",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.snapshot.sessions[0]?.sessionName).toBe(
      "Refactor terminal service",
    );
  });

  it("uses hook event timestamp for lastActivityAt", async () => {
    const harness = createHarness();

    const result = await harness.service.startSession(START_INPUT);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    harness.monitorMocks[0]?.callbacks.emitHookEvent({
      timestamp: "2026-02-06T00:10:00.000Z",
      hook_event_name: "PostToolUse",
      session_id: "session-1",
    });

    const snapshot = harness.service.getSessionsSnapshot();
    expect(snapshot.sessions[0]?.lastActivityAt).toBe(
      "2026-02-06T00:10:00.000Z",
    );
    expect(harness.storedSessionSnapshotState.sessions[0]?.lastActivityAt).toBe(
      "2026-02-06T00:10:00.000Z",
    );
  });

  it("keeps generated session IDs canonical after hook events", async () => {
    const harness = createHarness();

    const result = await harness.service.startSession(START_INPUT);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    harness.monitorMocks[0]?.callbacks.emitHookEvent({
      timestamp: "2026-02-06T00:00:01.000Z",
      hook_event_name: "SessionStart",
      session_id: "claude-session-1",
    });

    const snapshot = harness.service.getSessionsSnapshot();
    expect(snapshot.sessions[0]?.sessionId).toBe("session-1");
    expect(snapshot.activeSessionId).toBe("session-1");
    expect(harness.eventLog.activeChanged.at(-1)).toEqual({
      activeSessionId: "session-1",
    });
  });

  it("passes dangerouslySkipPermissions to session start", async () => {
    const harness = createHarness();

    const result = await harness.service.startSession({
      ...START_INPUT,
      dangerouslySkipPermissions: true,
    });

    expect(result.ok).toBe(true);
    expect(harness.managerMocks[0]?.start).toHaveBeenCalledWith(
      expect.objectContaining({
        dangerouslySkipPermissions: true,
      }),
      expect.objectContaining({
        sessionId: "session-1",
      }),
    );
  });

  it("passes model to session start", async () => {
    const harness = createHarness();

    const result = await harness.service.startSession({
      ...START_INPUT,
      model: "haiku",
    });

    expect(result.ok).toBe(true);
    expect(harness.managerMocks[0]?.start).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "haiku",
      }),
      expect.objectContaining({
        sessionId: "session-1",
      }),
    );
  });

  it("resumes an existing stopped session with resumeSessionId", async () => {
    const harness = createHarness();

    await harness.service.startSession(START_INPUT);
    harness.managerMocks[0]?.callbacks.emitStatus("stopped");

    const result = await harness.service.startSession({
      ...START_INPUT,
      resumeSessionId: "session-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.sessionId).toBe("session-1");
    expect(harness.managerMocks).toHaveLength(1);
    expect(harness.managerMocks[0]?.start).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        cwd: "/workspace",
      }),
      expect.objectContaining({
        resumeSessionId: "session-1",
      }),
    );
  });

  it("returns a failure when resuming a missing session", async () => {
    const harness = createHarness();

    const result = await harness.service.startSession({
      ...START_INPUT,
      resumeSessionId: "missing-session",
    });

    expect(result).toEqual({
      ok: false,
      message: "Session does not exist: missing-session",
    });
    expect(harness.managerMocks).toHaveLength(0);
  });

  it("stops only the requested session", async () => {
    const harness = createHarness();

    await harness.service.startSession(START_INPUT);
    await harness.service.startSession(START_INPUT);

    await harness.service.stopSession({ sessionId: "session-1" });

    expect(harness.managerMocks[0]?.stop).toHaveBeenCalledTimes(1);
    expect(harness.managerMocks[1]?.stop).not.toHaveBeenCalled();
  });

  it("deletes only the requested session and clears active when needed", async () => {
    const harness = createHarness();

    await harness.service.startSession(START_INPUT);
    await harness.service.startSession(START_INPUT);

    await harness.service.deleteSession({ sessionId: "session-2" });

    expect(harness.managerMocks[1]?.stop).toHaveBeenCalledTimes(1);
    expect(harness.managerMocks[1]?.dispose).toHaveBeenCalledTimes(1);
    expect(harness.monitorMocks[1]?.stopMonitoring).toHaveBeenCalledTimes(1);
    expect(harness.managerMocks[0]?.stop).not.toHaveBeenCalled();

    const snapshot = harness.service.getSessionsSnapshot();
    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.sessions[0]?.sessionId).toBe("session-1");
    expect(snapshot.activeSessionId).toBeNull();
    expect(harness.storedSessionSnapshotState.sessions).toHaveLength(1);
    expect(harness.storedSessionSnapshotState.activeSessionId).toBeNull();
    expect(harness.eventLog.activeChanged.at(-1)).toEqual({
      activeSessionId: null,
    });
  });

  it("emits session-scoped events with the correct sessionId", async () => {
    const harness = createHarness();

    const result = await harness.service.startSession(START_INPUT);
    expect(result.ok).toBe(true);

    const manager = harness.managerMocks[0];
    const monitor = harness.monitorMocks[0];

    manager?.callbacks.emitData("chunk");
    manager?.callbacks.emitStatus("running");
    manager?.callbacks.emitError({ message: "boom" });
    manager?.callbacks.emitExit({ exitCode: 0 });
    monitor?.callbacks.emitActivityState("working");

    expect(harness.eventLog.sessionData[0]?.sessionId).toBe("session-1");
    expect(harness.eventLog.sessionStatus[0]?.sessionId).toBe("session-1");
    expect(harness.eventLog.sessionError[0]?.sessionId).toBe("session-1");
    expect(harness.eventLog.sessionExit[0]?.sessionId).toBe("session-1");
    expect(harness.eventLog.sessionActivityState[0]?.sessionId).toBe(
      "session-1",
    );
  });

  it("continues routing by generated session IDs after hook events", async () => {
    const harness = createHarness();

    const result = await harness.service.startSession(START_INPUT);
    expect(result.ok).toBe(true);

    harness.monitorMocks[0]?.callbacks.emitHookEvent({
      timestamp: "2026-02-06T00:00:01.000Z",
      hook_event_name: "SessionStart",
      session_id: "claude-session-1",
    });

    harness.service.writeToSession("session-1", "hello");
    await harness.service.stopSession({ sessionId: "session-1" });

    expect(harness.managerMocks[0]?.write).toHaveBeenCalledWith("hello");
    expect(harness.managerMocks[0]?.stop).toHaveBeenCalledTimes(1);
    expect(harness.managerMocks[0]?.write).not.toHaveBeenCalledWith(
      expect.stringContaining("claude-session-1"),
    );
  });

  it("emits active-session change events when active session moves", async () => {
    const harness = createHarness();

    await harness.service.startSession(START_INPUT);
    await harness.service.startSession(START_INPUT);
    await harness.service.setActiveSession("session-1");

    expect(harness.eventLog.activeChanged).toEqual([
      { activeSessionId: "session-1" },
      { activeSessionId: "session-2" },
      { activeSessionId: "session-1" },
    ]);
  });

  it("generates a title from UserPromptSubmit for unnamed sessions", async () => {
    const harness = createHarness();

    await harness.service.startSession(START_INPUT);

    harness.monitorMocks[0]?.callbacks.emitHookEvent({
      timestamp: "2026-02-07T00:00:01.000Z",
      hook_event_name: "UserPromptSubmit",
      session_id: "session-1",
      prompt: "fix the login bug",
    });

    await vi.waitFor(() => {
      expect(harness.eventLog.sessionTitleChanged).toHaveLength(1);
    });

    expect(harness.eventLog.sessionTitleChanged[0]).toEqual({
      sessionId: "session-1",
      title: "Generated Title",
    });

    const snapshot = harness.service.getSessionsSnapshot();
    expect(snapshot.sessions[0]?.sessionName).toBe("Generated Title");
    expect(harness.storedSessionSnapshotState.sessions[0]?.sessionName).toBe(
      "Generated Title",
    );
  });

  it("does not generate a title for sessions with explicit names", async () => {
    const harness = createHarness();

    await harness.service.startSession({
      ...START_INPUT,
      sessionName: "My Session",
    });

    harness.monitorMocks[0]?.callbacks.emitHookEvent({
      timestamp: "2026-02-07T00:00:01.000Z",
      hook_event_name: "UserPromptSubmit",
      session_id: "session-1",
      prompt: "hello",
    });
    await Promise.resolve();

    expect(harness.eventLog.sessionTitleChanged).toHaveLength(0);
  });

  it("waits for a non-empty UserPromptSubmit prompt before generating title", async () => {
    const harness = createHarness();

    await harness.service.startSession(START_INPUT);

    harness.monitorMocks[0]?.callbacks.emitHookEvent({
      timestamp: "2026-02-07T00:00:01.000Z",
      hook_event_name: "UserPromptSubmit",
      session_id: "session-1",
      prompt: "   ",
    });
    await Promise.resolve();

    expect(harness.eventLog.sessionTitleChanged).toHaveLength(0);

    harness.monitorMocks[0]?.callbacks.emitHookEvent({
      timestamp: "2026-02-07T00:00:02.000Z",
      hook_event_name: "UserPromptSubmit",
      session_id: "session-1",
      prompt: "real prompt",
    });
    await vi.waitFor(() => {
      expect(harness.eventLog.sessionTitleChanged).toHaveLength(1);
    });

    expect(harness.eventLog.sessionTitleChanged[0]).toEqual({
      sessionId: "session-1",
      title: "Generated Title",
    });
  });

  it("only generates a title once per session", async () => {
    const harness = createHarness();

    await harness.service.startSession(START_INPUT);

    harness.monitorMocks[0]?.callbacks.emitHookEvent({
      timestamp: "2026-02-07T00:00:01.000Z",
      hook_event_name: "UserPromptSubmit",
      session_id: "session-1",
      prompt: "first prompt",
    });
    await vi.waitFor(() => {
      expect(harness.eventLog.sessionTitleChanged).toHaveLength(1);
    });

    harness.monitorMocks[0]?.callbacks.emitHookEvent({
      timestamp: "2026-02-07T00:00:02.000Z",
      hook_event_name: "UserPromptSubmit",
      session_id: "session-1",
      prompt: "second prompt",
    });
    await Promise.resolve();

    expect(harness.eventLog.sessionTitleChanged).toHaveLength(1);
  });

  it("deletes an empty project and persists the change", () => {
    const harness = createHarness();

    harness.service.addProject({ path: "/workspace" });
    const result = harness.service.deleteProject({ path: "/workspace" });

    expect(result.ok).toBe(true);
    expect(result.snapshot.projects).toEqual([]);
    expect(harness.storedProjects).toEqual([]);
  });

  it("rejects deleting a project that still has sessions", async () => {
    const harness = createHarness();

    harness.service.addProject({ path: "/workspace" });
    await harness.service.startSession(START_INPUT);

    expect(() => {
      harness.service.deleteProject({ path: "/workspace" });
    }).toThrow("Cannot delete project that still has sessions");
  });

  it("writes initial prompt to PTY on SessionStart hook event", async () => {
    const harness = createHarness();

    await harness.service.startSession({
      ...START_INPUT,
      initialPrompt: "fix the login bug",
    });

    harness.monitorMocks[0]?.callbacks.emitHookEvent({
      timestamp: "2026-02-07T00:00:01.000Z",
      hook_event_name: "SessionStart",
      session_id: "session-1",
    });

    expect(harness.managerMocks[0]?.write).toHaveBeenCalledWith(
      "fix the login bug\r",
    );
  });

  it("does not write initial prompt on non-SessionStart hook events", async () => {
    const harness = createHarness();

    await harness.service.startSession({
      ...START_INPUT,
      initialPrompt: "fix the login bug",
    });

    harness.monitorMocks[0]?.callbacks.emitHookEvent({
      timestamp: "2026-02-07T00:00:01.000Z",
      hook_event_name: "UserPromptSubmit",
      session_id: "session-1",
      prompt: "something else",
    });

    expect(harness.managerMocks[0]?.write).not.toHaveBeenCalledWith(
      "fix the login bug\r",
    );
  });

  it("writes initial prompt only once", async () => {
    const harness = createHarness();

    await harness.service.startSession({
      ...START_INPUT,
      initialPrompt: "fix the login bug",
    });

    harness.monitorMocks[0]?.callbacks.emitHookEvent({
      timestamp: "2026-02-07T00:00:01.000Z",
      hook_event_name: "SessionStart",
      session_id: "session-1",
    });

    harness.monitorMocks[0]?.callbacks.emitHookEvent({
      timestamp: "2026-02-07T00:00:02.000Z",
      hook_event_name: "SessionStart",
      session_id: "session-1",
    });

    expect(harness.managerMocks[0]?.write).toHaveBeenCalledTimes(1);
  });

  it("triggers immediate title generation from initial prompt for unnamed sessions", async () => {
    const harness = createHarness();

    await harness.service.startSession({
      ...START_INPUT,
      initialPrompt: "fix the login bug",
    });

    await vi.waitFor(() => {
      expect(harness.eventLog.sessionTitleChanged).toHaveLength(1);
    });

    expect(harness.eventLog.sessionTitleChanged[0]).toEqual({
      sessionId: "session-1",
      title: "Generated Title",
    });

    const snapshot = harness.service.getSessionsSnapshot();
    expect(snapshot.sessions[0]?.sessionName).toBe("Generated Title");
  });

  it("does not trigger title generation from initial prompt when session has explicit name", async () => {
    const harness = createHarness();

    await harness.service.startSession({
      ...START_INPUT,
      sessionName: "My Session",
      initialPrompt: "fix the login bug",
    });

    await Promise.resolve();

    expect(harness.eventLog.sessionTitleChanged).toHaveLength(0);
  });

  it("does not re-trigger title generation from UserPromptSubmit after initial prompt already triggered it", async () => {
    const harness = createHarness();

    await harness.service.startSession({
      ...START_INPUT,
      initialPrompt: "fix the login bug",
    });

    await vi.waitFor(() => {
      expect(harness.eventLog.sessionTitleChanged).toHaveLength(1);
    });

    harness.monitorMocks[0]?.callbacks.emitHookEvent({
      timestamp: "2026-02-07T00:00:02.000Z",
      hook_event_name: "UserPromptSubmit",
      session_id: "session-1",
      prompt: "another prompt",
    });
    await Promise.resolve();

    expect(harness.eventLog.sessionTitleChanged).toHaveLength(1);
  });
});
