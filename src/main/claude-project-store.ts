import Store from "electron-store";
import type { ClaudeProject } from "../shared/claude-types";

const PROJECTS_KEY = "projects";

interface ClaudeProjectStoreSchema {
  projects: unknown;
}

function parseProjects(rawProjects: unknown): ClaudeProject[] {
  if (!Array.isArray(rawProjects)) {
    return [];
  }

  const seenPaths = new Set<string>();
  const projects: ClaudeProject[] = [];

  for (const candidate of rawProjects) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const rawPath =
      "path" in candidate && typeof candidate.path === "string"
        ? candidate.path.trim()
        : "";

    if (!rawPath || seenPaths.has(rawPath)) {
      continue;
    }

    seenPaths.add(rawPath);
    projects.push({
      path: rawPath,
      collapsed:
        "collapsed" in candidate && typeof candidate.collapsed === "boolean"
          ? candidate.collapsed
          : false,
    });
  }

  return projects;
}

export interface ClaudeProjectStoreLike {
  readProjects: () => ClaudeProject[];
  writeProjects: (projects: ClaudeProject[]) => void;
}

export class ClaudeProjectStore implements ClaudeProjectStoreLike {
  private readonly store: Store<ClaudeProjectStoreSchema>;

  constructor(store?: Store<ClaudeProjectStoreSchema>) {
    this.store =
      store ??
      new Store<ClaudeProjectStoreSchema>({
        name: "claude-ui",
        defaults: {
          [PROJECTS_KEY]: [],
        },
      });
  }

  readProjects(): ClaudeProject[] {
    return parseProjects(this.store.get(PROJECTS_KEY));
  }

  writeProjects(projects: ClaudeProject[]): void {
    this.store.set(PROJECTS_KEY, parseProjects(projects));
  }
}
