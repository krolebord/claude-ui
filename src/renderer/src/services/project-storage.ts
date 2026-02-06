export const PROJECT_STORAGE_KEY = "claude-ui.projects.v1";

export interface SidebarProject {
  path: string;
  collapsed: boolean;
}

interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

interface ProjectStorageOptions {
  storage?: StorageLike | null;
  key?: string;
}

function resolveStorage(): StorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

function parseProjects(rawProjects: string | null): SidebarProject[] {
  if (!rawProjects) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawProjects);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }

        const candidate = entry as {
          path?: unknown;
          collapsed?: unknown;
        };

        if (typeof candidate.path !== "string") {
          return null;
        }

        const path = candidate.path.trim();
        if (!path) {
          return null;
        }

        return {
          path,
          collapsed: candidate.collapsed === true,
        } satisfies SidebarProject;
      })
      .filter((entry): entry is SidebarProject => entry !== null);
  } catch {
    return [];
  }
}

export class ProjectStorage {
  private readonly storage: StorageLike | null;
  private readonly key: string;

  constructor(options?: ProjectStorageOptions) {
    this.storage = options?.storage ?? resolveStorage();
    this.key = options?.key ?? PROJECT_STORAGE_KEY;
  }

  readProjects(): SidebarProject[] {
    return parseProjects(this.storage?.getItem(this.key) ?? null);
  }

  writeProjects(projects: SidebarProject[]): void {
    this.storage?.setItem(this.key, JSON.stringify(projects));
  }
}
