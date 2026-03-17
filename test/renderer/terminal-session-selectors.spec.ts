import { describe, expect, it } from "vitest";
import { buildProjectSessionGroups } from "../../src/renderer/src/services/terminal-session-selectors";

describe("buildProjectSessionGroups", () => {
  it("includes the git branch as the project subtitle", () => {
    const groups = buildProjectSessionGroups({
      projects: [
        {
          path: "/workspace/app",
          collapsed: false,
          gitBranch: "feature/sidebar-branch",
        },
      ],
      sessionsById: {},
    });

    expect(groups).toEqual([
      {
        path: "/workspace/app",
        name: "app",
        subtitle: "feature/sidebar-branch",
        collapsed: false,
        fromProjectList: true,
        sessions: [],
      },
    ]);
  });
});
