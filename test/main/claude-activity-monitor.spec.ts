import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ClaudeActivityState, ClaudeHookEvent } from "../../src/shared/claude-types";
import { ClaudeActivityMonitor } from "../../src/main/claude-activity-monitor";
import { afterEach, describe, expect, it, vi } from "vitest";

function createHookEvent(
  hookEventName: string,
  notificationType?: string,
): ClaudeHookEvent {
  return {
    timestamp: "2026-02-07T00:00:00.000Z",
    session_id: "session-1",
    hook_event_name: hookEventName,
    notification_type: notificationType,
  };
}

async function createStateFile(): Promise<{ dir: string; stateFilePath: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "claude-activity-monitor-"));
  const stateFilePath = path.join(dir, "state.ndjson");
  await writeFile(stateFilePath, "", "utf8");
  return { dir, stateFilePath };
}

async function appendHookEvent(
  stateFilePath: string,
  event: ClaudeHookEvent,
): Promise<void> {
  await appendFile(stateFilePath, `${JSON.stringify(event)}\n`, "utf8");
}

async function appendRaw(stateFilePath: string, value: string): Promise<void> {
  await appendFile(stateFilePath, value, "utf8");
}

function createHarness() {
  const hookEvents: ClaudeHookEvent[] = [];
  const activityStates: ClaudeActivityState[] = [];
  const monitor = new ClaudeActivityMonitor({
    emitActivityState: (state) => {
      activityStates.push(state);
    },
    emitHookEvent: (event) => {
      hookEvents.push(event);
    },
  });

  return {
    monitor,
    hookEvents,
    activityStates,
  };
}

const activeMonitors: ClaudeActivityMonitor[] = [];
const tempDirs: string[] = [];

describe("ClaudeActivityMonitor", () => {
  afterEach(async () => {
    for (const monitor of activeMonitors.splice(0)) {
      monitor.stopMonitoring({ preserveState: true });
    }

    for (const dir of tempDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }

    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("uses watch-first monitoring and reads appended events", async () => {
    const { dir, stateFilePath } = await createStateFile();
    tempDirs.push(dir);

    const { monitor, hookEvents, activityStates } = createHarness();
    activeMonitors.push(monitor);
    monitor.startMonitoring(stateFilePath);

    await appendHookEvent(stateFilePath, createHookEvent("PreToolUse"));

    await vi.waitFor(() => {
      expect(hookEvents).toHaveLength(1);
    });

    expect(activityStates.at(-1)).toBe("working");
    expect(monitor.getState()).toBe("working");
  });

  it("falls back to polling when watcher setup fails", async () => {
    vi.useFakeTimers();

    const { dir, stateFilePath } = await createStateFile();
    tempDirs.push(dir);

    const { monitor, hookEvents, activityStates } = createHarness();
    activeMonitors.push(monitor);

    vi.spyOn(
      monitor as unknown as { startWatcher: (pathValue: string) => void },
      "startWatcher",
    ).mockImplementation(() => {
      throw new Error("watch failed");
    });

    monitor.startMonitoring(stateFilePath);

    await appendHookEvent(stateFilePath, createHookEvent("PreToolUse"));
    await vi.advanceTimersByTimeAsync(200);

    await vi.waitFor(() => {
      expect(hookEvents).toHaveLength(1);
    });

    expect((monitor as unknown as { usingPollingFallback: boolean }).usingPollingFallback).toBe(true);
    expect(activityStates.at(-1)).toBe("working");
  });

  it("polling checks every 200ms and only polls when >250ms elapsed", async () => {
    vi.useFakeTimers();

    const { dir, stateFilePath } = await createStateFile();
    tempDirs.push(dir);

    const { monitor } = createHarness();
    activeMonitors.push(monitor);

    const requestPollSpy = vi.spyOn(
      monitor as unknown as { requestPoll: () => Promise<void> },
      "requestPoll",
    );

    monitor.startMonitoring(stateFilePath);
    expect(requestPollSpy).toHaveBeenCalledTimes(1); // Initial immediate check.

    await vi.advanceTimersByTimeAsync(200);
    expect(requestPollSpy).toHaveBeenCalledTimes(1); // 200ms tick -> blocked.

    await vi.advanceTimersByTimeAsync(200);
    expect(requestPollSpy).toHaveBeenCalledTimes(2); // 400ms tick -> allowed.

    await vi.advanceTimersByTimeAsync(200);
    expect(requestPollSpy).toHaveBeenCalledTimes(2); // 600ms tick -> blocked.

    await vi.advanceTimersByTimeAsync(200);
    expect(requestPollSpy).toHaveBeenCalledTimes(3); // 800ms tick -> allowed.
  });

  it("falls back to polling when watcher emits an error", async () => {
    vi.useFakeTimers();

    const { dir, stateFilePath } = await createStateFile();
    tempDirs.push(dir);

    const { monitor, hookEvents, activityStates } = createHarness();
    activeMonitors.push(monitor);
    monitor.startMonitoring(stateFilePath);

    const watcher = (
      monitor as unknown as {
        watcher: { emit: (name: string, ...args: unknown[]) => void } | null;
      }
    ).watcher;
    watcher?.emit("error", new Error("watch stream failed"));

    await appendHookEvent(
      stateFilePath,
      createHookEvent("Notification", "permission_prompt"),
    );
    await vi.advanceTimersByTimeAsync(200);

    await vi.waitFor(() => {
      expect(hookEvents).toHaveLength(1);
    });

    expect((monitor as unknown as { usingPollingFallback: boolean }).usingPollingFallback).toBe(true);
    expect(activityStates.at(-1)).toBe("awaiting_approval");
  });

  it("resets state to unknown on stopMonitoring by default", async () => {
    const { dir, stateFilePath } = await createStateFile();
    tempDirs.push(dir);

    const { monitor } = createHarness();
    activeMonitors.push(monitor);
    monitor.startMonitoring(stateFilePath);

    await appendHookEvent(stateFilePath, createHookEvent("PreToolUse"));
    await vi.waitFor(() => {
      expect(monitor.getState()).toBe("working");
    });

    monitor.stopMonitoring();
    expect(monitor.getState()).toBe("unknown");
  });

  it("preserves state when stopMonitoring is called with preserveState", async () => {
    const { dir, stateFilePath } = await createStateFile();
    tempDirs.push(dir);

    const { monitor } = createHarness();
    activeMonitors.push(monitor);
    monitor.startMonitoring(stateFilePath);

    await appendHookEvent(stateFilePath, createHookEvent("PreToolUse"));
    await vi.waitFor(() => {
      expect(monitor.getState()).toBe("working");
    });

    monitor.stopMonitoring({ preserveState: true });
    expect(monitor.getState()).toBe("working");
  });

  it("ignores malformed lines and emits only complete valid JSON lines", async () => {
    const { dir, stateFilePath } = await createStateFile();
    tempDirs.push(dir);

    const { monitor, hookEvents, activityStates } = createHarness();
    activeMonitors.push(monitor);
    monitor.startMonitoring(stateFilePath);

    await appendRaw(stateFilePath, "{\"broken\":\n");
    await appendRaw(
      stateFilePath,
      "{\"timestamp\":\"2026-02-07T00:00:00.000Z\",\"session_id\":\"session-1\",\"hook_event_name\":\"PreToolUse\"",
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(hookEvents).toHaveLength(0);
    expect(activityStates).toHaveLength(0);

    await appendRaw(stateFilePath, "}\n");

    await vi.waitFor(() => {
      expect(hookEvents).toHaveLength(1);
    });

    expect(activityStates.at(-1)).toBe("working");
  });

  it("queues additional poll requests that arrive during an active poll", async () => {
    const { monitor } = createHarness();

    const privateMonitor = monitor as unknown as {
      stateFilePath: string | null;
      pollOnce: () => Promise<void>;
      requestPoll: () => Promise<void>;
    };
    privateMonitor.stateFilePath = "/tmp/claude-state.ndjson";

    let pollRuns = 0;
    privateMonitor.pollOnce = vi.fn(async () => {
      pollRuns += 1;
      if (pollRuns === 1) {
        void privateMonitor.requestPoll();
      }
    });

    await privateMonitor.requestPoll();
    expect(pollRuns).toBe(2);
  });
});
