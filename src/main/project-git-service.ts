import simpleGit from "simple-git";
import log from "./logger";
import type { ProjectState } from "./project-service";

const DEFAULT_GIT_REFRESH_INTERVAL_MS = 15_000;

async function resolveGitBranch(
  projectPath: string,
): Promise<string | undefined> {
  try {
    const git = simpleGit(projectPath);
    const isRepo = await git.checkIsRepo();

    if (!isRepo) {
      return undefined;
    }

    const summary = await git.branchLocal();
    return summary.current ?? undefined;
  } catch (error) {
    const gitError = error as { message?: string };
    if (gitError?.message) {
      log.warn("Failed to resolve git branch", {
        projectPath,
        message: gitError.message,
      });
    }

    return undefined;
  }
}

export class ProjectGitService {
  private readonly refreshIntervalMs: number;
  private refreshTimer: NodeJS.Timeout | null = null;
  private refreshInFlight: Promise<void> | null = null;
  private disposed = false;

  constructor(
    private readonly projectsState: ProjectState,
    options?: { refreshIntervalMs?: number },
  ) {
    this.refreshIntervalMs =
      options?.refreshIntervalMs ?? DEFAULT_GIT_REFRESH_INTERVAL_MS;
  }

  start(): void {
    this.triggerRefresh();

    this.refreshTimer = setInterval(() => {
      this.triggerRefresh();
    }, this.refreshIntervalMs);
    this.refreshTimer.unref?.();
  }

  async refreshProject(projectPath: string): Promise<void> {
    const gitBranch = await resolveGitBranch(projectPath);
    if (this.disposed) {
      return;
    }

    const project = this.projectsState.state.find(
      (item) => item.path === projectPath,
    );
    if (!project || project.gitBranch === gitBranch) {
      return;
    }

    this.projectsState.updateState((projects) => {
      const draft = projects.find((item) => item.path === projectPath);
      if (!draft || draft.gitBranch === gitBranch) {
        return;
      }
      draft.gitBranch = gitBranch;
    });
  }

  async refreshAll(): Promise<void> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    this.refreshInFlight = (async () => {
      const projectPaths = this.projectsState.state.map(
        (project) => project.path,
      );
      const branches = await Promise.all(
        projectPaths.map(
          async (projectPath) =>
            [projectPath, await resolveGitBranch(projectPath)] as const,
        ),
      );

      if (this.disposed) {
        return;
      }

      const branchByPath = new Map(branches);
      const currentBranchByPath = new Map(
        this.projectsState.state.map((project) => [
          project.path,
          project.gitBranch,
        ]),
      );
      const hasChanges = branches.some(
        ([projectPath, gitBranch]) =>
          currentBranchByPath.get(projectPath) !== gitBranch,
      );

      if (!hasChanges) {
        return;
      }

      this.projectsState.updateState((projects) => {
        for (const project of projects) {
          if (!branchByPath.has(project.path)) {
            continue;
          }

          const gitBranch = branchByPath.get(project.path);
          if (project.gitBranch === gitBranch) {
            continue;
          }

          project.gitBranch = gitBranch;
        }
      });
    })().finally(() => {
      this.refreshInFlight = null;
    });

    return this.refreshInFlight;
  }

  private triggerRefresh(): void {
    void this.refreshAll().catch((error) => {
      if (this.disposed) {
        return;
      }

      log.error("Unexpected project git refresh failure", { error });
    });
  }

  dispose(): void {
    this.disposed = true;
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}
