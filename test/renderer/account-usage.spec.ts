import { describe, expect, it } from "vitest";
import {
  shortWindowUsagePercent,
  type UsageEntry,
} from "../../src/renderer/src/hooks/use-account-usage";

function entry(overrides: Partial<UsageEntry>): UsageEntry {
  return {
    provider: "claude",
    accountId: null,
    status: "ok",
    error: null,
    fetchedAt: 0,
    refreshing: false,
    data: null,
    ...overrides,
  } as UsageEntry;
}

const claudeBucket = { utilization: 41.4, resets_at: null };

describe("shortWindowUsagePercent", () => {
  it("rounds Claude's five-hour utilization", () => {
    const percent = shortWindowUsagePercent(
      entry({
        provider: "claude",
        data: {
          five_hour: claudeBucket,
          seven_day: { utilization: 88, resets_at: null },
          seven_day_sonnet: null,
          extra_usage: null,
        },
      }),
    );

    expect(percent).toBe(41);
  });

  it("picks Codex's shortest window", () => {
    const percent = shortWindowUsagePercent(
      entry({
        provider: "codex",
        data: {
          planType: "plus",
          primaryWindow: {
            utilization: 90,
            resetsAt: null,
            windowSeconds: 604_800,
          },
          secondaryWindow: {
            utilization: 12.5,
            resetsAt: null,
            windowSeconds: 18_000,
          },
        },
      }),
    );

    expect(percent).toBe(13);
  });

  it("returns null when usage has not been read yet", () => {
    expect(shortWindowUsagePercent(undefined)).toBeNull();
    expect(shortWindowUsagePercent(entry({ status: "pending" }))).toBeNull();
    expect(
      shortWindowUsagePercent(
        entry({
          provider: "claude",
          data: {
            five_hour: null,
            seven_day: null,
            seven_day_sonnet: null,
            extra_usage: null,
          },
        }),
      ),
    ).toBeNull();
    expect(
      shortWindowUsagePercent(
        entry({
          provider: "codex",
          data: { primaryWindow: null, secondaryWindow: null },
        }),
      ),
    ).toBeNull();
  });

  it("has no reading for Cursor, which reports no short window", () => {
    expect(shortWindowUsagePercent(entry({ provider: "cursor" }))).toBeNull();
  });
});
