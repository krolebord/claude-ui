import type {
  ClaudeActiveSessionChangedEvent,
  ClaudeSessionActivityStateEvent,
  ClaudeSessionActivityWarningEvent,
  ClaudeSessionDataEvent,
  ClaudeSessionErrorEvent,
  ClaudeSessionExitEvent,
  ClaudeSessionHookEvent,
  ClaudeSessionStatusEvent,
  ClaudeSessionsSnapshot,
} from "../../src/shared/claude-types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalSessionService } from "../../src/renderer/src/services/terminal-session-service";

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
        status: "running",
        activityState: "working",
        activityWarning: null,
        lastError: null,
        createdAt: "2026-02-06T00:00:00.000Z",
      },
      {
        sessionId: "session-2",
        cwd: "/workspace/two",
        status: "running",
        activityState: "working",
        activityWarning: null,
        lastError: null,
        createdAt: "2026-02-06T00:00:01.000Z",
      },
    ],
  };
}

describe("TerminalSessionService", () => {
  beforeEach(() => {
    ipcHarness.reset();
    ipcHarness.claudeIpc.getSessions.mockResolvedValue({
      sessions: [],
      activeSessionId: null,
    });
    ipcHarness.claudeIpc.selectFolder.mockResolvedValue("/workspace");
    ipcHarness.claudeIpc.stopClaudeSession.mockResolvedValue({ ok: true });
    ipcHarness.claudeIpc.setActiveSession.mockResolvedValue(undefined);
  });

  it("hydrates initial sessions from preload", async () => {
    ipcHarness.claudeIpc.getSessions.mockResolvedValueOnce(makeSnapshot());

    const service = new TerminalSessionService();
    service.retain();

    await vi.waitFor(() => {
      expect(ipcHarness.claudeIpc.getSessions).toHaveBeenCalledTimes(1);
    });

    const state = service.getSnapshot();
    expect(state.activeSessionId).toBe("session-1");
    expect(Object.keys(state.sessionsById)).toHaveLength(2);

    service.release();
  });

  it("auto-stops active running session before starting a new one", async () => {
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
            status: "stopped",
            activityState: "idle",
            activityWarning: null,
            lastError: null,
            createdAt: "2026-02-06T00:00:00.000Z",
          },
          {
            sessionId: "session-3",
            cwd: "/workspace/three",
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

    await service.actions.selectFolder();
    await service.actions.startSession({ cols: 80, rows: 24 });

    expect(ipcHarness.claudeIpc.stopClaudeSession).toHaveBeenCalledWith({
      sessionId: "session-1",
    });
    expect(ipcHarness.claudeIpc.startClaudeSession).toHaveBeenCalledWith({
      cwd: "/workspace",
      cols: 80,
      rows: 24,
    });

    const stopOrder =
      ipcHarness.claudeIpc.stopClaudeSession.mock.invocationCallOrder[0] ?? 0;
    const startOrder =
      ipcHarness.claudeIpc.startClaudeSession.mock.invocationCallOrder[0] ?? 0;
    expect(stopOrder).toBeLessThan(startOrder);

    expect(service.getSnapshot().activeSessionId).toBe("session-3");
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
