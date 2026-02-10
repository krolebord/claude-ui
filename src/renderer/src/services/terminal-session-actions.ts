import type { TerminalPaneHandle } from "@renderer/components/terminal-pane";
import { claudeIpc } from "@renderer/lib/ipc";
import {
  claudeModelSchema,
  claudePermissionModeSchema,
} from "@shared/claude-schemas";
import type {
  ClaudeModel,
  ClaudePermissionMode,
  ClaudeProject,
  SessionId,
  StartClaudeSessionInput,
} from "@shared/claude-types";
import * as z from "zod";
import type {
  NewSessionDialogState,
  ProjectDefaultsDialogState,
  SessionStoreState,
} from "./session-store";

interface StartSessionInProjectInput {
  cwd: string;
  cols: number;
  rows: number;
  sessionName?: string;
  model?: ClaudeModel;
  permissionMode?: ClaudePermissionMode;
  resumeSessionId?: SessionId;
  forkSessionId?: SessionId;
  initialPrompt?: string;
}

interface CreateTerminalSessionActionsDeps {
  getState: () => SessionStoreState;
  updateState: (
    updater: (prev: SessionStoreState) => SessionStoreState,
  ) => void;
  getTerminalSize: () => { cols: number; rows: number };
  setTerminal: (handle: TerminalPaneHandle | null) => void;
  renderActiveSessionOutput: () => void;
  clearTerminal: () => void;
  focusTerminal: () => void;
}

export function getDefaultDialogState(
  projectPath: string | null,
  open: boolean,
  projectDefaults?: Pick<
    ClaudeProject,
    "defaultModel" | "defaultPermissionMode"
  >,
) {
  return {
    open,
    projectPath,
    initialPrompt: "",
    sessionName: "",
    model: projectDefaults?.defaultModel ?? ("opus" as const),
    permissionMode:
      projectDefaults?.defaultPermissionMode ?? ("default" as const),
  };
}

function setError(
  deps: CreateTerminalSessionActionsDeps,
  error: unknown,
  fallback: string,
): void {
  deps.updateState((prev) => ({
    ...prev,
    errorMessage: error instanceof Error ? error.message : fallback,
  }));
}

const closedProjectDefaultsDialog: ProjectDefaultsDialogState = {
  open: false,
  projectPath: null,
  defaultModel: undefined,
  defaultPermissionMode: undefined,
};

async function startSessionInProject(
  deps: CreateTerminalSessionActionsDeps,
  input: StartSessionInProjectInput,
): Promise<SessionId | null> {
  deps.updateState((prev) => ({
    ...prev,
    isStarting: true,
    errorMessage: "",
  }));

  try {
    const optionals = z
      .object({
        resumeSessionId: z.string().optional(),
        forkSessionId: z.string().optional(),
        sessionName: z.string().trim().min(1).nullish().catch(null),
        model: claudeModelSchema.optional(),
        permissionMode: claudePermissionModeSchema.optional(),
        initialPrompt: z.string().optional(),
      })
      .parse(input);

    const startInput: StartClaudeSessionInput = {
      cwd: input.cwd,
      cols: input.cols,
      rows: input.rows,
      ...optionals,
    };

    const result = await claudeIpc.startClaudeSession(startInput);

    if (!result.ok) {
      setError(deps, new Error(result.message), result.message);
      return null;
    }

    deps.clearTerminal();
    deps.focusTerminal();
    return result.sessionId;
  } catch (error) {
    setError(deps, error, "Failed to start session.");
    return null;
  } finally {
    deps.updateState((prev) => ({
      ...prev,
      isStarting: false,
    }));
  }
}

export function createTerminalSessionActions(
  deps: CreateTerminalSessionActionsDeps,
) {
  const resolveTerminalSize = (input?: { cols: number; rows: number }): {
    cols: number;
    rows: number;
  } => input ?? deps.getTerminalSize();

  return {
    addProject: async (): Promise<void> => {
      if (deps.getState().isSelecting) {
        return;
      }

      deps.updateState((prev) => ({
        ...prev,
        isSelecting: true,
      }));

      try {
        const selectedPath = await claudeIpc.selectFolder();
        if (!selectedPath) {
          return;
        }

        const normalizedPath = selectedPath.trim();
        if (!normalizedPath) {
          return;
        }

        if (
          deps
            .getState()
            .projects.some((project) => project.path === normalizedPath)
        ) {
          return;
        }

        await claudeIpc.addClaudeProject({
          path: normalizedPath,
        });

        const addedProject = deps
          .getState()
          .projects.find((candidate) => candidate.path === normalizedPath);
        deps.updateState((prev) => ({
          ...prev,
          projectDefaultsDialog: {
            open: true,
            projectPath: normalizedPath,
            defaultModel: addedProject?.defaultModel,
            defaultPermissionMode: addedProject?.defaultPermissionMode,
          },
        }));
      } catch (error) {
        setError(deps, error, "Failed to add project.");
      } finally {
        deps.updateState((prev) => ({
          ...prev,
          isSelecting: false,
        }));
      }
    },
    toggleProjectCollapsed: async (projectPath: string): Promise<void> => {
      const project = deps
        .getState()
        .projects.find((candidate) => candidate.path === projectPath);
      if (!project) {
        return;
      }

      try {
        await claudeIpc.setClaudeProjectCollapsed({
          path: projectPath,
          collapsed: !project.collapsed,
        });
      } catch (error) {
        setError(deps, error, "Failed to update project state.");
      }
    },
    openNewSessionDialog: (projectPath: string): void => {
      const project = deps
        .getState()
        .projects.find((candidate) => candidate.path === projectPath);
      deps.updateState((prev) => ({
        ...prev,
        newSessionDialog: getDefaultDialogState(projectPath, true, project),
      }));
    },
    closeNewSessionDialog: (): void => {
      deps.updateState((prev) => ({
        ...prev,
        newSessionDialog: getDefaultDialogState(null, false),
      }));
    },
    updateNewSessionDialog: <K extends keyof NewSessionDialogState>(
      field: K,
      value: NewSessionDialogState[K],
    ): void => {
      deps.updateState((prev) => ({
        ...prev,
        newSessionDialog: {
          ...prev.newSessionDialog,
          [field]: value,
        },
      }));
    },
    startNewSession: async (
      input: {
        cols: number;
        rows: number;
      } | null = null,
    ): Promise<SessionId | null> => {
      const state = deps.getState();
      const projectPath = state.newSessionDialog.projectPath;
      if (!projectPath || state.isStarting) {
        return null;
      }
      const size = resolveTerminalSize(input ?? undefined);

      const result = await startSessionInProject(deps, {
        cwd: projectPath,
        cols: size.cols,
        rows: size.rows,
        initialPrompt: state.newSessionDialog.initialPrompt,
        sessionName: state.newSessionDialog.sessionName,
        model: state.newSessionDialog.model,
        permissionMode: state.newSessionDialog.permissionMode,
      });

      if (!result) {
        return null;
      }

      deps.updateState((prev) => ({
        ...prev,
        newSessionDialog: getDefaultDialogState(null, false),
      }));
      return result;
    },
    stopActiveSession: async (): Promise<void> => {
      if (deps.getState().isStopping) {
        return;
      }

      const sessionId = deps.getState().activeSessionId;
      if (!sessionId) {
        return;
      }

      deps.updateState((prev) => ({
        ...prev,
        isStopping: true,
        loadingSessionIds: new Set(prev.loadingSessionIds).add(sessionId),
      }));

      try {
        await claudeIpc.stopClaudeSession({ sessionId });
      } catch (error) {
        setError(deps, error, "Failed to stop session.");
      } finally {
        deps.updateState((prev) => {
          const next = new Set(prev.loadingSessionIds);
          next.delete(sessionId);
          return { ...prev, isStopping: false, loadingSessionIds: next };
        });
      }
    },
    stopSession: async (sessionId: SessionId): Promise<void> => {
      if (!(sessionId in deps.getState().sessionsById)) {
        return;
      }

      deps.updateState((prev) => ({
        ...prev,
        loadingSessionIds: new Set(prev.loadingSessionIds).add(sessionId),
      }));

      try {
        await claudeIpc.stopClaudeSession({ sessionId });
      } catch (error) {
        setError(deps, error, "Failed to stop session.");
      } finally {
        deps.updateState((prev) => {
          const next = new Set(prev.loadingSessionIds);
          next.delete(sessionId);
          return { ...prev, loadingSessionIds: next };
        });
      }
    },
    resumeSession: async (
      sessionId: SessionId,
      input?: { cols: number; rows: number },
    ): Promise<SessionId | null> => {
      const state = deps.getState();
      const session = state.sessionsById[sessionId];
      if (!session || session.status !== "stopped" || state.isStarting) {
        return null;
      }
      const size = resolveTerminalSize(input);

      return startSessionInProject(deps, {
        cwd: session.cwd,
        cols: size.cols,
        rows: size.rows,
        resumeSessionId: sessionId,
        permissionMode: session.permissionMode,
      });
    },
    forkSession: async (
      sessionId: SessionId,
      input?: { cols: number; rows: number },
    ): Promise<SessionId | null> => {
      const state = deps.getState();
      const session = state.sessionsById[sessionId];
      if (!session || state.isStarting) {
        return null;
      }
      const size = resolveTerminalSize(input);

      return startSessionInProject(deps, {
        cwd: session.cwd,
        cols: size.cols,
        rows: size.rows,
        forkSessionId: sessionId,
        permissionMode: session.permissionMode,
      });
    },
    deleteProject: async (projectPath: string): Promise<void> => {
      try {
        await claudeIpc.deleteClaudeProject({ path: projectPath });
      } catch (error) {
        setError(deps, error, "Failed to delete project.");
      }
    },
    deleteSession: async (sessionId: SessionId): Promise<void> => {
      if (!(sessionId in deps.getState().sessionsById)) {
        return;
      }

      deps.updateState((prev) => ({
        ...prev,
        loadingSessionIds: new Set(prev.loadingSessionIds).add(sessionId),
      }));

      try {
        await claudeIpc.deleteClaudeSession({ sessionId });
      } catch (error) {
        setError(deps, error, "Failed to delete session.");
      } finally {
        deps.updateState((prev) => {
          const next = new Set(prev.loadingSessionIds);
          next.delete(sessionId);
          return { ...prev, loadingSessionIds: next };
        });
      }
    },
    setActiveSession: async (sessionId: SessionId): Promise<void> => {
      if (deps.getState().activeSessionId === sessionId) {
        return;
      }

      try {
        await claudeIpc.setActiveSession({ sessionId });
      } catch (error) {
        setError(deps, error, "Failed to switch session.");
      }
    },
    writeToActiveSession: (data: string): void => {
      const sessionId = deps.getState().activeSessionId;
      if (!sessionId) {
        return;
      }

      claudeIpc.writeToClaudeSession({ sessionId, data });
    },
    resizeActiveSession: (cols: number, rows: number): void => {
      const sessionId = deps.getState().activeSessionId;
      if (!sessionId) {
        return;
      }

      claudeIpc.resizeClaudeSession({ sessionId, cols, rows });
    },
    attachTerminal: (handle: TerminalPaneHandle | null): void => {
      deps.setTerminal(handle);
      deps.renderActiveSessionOutput();
    },
    openProjectDefaultsDialog: (projectPath: string): void => {
      const project = deps
        .getState()
        .projects.find((candidate) => candidate.path === projectPath);
      deps.updateState((prev) => ({
        ...prev,
        projectDefaultsDialog: {
          open: true,
          projectPath,
          defaultModel: project?.defaultModel,
          defaultPermissionMode: project?.defaultPermissionMode,
        },
      }));
    },
    closeProjectDefaultsDialog: (): void => {
      deps.updateState((prev) => ({
        ...prev,
        projectDefaultsDialog: closedProjectDefaultsDialog,
      }));
    },
    updateProjectDefaultsDialog: <K extends keyof ProjectDefaultsDialogState>(
      field: K,
      value: ProjectDefaultsDialogState[K],
    ): void => {
      deps.updateState((prev) => ({
        ...prev,
        projectDefaultsDialog: {
          ...prev.projectDefaultsDialog,
          [field]: value,
        },
      }));
    },
    saveProjectDefaults: async (): Promise<void> => {
      const state = deps.getState();
      const path = state.projectDefaultsDialog.projectPath;
      if (!path) {
        return;
      }

      deps.updateState((prev) => ({
        ...prev,
        isSavingProjectDefaults: true,
      }));

      try {
        await claudeIpc.setClaudeProjectDefaults({
          path,
          defaultModel: state.projectDefaultsDialog.defaultModel,
          defaultPermissionMode:
            state.projectDefaultsDialog.defaultPermissionMode,
        });
        deps.updateState((prev) => ({
          ...prev,
          projectDefaultsDialog: closedProjectDefaultsDialog,
        }));
      } catch (error) {
        setError(deps, error, "Failed to save project defaults.");
      } finally {
        deps.updateState((prev) => ({
          ...prev,
          isSavingProjectDefaults: false,
        }));
      }
    },
    openSettingsDialog: (): void => {
      deps.updateState((prev) => ({
        ...prev,
        settingsDialogOpen: true,
      }));
    },
    closeSettingsDialog: (): void => {
      deps.updateState((prev) => ({
        ...prev,
        settingsDialogOpen: false,
      }));
    },
  };
}
