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
  ClaudeSessionsSnapshot,
  SessionId,
  StartClaudeSessionInput,
} from "@shared/claude-types";
import * as z from "zod";
import type { TerminalSessionState } from "./terminal-session-service";

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
  getState: () => TerminalSessionState;
  updateState: (
    updater: (prev: TerminalSessionState) => TerminalSessionState,
  ) => void;
  updateSession: (
    sessionId: SessionId,
    mutate: (
      session: TerminalSessionState["sessionsById"][SessionId],
    ) => TerminalSessionState["sessionsById"][SessionId],
  ) => boolean;
  applySnapshot: (
    snapshot: Awaited<ReturnType<typeof claudeIpc.getSessions>>,
  ) => void;
  refreshSessions: () => Promise<void>;
  setTerminal: (handle: TerminalPaneHandle | null) => void;
  renderActiveSessionOutput: () => void;
  clearTerminal: () => void;
  focusTerminal: () => void;
}

function getDefaultDialogState(
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

async function startSessionInProject(
  deps: CreateTerminalSessionActionsDeps,
  input: StartSessionInProjectInput,
): Promise<void> {
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
      deps.updateState((prev) => ({
        ...prev,
        errorMessage: result.message,
      }));
      return;
    }

    deps.applySnapshot(result.snapshot);
    deps.clearTerminal();
    deps.focusTerminal();
  } catch (error) {
    deps.updateState((prev) => ({
      ...prev,
      errorMessage:
        error instanceof Error ? error.message : "Failed to start session.",
    }));
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

        const result = await claudeIpc.addClaudeProject({
          path: normalizedPath,
        });
        deps.applySnapshot(result.snapshot);

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
        deps.updateState((prev) => ({
          ...prev,
          errorMessage:
            error instanceof Error ? error.message : "Failed to add project.",
        }));
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
        const result = await claudeIpc.setClaudeProjectCollapsed({
          path: projectPath,
          collapsed: !project.collapsed,
        });
        deps.applySnapshot(result.snapshot);
      } catch (error) {
        deps.updateState((prev) => ({
          ...prev,
          errorMessage:
            error instanceof Error
              ? error.message
              : "Failed to update project state.",
        }));
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
    setNewSessionName: (value: string): void => {
      deps.updateState((prev) => ({
        ...prev,
        newSessionDialog: {
          ...prev.newSessionDialog,
          sessionName: value,
        },
      }));
    },
    setNewSessionModel: (value: ClaudeModel): void => {
      deps.updateState((prev) => ({
        ...prev,
        newSessionDialog: {
          ...prev.newSessionDialog,
          model: value,
        },
      }));
    },
    setNewSessionInitialPrompt: (value: string): void => {
      deps.updateState((prev) => ({
        ...prev,
        newSessionDialog: {
          ...prev.newSessionDialog,
          initialPrompt: value,
        },
      }));
    },
    setNewSessionPermissionMode: (value: ClaudePermissionMode): void => {
      deps.updateState((prev) => ({
        ...prev,
        newSessionDialog: {
          ...prev.newSessionDialog,
          permissionMode: value,
        },
      }));
    },
    newSessionStarted: (snapshot: ClaudeSessionsSnapshot): void => {
      deps.applySnapshot(snapshot);
      deps.clearTerminal();
      deps.focusTerminal();
      deps.updateState((prev) => ({
        ...prev,
        newSessionDialog: getDefaultDialogState(null, false),
      }));
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
      }));

      try {
        await claudeIpc.stopClaudeSession({ sessionId });
      } catch (error) {
        deps.updateState((prev) => ({
          ...prev,
          errorMessage:
            error instanceof Error ? error.message : "Failed to stop session.",
        }));
      } finally {
        deps.updateState((prev) => ({
          ...prev,
          isStopping: false,
        }));
      }
    },
    stopSession: async (sessionId: SessionId): Promise<void> => {
      if (!(sessionId in deps.getState().sessionsById)) {
        return;
      }

      try {
        await claudeIpc.stopClaudeSession({ sessionId });
      } catch (error) {
        deps.updateState((prev) => ({
          ...prev,
          errorMessage:
            error instanceof Error ? error.message : "Failed to stop session.",
        }));
      }
    },
    resumeSession: async (
      sessionId: SessionId,
      input: { cols: number; rows: number },
    ): Promise<void> => {
      const state = deps.getState();
      const session = state.sessionsById[sessionId];
      if (!session || session.status !== "stopped" || state.isStarting) {
        return;
      }

      await startSessionInProject(deps, {
        cwd: session.cwd,
        cols: input.cols,
        rows: input.rows,
        resumeSessionId: sessionId,
      });
    },
    forkSession: async (
      sessionId: SessionId,
      input: { cols: number; rows: number },
    ): Promise<void> => {
      const state = deps.getState();
      const session = state.sessionsById[sessionId];
      if (!session || state.isStarting) {
        return;
      }

      await startSessionInProject(deps, {
        cwd: session.cwd,
        cols: input.cols,
        rows: input.rows,
        forkSessionId: sessionId,
      });
    },
    deleteProject: async (projectPath: string): Promise<void> => {
      try {
        await claudeIpc.deleteClaudeProject({ path: projectPath });
        await deps.refreshSessions();
      } catch (error) {
        deps.updateState((prev) => ({
          ...prev,
          errorMessage:
            error instanceof Error
              ? error.message
              : "Failed to delete project.",
        }));
      }
    },
    deleteSession: async (sessionId: SessionId): Promise<void> => {
      if (!(sessionId in deps.getState().sessionsById)) {
        return;
      }

      try {
        await claudeIpc.deleteClaudeSession({ sessionId });
        await deps.refreshSessions();
      } catch (error) {
        deps.updateState((prev) => ({
          ...prev,
          errorMessage:
            error instanceof Error
              ? error.message
              : "Failed to delete session.",
        }));
      }
    },
    setActiveSession: async (sessionId: SessionId): Promise<void> => {
      if (deps.getState().activeSessionId === sessionId) {
        return;
      }

      try {
        await claudeIpc.setActiveSession({ sessionId });
      } catch (error) {
        deps.updateState((prev) => ({
          ...prev,
          errorMessage:
            error instanceof Error
              ? error.message
              : "Failed to switch session.",
        }));
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
        projectDefaultsDialog: {
          open: false,
          projectPath: null,
          defaultModel: undefined,
          defaultPermissionMode: undefined,
        },
      }));
    },
    setProjectDefaultModel: (value: ClaudeModel | undefined): void => {
      deps.updateState((prev) => ({
        ...prev,
        projectDefaultsDialog: {
          ...prev.projectDefaultsDialog,
          defaultModel: value,
        },
      }));
    },
    setProjectDefaultPermissionMode: (
      value: ClaudePermissionMode | undefined,
    ): void => {
      deps.updateState((prev) => ({
        ...prev,
        projectDefaultsDialog: {
          ...prev.projectDefaultsDialog,
          defaultPermissionMode: value,
        },
      }));
    },
    projectDefaultsSaved: (snapshot: ClaudeSessionsSnapshot): void => {
      deps.applySnapshot(snapshot);
      deps.updateState((prev) => ({
        ...prev,
        projectDefaultsDialog: {
          open: false,
          projectPath: null,
          defaultModel: undefined,
          defaultPermissionMode: undefined,
        },
      }));
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
