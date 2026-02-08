import { describe, expect, it } from "vitest";
import { ClaudeSessionSnapshotStore } from "../../src/main/claude-session-snapshot-store";

interface MockStore {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
}

function createMockStore(initial: Record<string, unknown>): MockStore {
  const values = { ...initial };

  return {
    get: (key) => values[key],
    set: (key, value) => {
      values[key] = value;
    },
  };
}

describe("ClaudeSessionSnapshotStore", () => {
  it("falls back to createdAt when lastActivityAt is malformed", () => {
    const mockStore = createMockStore({
      sessionSnapshots: [
        {
          sessionId: "session-1",
          cwd: "/workspace/one",
          sessionName: "Session One",
          status: "running",
          activityState: "working",
          activityWarning: null,
          lastError: null,
          createdAt: "2026-02-01T00:00:00.000Z",
          lastActivityAt: "",
        },
        {
          sessionId: "session-2",
          cwd: "/workspace/two",
          sessionName: "Session Two",
          status: "idle",
          activityState: "idle",
          activityWarning: null,
          lastError: null,
          createdAt: "2026-02-02T00:00:00.000Z",
          lastActivityAt: 12345,
        },
      ],
      activeSessionId: "session-1",
    });

    const store = new ClaudeSessionSnapshotStore(mockStore as never);
    const state = store.readSessionSnapshotState();

    expect(state.sessions).toHaveLength(2);
    expect(state.sessions[0]?.lastActivityAt).toBe("2026-02-01T00:00:00.000Z");
    expect(state.sessions[1]?.lastActivityAt).toBe("2026-02-02T00:00:00.000Z");
  });
});
