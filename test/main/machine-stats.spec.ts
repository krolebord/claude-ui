import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const systemInformationMocks = vi.hoisted(() => ({
  fsSize: vi.fn(),
}));
const loggerMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("systeminformation", () => systemInformationMocks);
vi.mock("../../src/main/logger", () => ({
  default: loggerMocks,
}));

import { collectDiskUsage } from "../../src/main/machine-stats";

const originalPlatform = process.platform;

function setPlatform(value: string) {
  Object.defineProperty(process, "platform", { configurable: true, value });
}

describe("collectDiskUsage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPlatform("linux");
  });

  afterEach(() => {
    setPlatform(originalPlatform);
  });

  it("reports usage for the root filesystem", async () => {
    systemInformationMocks.fsSize.mockResolvedValue([
      { mount: "/boot", size: 500, used: 100 },
      { mount: "/", size: 1000, used: 400 },
    ]);

    await expect(collectDiskUsage()).resolves.toEqual({
      usedBytes: 400,
      totalBytes: 1000,
    });
    expect(loggerMocks.debug).not.toHaveBeenCalled();
  });

  it("prefers the writable data volume on macOS", async () => {
    setPlatform("darwin");
    systemInformationMocks.fsSize.mockResolvedValue([
      { mount: "/", size: 1000, used: 10 },
      { mount: "/System/Volumes/Data", size: 1000, used: 700 },
    ]);

    await expect(collectDiskUsage()).resolves.toEqual({
      usedBytes: 700,
      totalBytes: 1000,
    });
  });

  it("falls back to the largest filesystem when no known mount matches", async () => {
    systemInformationMocks.fsSize.mockResolvedValue([
      { mount: "/data", size: 2000, used: 900 },
      { mount: "/boot", size: 500, used: 100 },
    ]);

    await expect(collectDiskUsage()).resolves.toEqual({
      usedBytes: 900,
      totalBytes: 2000,
    });
  });

  it("returns null when collection fails", async () => {
    systemInformationMocks.fsSize.mockRejectedValue(new Error("no df"));

    await expect(collectDiskUsage()).resolves.toBeNull();
    expect(loggerMocks.debug).toHaveBeenCalledOnce();
  });
});
