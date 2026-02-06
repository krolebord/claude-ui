import type {
  ClaudeActivityState,
  ClaudeSessionStatus,
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

function createHarness() {
  const managerMocks: MockSessionManager[] = [];
  const monitorMocks: MockActivityMonitor[] = [];
  const eventLog = {
    sessionData: [] as Array<{ sessionId: string; chunk: string }>,
    sessionExit: [] as Array<{ sessionId: string; exitCode: number | null }>,
    sessionError: [] as Array<{ sessionId: string; message: string }>,
    sessionStatus: [] as Array<{ sessionId: string; status: ClaudeSessionStatus }>,
    sessionActivityState: [] as Array<{
      sessionId: string;
      activityState: ClaudeActivityState;
    }>,
    sessionActivityWarning: [] as Array<{ sessionId: string; warning: string | null }>,
    activeChanged: [] as Array<{ activeSessionId: string | null }>,
  };

  const sessionIds = ["session-1", "session-2", "session-3"];
  let sessionIdIndex = 0;

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
      emitActiveSessionChanged: (payload) => {
        eventLog.activeChanged.push(payload);
      },
    },
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
    sessionIdFactory: () => sessionIds[sessionIdIndex++] ?? `session-${sessionIdIndex}`,
    nowFactory: () => "2026-02-06T00:00:00.000Z",
  });

  return {
    service,
    managerMocks,
    monitorMocks,
    eventLog,
  };
}

const START_INPUT: StartClaudeSessionInput = {
  cwd: "/workspace",
  cols: 80,
  rows: 24,
};

describe("ClaudeSessionService", () => {
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
    expect(harness.eventLog.sessionActivityState[0]?.sessionId).toBe("session-1");
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
});
