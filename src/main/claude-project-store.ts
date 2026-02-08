import Store from "electron-store";
import { claudeProjectSchema, parseArraySafe } from "../shared/claude-schemas";
import type { ClaudeProject } from "../shared/claude-types";

const PROJECTS_KEY = "projects";

interface ClaudeProjectStoreSchema {
  projects: unknown;
}

function parseProjects(rawProjects: unknown): ClaudeProject[] {
  const parsed = parseArraySafe(claudeProjectSchema, rawProjects);

  const seenPaths = new Set<string>();
  const projects: ClaudeProject[] = [];

  for (const project of parsed) {
    if (seenPaths.has(project.path)) {
      continue;
    }
    seenPaths.add(project.path);
    projects.push(project);
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
