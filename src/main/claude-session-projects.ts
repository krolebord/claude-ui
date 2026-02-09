import type {
  AddClaudeProjectInput,
  ClaudeProject,
  DeleteClaudeProjectInput,
  SetClaudeProjectCollapsedInput,
  SetClaudeProjectDefaultsInput,
} from "../shared/claude-types";

type ProjectListResult = { projects: ClaudeProject[]; didChange: boolean };

const unchanged = (projects: ClaudeProject[]): ProjectListResult => ({
  projects,
  didChange: false,
});

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

function updateProjectInList(
  projects: ClaudeProject[],
  projectPath: string,
  update: (project: ClaudeProject) => ClaudeProject,
): ProjectListResult {
  let didChange = false;
  const nextProjects = projects.map((project) => {
    if (project.path !== projectPath) return project;
    const updated = update(project);
    if (updated !== project) didChange = true;
    return updated;
  });

  if (!didChange) return unchanged(projects);
  return { projects: nextProjects, didChange: true };
}

export function addProjectToList(
  projects: ClaudeProject[],
  input: AddClaudeProjectInput,
): ProjectListResult {
  const projectPath = normalizeProjectPath(input.path);
  if (!projectPath || projects.some((p) => p.path === projectPath)) {
    return unchanged(projects);
  }

  return {
    projects: [...projects, { path: projectPath, collapsed: false }],
    didChange: true,
  };
}

export function removeProjectFromList(
  projects: ClaudeProject[],
  input: DeleteClaudeProjectInput,
): ProjectListResult {
  const projectPath = normalizeProjectPath(input.path);
  if (!projectPath) return unchanged(projects);

  const nextProjects = projects.filter((p) => p.path !== projectPath);
  if (nextProjects.length === projects.length) return unchanged(projects);

  return { projects: nextProjects, didChange: true };
}

export function setProjectCollapsedInList(
  projects: ClaudeProject[],
  input: SetClaudeProjectCollapsedInput,
): ProjectListResult {
  const projectPath = normalizeProjectPath(input.path);
  if (!projectPath) return unchanged(projects);

  return updateProjectInList(projects, projectPath, (project) =>
    project.collapsed === input.collapsed
      ? project
      : { ...project, collapsed: input.collapsed },
  );
}

export function setProjectDefaultsInList(
  projects: ClaudeProject[],
  input: SetClaudeProjectDefaultsInput,
): ProjectListResult {
  const projectPath = normalizeProjectPath(input.path);
  if (!projectPath) return unchanged(projects);

  return updateProjectInList(projects, projectPath, (project) =>
    project.defaultModel === input.defaultModel &&
    project.defaultPermissionMode === input.defaultPermissionMode
      ? project
      : {
          ...project,
          defaultModel: input.defaultModel,
          defaultPermissionMode: input.defaultPermissionMode,
        },
  );
}
