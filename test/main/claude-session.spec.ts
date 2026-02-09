import type { IPty } from "node-pty";
import { afterEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node-pty", () => ({
  spawn: spawnMock,
}));

import { ClaudeSessionManager } from "../../src/main/claude-session";

type PtyDataListener = (data: string) => void;

function createFakePty(): IPty & { fireData: (data: string) => void } {
  const dataListeners: PtyDataListener[] = [];
  return {
    onData: vi.fn((cb: PtyDataListener) => {
      dataListeners.push(cb);
    }),
    onExit: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    process: "claude",
    fireData: (data: string) => {
      for (const listener of dataListeners) {
        listener(data);
      }
    },
  } as unknown as IPty & { fireData: (data: string) => void };
}

function createManager(): ClaudeSessionManager {
  return new ClaudeSessionManager({
    emitData: () => undefined,
    emitExit: () => undefined,
    emitError: () => undefined,
    emitStatus: () => undefined,
  });
}

function getLaunchCommandFromSpawnCall(): string {
  const call = spawnMock.mock.calls[0];
  expect(call).toBeDefined();
  const args = call?.[1] as string[];
  return process.platform === "win32" ? args[3] ?? "" : args[1] ?? "";
}

describe("ClaudeSessionManager", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("appends initialPrompt as the last CLI argument", async () => {
    spawnMock.mockReturnValue(createFakePty());
    const manager = createManager();

    const result = await manager.start(
      {
        cwd: process.cwd(),
        cols: 80,
        rows: 24,
        model: "haiku",
        initialPrompt: "fix the login bug",
      },
      {
        pluginDir: "/plugin",
        sessionId: "session-1",
      },
    );

    expect(result).toEqual({ ok: true });
    const command = getLaunchCommandFromSpawnCall();

    if (process.platform === "win32") {
      expect(command).toBe(
        'claude --plugin-dir "/plugin" --session-id "session-1" --model haiku "fix the login bug"',
      );
      return;
    }

    expect(command).toBe(
      "exec claude --plugin-dir '/plugin' --session-id 'session-1' --model haiku 'fix the login bug'",
    );
  });

  it("omits initialPrompt when it is blank after trim", async () => {
    spawnMock.mockReturnValue(createFakePty());
    const manager = createManager();

    const result = await manager.start(
      {
        cwd: process.cwd(),
        cols: 80,
        rows: 24,
        initialPrompt: "   ",
      },
      {
        pluginDir: "/plugin",
        sessionId: "session-1",
      },
    );

    expect(result).toEqual({ ok: true });
    const command = getLaunchCommandFromSpawnCall();

    if (process.platform === "win32") {
      expect(command).toBe('claude --plugin-dir "/plugin" --session-id "session-1"');
      return;
    }

    expect(command).toBe(
      "exec claude --plugin-dir '/plugin' --session-id 'session-1'",
    );
  });

  it("stays in starting status until first data arrives", async () => {
    spawnMock.mockReturnValue(createFakePty());
    const statuses: string[] = [];
    const manager = new ClaudeSessionManager({
      emitData: () => undefined,
      emitExit: () => undefined,
      emitError: () => undefined,
      emitStatus: (status) => {
        statuses.push(status);
      },
    });

    await manager.start(
      { cwd: process.cwd(), cols: 80, rows: 24 },
      { pluginDir: "/plugin", sessionId: "session-1" },
    );

    expect(manager.getStatus()).toBe("starting");
    expect(statuses).toEqual(["starting"]);
  });

  it("transitions to running on first PTY data", async () => {
    const fakePty = createFakePty();
    spawnMock.mockReturnValue(fakePty);
    const statuses: string[] = [];
    const manager = new ClaudeSessionManager({
      emitData: () => undefined,
      emitExit: () => undefined,
      emitError: () => undefined,
      emitStatus: (status) => {
        statuses.push(status);
      },
    });

    await manager.start(
      { cwd: process.cwd(), cols: 80, rows: 24 },
      { pluginDir: "/plugin", sessionId: "session-1" },
    );

    fakePty.fireData("hello");
    fakePty.fireData("world");

    expect(manager.getStatus()).toBe("running");
    expect(statuses).toEqual(["starting", "running"]);
  });
});
