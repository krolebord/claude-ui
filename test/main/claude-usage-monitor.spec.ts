import { afterEach, describe, expect, it, vi } from "vitest";

const { getUsageMock } = vi.hoisted(() => ({
  getUsageMock: vi.fn(),
}));

vi.mock("../../src/main/claude-usage-service", () => ({
  getUsage: getUsageMock,
}));

vi.mock("../../src/main/logger", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { ClaudeUsageMonitor } from "../../src/main/claude-usage-monitor";

function createUsage(utilization: number) {
  return {
    five_hour: { utilization, resets_at: "2026-02-08T12:00:00.000Z" },
    seven_day: { utilization, resets_at: "2026-02-10T12:00:00.000Z" },
    seven_day_oauth_apps: null,
    seven_day_opus: null,
    seven_day_sonnet: null,
    seven_day_cowork: null,
    iguana_necktie: null,
    extra_usage: null,
  };
}

describe("ClaudeUsageMonitor", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("does not start polling when the initial usage fetch fails", async () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    getUsageMock.mockResolvedValue({ ok: false, message: "token expired" });
    const onUpdate = vi.fn();
    const monitor = new ClaudeUsageMonitor(onUpdate);

    const result = await monitor.start();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(result).toEqual({ ok: false, message: "token expired" });
    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(getUsageMock).toHaveBeenCalledTimes(1);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("starts polling and emits updates after a successful start", async () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const onUpdate = vi.fn();
    const monitor = new ClaudeUsageMonitor(onUpdate);
    const firstUsage = createUsage(25);
    const secondUsage = createUsage(30);
    getUsageMock
      .mockResolvedValueOnce({ ok: true, usage: firstUsage })
      .mockResolvedValueOnce({ ok: true, usage: secondUsage });

    const result = await monitor.start();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(result).toEqual({ ok: true, usage: firstUsage });
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(getUsageMock).toHaveBeenCalledTimes(2);
    expect(onUpdate).toHaveBeenCalledWith({ ok: true, usage: secondUsage });

    monitor.stop();
  });
});
