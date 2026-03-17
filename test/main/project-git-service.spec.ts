import { beforeEach, describe, expect, it, vi } from "vitest";

const simpleGitFactoryMock = vi.hoisted(() => vi.fn());
const checkIsRepoMock = vi.hoisted(() => vi.fn());
const branchLocalMock = vi.hoisted(() => vi.fn());

vi.mock("simple-git", () => ({
  default: simpleGitFactoryMock,
}));

import { ProjectGitService } from "../../src/main/project-git-service";
import { defineProjectState } from "../../src/main/project-service";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

describe("ProjectGitService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    simpleGitFactoryMock.mockImplementation((projectPath: string) => ({
      checkIsRepo: () => checkIsRepoMock(projectPath),
      branchLocal: () => branchLocalMock(projectPath),
    }));
  });

  it("hydrates git branches for all tracked projects", async () => {
    const projectsState = defineProjectState();
    projectsState.updateState((projects) => {
      projects.push(
        { path: "/repo-one", collapsed: false },
        { path: "/repo-two", collapsed: false },
      );
    });

    checkIsRepoMock.mockResolvedValue(true);
    branchLocalMock.mockImplementation(async (projectPath: string) => {
      if (projectPath === "/repo-one") {
        return { current: "main" };
      }
      return { current: null };
    });

    const service = new ProjectGitService(projectsState, {
      refreshIntervalMs: 60_000,
    });
    await service.refreshAll();

    expect(projectsState.state).toEqual([
      { path: "/repo-one", collapsed: false, gitBranch: "main" },
      { path: "/repo-two", collapsed: false, gitBranch: undefined },
    ]);
  });

  it("refreshes one project without touching the others", async () => {
    const projectsState = defineProjectState();
    projectsState.updateState((projects) => {
      projects.push(
        { path: "/repo-one", collapsed: false, gitBranch: "main" },
        { path: "/repo-two", collapsed: false, gitBranch: "develop" },
      );
    });

    checkIsRepoMock.mockResolvedValue(true);
    branchLocalMock.mockResolvedValue({ current: "release" });

    const service = new ProjectGitService(projectsState, {
      refreshIntervalMs: 60_000,
    });
    await service.refreshProject("/repo-two");

    expect(projectsState.state).toEqual([
      { path: "/repo-one", collapsed: false, gitBranch: "main" },
      { path: "/repo-two", collapsed: false, gitBranch: "release" },
    ]);
    expect(simpleGitFactoryMock).toHaveBeenCalledWith("/repo-two");
    expect(checkIsRepoMock).toHaveBeenCalledWith("/repo-two");
    expect(branchLocalMock).toHaveBeenCalledWith("/repo-two");
  });

  it("skips branch lookup when the path is not a git repo", async () => {
    const projectsState = defineProjectState();
    projectsState.updateState((projects) => {
      projects.push({ path: "/plain-dir", collapsed: false });
    });

    checkIsRepoMock.mockResolvedValue(false);

    const service = new ProjectGitService(projectsState, {
      refreshIntervalMs: 60_000,
    });
    await service.refreshProject("/plain-dir");

    expect(projectsState.state).toEqual([
      { path: "/plain-dir", collapsed: false },
    ]);
    expect(checkIsRepoMock).toHaveBeenCalledWith("/plain-dir");
    expect(branchLocalMock).not.toHaveBeenCalled();
  });

  it("starts refreshing in the background without blocking startup", async () => {
    const projectsState = defineProjectState();
    projectsState.updateState((projects) => {
      projects.push({ path: "/repo-one", collapsed: false });
    });

    const repoOneBranch = createDeferred<{ current: string | null }>();
    checkIsRepoMock.mockResolvedValue(true);
    branchLocalMock.mockImplementation(async (projectPath: string) => {
      if (projectPath === "/repo-one") {
        return repoOneBranch.promise;
      }
      return { current: null };
    });

    const service = new ProjectGitService(projectsState, {
      refreshIntervalMs: 60_000,
    });

    service.start();

    expect(projectsState.state).toEqual([
      { path: "/repo-one", collapsed: false },
    ]);
    await vi.waitFor(() => {
      expect(branchLocalMock).toHaveBeenCalledWith("/repo-one");
    });

    repoOneBranch.resolve({ current: "main" });

    await vi.waitFor(() => {
      expect(projectsState.state).toEqual([
        { path: "/repo-one", collapsed: false, gitBranch: "main" },
      ]);
    });

    service.dispose();
  });

  it("does not clear a new project's branch when refreshAll finishes later", async () => {
    const projectsState = defineProjectState();
    projectsState.updateState((projects) => {
      projects.push({ path: "/repo-one", collapsed: false });
    });

    const repoOneBranch = createDeferred<{ current: string | null }>();
    checkIsRepoMock.mockResolvedValue(true);
    branchLocalMock.mockImplementation(async (projectPath: string) => {
      if (projectPath === "/repo-one") {
        return repoOneBranch.promise;
      }
      if (projectPath === "/repo-two") {
        return { current: "feature/new-project" };
      }
      return { current: null };
    });

    const service = new ProjectGitService(projectsState, {
      refreshIntervalMs: 60_000,
    });

    const refreshAllPromise = service.refreshAll();
    await vi.waitFor(() => {
      expect(branchLocalMock).toHaveBeenCalledWith("/repo-one");
    });

    projectsState.updateState((projects) => {
      projects.push({ path: "/repo-two", collapsed: false });
    });
    await service.refreshProject("/repo-two");

    expect(projectsState.state).toEqual([
      { path: "/repo-one", collapsed: false },
      {
        path: "/repo-two",
        collapsed: false,
        gitBranch: "feature/new-project",
      },
    ]);

    repoOneBranch.resolve({ current: "main" });
    await refreshAllPromise;

    expect(projectsState.state).toEqual([
      { path: "/repo-one", collapsed: false, gitBranch: "main" },
      {
        path: "/repo-two",
        collapsed: false,
        gitBranch: "feature/new-project",
      },
    ]);
  });
});
