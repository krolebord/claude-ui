import type { TerminalPaneHandle } from "@renderer/components/terminal-pane";
import { claudeIpc } from "@renderer/lib/ipc";
import type {
  ClaudeModel,
  SessionId,
  StartClaudeSessionInput,
} from "@shared/claude-types";
import type { TerminalSessionState } from "./terminal-session-service";

interface StartSessionInProjectInput {
  cwd: string;
  cols: number;
  rows: number;
  sessionName?: string;
  model?: ClaudeModel;
  dangerouslySkipPermissions?: boolean;
  resumeSessionId?: SessionId;
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

function getDefaultDialogState(projectPath: string | null, open: boolean) {
  return {
    open,
    projectPath,
    sessionName: "",
    model: "opus" as const,
    dangerouslySkipPermissions: false,
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
    const startInput: StartClaudeSessionInput = {
      cwd: input.cwd,
      cols: input.cols,
      rows: input.rows,
    };

    if (typeof input.resumeSessionId === "string") {
      startInput.resumeSessionId = input.resumeSessionId;
    }

    if (typeof input.sessionName === "string") {
      const normalizedSessionName = input.sessionName.trim();
      startInput.sessionName =
        normalizedSessionName.length > 0 ? normalizedSessionName : null;
    }

    if (typeof input.model !== "undefined") {
      startInput.model = input.model;
    }

    if (typeof input.dangerouslySkipPermissions === "boolean") {
      startInput.dangerouslySkipPermissions = input.dangerouslySkipPermissions;
    }

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
      deps.updateState((prev) => ({
        ...prev,
        newSessionDialog: getDefaultDialogState(projectPath, true),
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
    setNewSessionDangerouslySkipPermissions: (value: boolean): void => {
      deps.updateState((prev) => ({
        ...prev,
        newSessionDialog: {
          ...prev.newSessionDialog,
          dangerouslySkipPermissions: value,
        },
      }));
    },
    confirmNewSession: async (input: {
      cols: number;
      rows: number;
    }): Promise<void> => {
      const current = deps.getState();
      const projectPath = current.newSessionDialog.projectPath?.trim() ?? "";
      if (!projectPath || current.isStarting) {
        return;
      }

      const sessionName = current.newSessionDialog.sessionName;
      const model = current.newSessionDialog.model;
      const dangerouslySkipPermissions =
        current.newSessionDialog.dangerouslySkipPermissions;

      deps.updateState((prev) => ({
        ...prev,
        newSessionDialog: getDefaultDialogState(null, false),
      }));

      await startSessionInProject(deps, {
        cwd: projectPath,
        sessionName,
        model,
        dangerouslySkipPermissions,
        cols: input.cols,
        rows: input.rows,
      });
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
            error instanceof Error ? error.message : "Failed to switch session.",
        }));
      }
    },
    writeToActiveSession: (data: string): void => {
      const sessionId = deps.getState().activeSessionId;
      if (!sessionId) {
        return;
      }

      const now = new Date().toISOString();
      deps.updateSession(sessionId, (session) => ({
        ...session,
        lastActivityAt: now,
      }));
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
  };
}
