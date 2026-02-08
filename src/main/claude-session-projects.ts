import type {
  AddClaudeProjectInput,
  ClaudeProject,
  DeleteClaudeProjectInput,
  SetClaudeProjectCollapsedInput,
  SetClaudeProjectDefaultsInput,
} from "../shared/claude-types";

export function normalizeProjectPath(pathValue: string): string {
  return pathValue.trim();
}

export function normalizeProjects(projects: ClaudeProject[]): ClaudeProject[] {
  const seenPaths = new Set<string>();
  const normalized: ClaudeProject[] = [];

  for (const project of projects) {
    const path = normalizeProjectPath(project.path);
    if (!path || seenPaths.has(path)) {
      continue;
    }

    seenPaths.add(path);
    normalized.push({
      ...project,
      path,
      collapsed: project.collapsed === true,
    });
  }

  return normalized;
}

export function addProjectToList(
  projects: ClaudeProject[],
  input: AddClaudeProjectInput,
): {
  projects: ClaudeProject[];
  didChange: boolean;
} {
  const projectPath = normalizeProjectPath(input.path);
  if (!projectPath) {
    return {
      projects,
      didChange: false,
    };
  }

  if (projects.some((project) => project.path === projectPath)) {
    return {
      projects,
      didChange: false,
    };
  }

  return {
    projects: [
      ...projects,
      {
        path: projectPath,
        collapsed: false,
      },
    ],
    didChange: true,
  };
}

export function removeProjectFromList(
  projects: ClaudeProject[],
  input: DeleteClaudeProjectInput,
): {
  projects: ClaudeProject[];
  didChange: boolean;
} {
  const projectPath = normalizeProjectPath(input.path);
  if (!projectPath) {
    return {
      projects,
      didChange: false,
    };
  }

  const nextProjects = projects.filter(
    (project) => project.path !== projectPath,
  );

  if (nextProjects.length === projects.length) {
    return {
      projects,
      didChange: false,
    };
  }

  return {
    projects: nextProjects,
    didChange: true,
  };
}

export function setProjectCollapsedInList(
  projects: ClaudeProject[],
  input: SetClaudeProjectCollapsedInput,
): {
  projects: ClaudeProject[];
  didChange: boolean;
} {
  const projectPath = normalizeProjectPath(input.path);
  if (!projectPath) {
    return {
      projects,
      didChange: false,
    };
  }

  let didChange = false;
  const nextProjects: ClaudeProject[] = [];

  for (const project of projects) {
    if (project.path !== projectPath) {
      nextProjects.push(project);
      continue;
    }

    if (project.collapsed === input.collapsed) {
      nextProjects.push(project);
      continue;
    }

    didChange = true;
    nextProjects.push({
      ...project,
      collapsed: input.collapsed,
    });
  }

  return {
    projects: didChange ? nextProjects : projects,
    didChange,
  };
}

export function setProjectDefaultsInList(
  projects: ClaudeProject[],
  input: SetClaudeProjectDefaultsInput,
): {
  projects: ClaudeProject[];
  didChange: boolean;
} {
  const projectPath = normalizeProjectPath(input.path);
  if (!projectPath) {
    return {
      projects,
      didChange: false,
    };
  }

  let didChange = false;
  const nextProjects: ClaudeProject[] = [];

  for (const project of projects) {
    if (project.path !== projectPath) {
      nextProjects.push(project);
      continue;
    }

    if (
      project.defaultModel === input.defaultModel &&
      project.defaultPermissionMode === input.defaultPermissionMode
    ) {
      nextProjects.push(project);
      continue;
    }

    didChange = true;
    nextProjects.push({
      ...project,
      defaultModel: input.defaultModel,
      defaultPermissionMode: input.defaultPermissionMode,
    });
  }

  return {
    projects: didChange ? nextProjects : projects,
    didChange,
  };
}
