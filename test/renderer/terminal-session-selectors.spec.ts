import { describe, expect, it } from "vitest";
import type { ClaudeSessionSnapshot } from "../../src/shared/claude-types";
import {
  buildProjectSessionGroups,
  getSessionLastActivityLabel,
  getSessionSidebarIndicatorState,
  getSessionTitle,
} from "../../src/renderer/src/services/terminal-session-selectors";

function makeSession(
  overrides?: Partial<ClaudeSessionSnapshot>,
): ClaudeSessionSnapshot {
  return {
    sessionId: "session-1",
    cwd: "/workspace",
    sessionName: null,
    status: "idle",
    activityState: "idle",
    activityWarning: null,
    lastError: null,
    createdAt: "2026-02-06T00:00:00.000Z",
    lastActivityAt: "2026-02-06T00:00:00.000Z",
    ...overrides,
  };
}

describe("terminal session selectors", () => {
  it("uses fallback title when session name is blank", () => {
    expect(getSessionTitle(makeSession({ sessionName: "  " }))).toBe(
      "Session session-",
    );
  });

  it("prioritizes error indicator over activity state", () => {
    expect(
      getSessionSidebarIndicatorState(
        makeSession({
          status: "error",
          activityState: "awaiting_approval",
        }),
      ),
    ).toBe("error");
  });

  it("formats relative activity labels", () => {
    const now = Date.parse("2026-02-06T01:00:00.000Z");
    expect(
      getSessionLastActivityLabel(
        makeSession({ lastActivityAt: "2026-02-06T00:56:00.000Z" }),
        now,
      ),
    ).toBe("4m");
  });

  it("uses one minute label for activity that rounds to 60 seconds", () => {
    const now = Date.parse("2026-02-06T01:00:59.000Z");
    expect(
      getSessionLastActivityLabel(
        makeSession({ lastActivityAt: "2026-02-06T01:00:00.000Z" }),
        now,
      ),
    ).toBe("1m");
  });

  it("builds project groups with newest sessions first", () => {
    const groups = buildProjectSessionGroups({
      projects: [{ path: "/workspace", collapsed: false }],
      sessionsById: {
        "session-1": makeSession({
          sessionId: "session-1",
          createdAt: "2026-02-06T00:00:00.000Z",
          lastActivityAt: "2026-02-06T00:00:00.000Z",
        }),
        "session-2": makeSession({
          sessionId: "session-2",
          createdAt: "2026-02-06T00:00:01.000Z",
          lastActivityAt: "2026-02-06T00:00:01.000Z",
        }),
      },
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.sessions.map((session) => session.sessionId)).toEqual([
      "session-2",
      "session-1",
    ]);
  });
});
