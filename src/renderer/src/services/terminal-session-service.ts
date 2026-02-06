import type { TerminalPaneHandle } from "@renderer/components/terminal-pane";
import { claudeIpc } from "@renderer/lib/ipc";
import type {
  ClaudeSessionSnapshot,
  ClaudeSessionsSnapshot,
  SessionId,
} from "@shared/claude-types";

export interface TerminalSessionState {
  folderPath: string;
  sessionsById: Record<SessionId, ClaudeSessionSnapshot>;
  activeSessionId: SessionId | null;
  isSelecting: boolean;
  isStarting: boolean;
  isStopping: boolean;
  errorMessage: string;
}

type Listener = () => void;

export class TerminalSessionService {
  private state: TerminalSessionState = {
    folderPath: "",
    sessionsById: {},
    activeSessionId: null,
    isSelecting: false,
    isStarting: false,
    isStopping: false,
    errorMessage: "",
  };

  private terminal: TerminalPaneHandle | null = null;
  private listeners = new Set<Listener>();
  private unsubscribers: Array<() => void> = [];
  private initialized = false;
  private subscribers = 0;
  private refreshInFlight: Promise<void> | null = null;

  readonly actions = {
    selectFolder: async (): Promise<void> => {
      if (this.state.isSelecting) {
        return;
      }

      this.updateState((prev) => ({
        ...prev,
        isSelecting: true,
      }));

      try {
        const selectedPath = await claudeIpc.selectFolder();
        if (selectedPath) {
          this.updateState((prev) => ({
            ...prev,
            folderPath: selectedPath,
          }));
        }
      } finally {
        this.updateState((prev) => ({
          ...prev,
          isSelecting: false,
        }));
      }
    },
    startSession: async (input: {
      cols: number;
      rows: number;
    }): Promise<void> => {
      if (this.state.isStarting) {
        return;
      }

      const cwd = this.state.folderPath.trim();
      if (!cwd) {
        return;
      }

      this.updateState((prev) => ({
        ...prev,
        isStarting: true,
        errorMessage: "",
      }));

      try {
        const active = this.getActiveSession();
        if (
          active &&
          (active.status === "running" || active.status === "starting")
        ) {
          await claudeIpc.stopClaudeSession({ sessionId: active.sessionId });
        }

        const result = await claudeIpc.startClaudeSession({
          cwd,
          cols: input.cols,
          rows: input.rows,
        });

        if (!result.ok) {
          this.updateState((prev) => ({
            ...prev,
            errorMessage: result.message,
          }));
          return;
        }

        this.applySnapshot(result.snapshot);
        this.terminal?.clear();
      } catch (error) {
        this.updateState((prev) => ({
          ...prev,
          errorMessage:
            error instanceof Error ? error.message : "Failed to start session.",
        }));
      } finally {
        this.updateState((prev) => ({
          ...prev,
          isStarting: false,
        }));
      }
    },
    stopActiveSession: async (): Promise<void> => {
      if (this.state.isStopping) {
        return;
      }

      const sessionId = this.state.activeSessionId;
      if (!sessionId) {
        return;
      }

      this.updateState((prev) => ({
        ...prev,
        isStopping: true,
      }));

      try {
        await claudeIpc.stopClaudeSession({ sessionId });
      } catch (error) {
        this.updateState((prev) => ({
          ...prev,
          errorMessage:
            error instanceof Error ? error.message : "Failed to stop session.",
        }));
      } finally {
        this.updateState((prev) => ({
          ...prev,
          isStopping: false,
        }));
      }
    },
    setActiveSession: async (sessionId: SessionId): Promise<void> => {
      if (this.state.activeSessionId === sessionId) {
        return;
      }

      await claudeIpc.setActiveSession({ sessionId });
    },
    writeToActiveSession: (data: string): void => {
      const sessionId = this.state.activeSessionId;
      if (!sessionId) {
        return;
      }

      claudeIpc.writeToClaudeSession({ sessionId, data });
    },
    resizeActiveSession: (cols: number, rows: number): void => {
      const sessionId = this.state.activeSessionId;
      if (!sessionId) {
        return;
      }

      claudeIpc.resizeClaudeSession({ sessionId, cols, rows });
    },
    attachTerminal: (handle: TerminalPaneHandle | null): void => {
      this.terminal = handle;
    },
  };

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): TerminalSessionState => this.state;

  retain(): void {
    this.subscribers += 1;

    if (this.subscribers === 1) {
      void this.initialize();
    }
  }

  release(): void {
    this.subscribers = Math.max(0, this.subscribers - 1);

    if (this.subscribers === 0) {
      this.disposeSubscriptions();
    }
  }

  private async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.initialized = true;

    this.unsubscribers = [
      claudeIpc.onClaudeSessionData((payload) => {
        if (payload.sessionId === this.state.activeSessionId) {
          this.terminal?.write(payload.chunk);
        }
      }),
      claudeIpc.onClaudeSessionExit((payload) => {
        if (
          !this.updateSession(payload.sessionId, (session) => ({
            ...session,
            status: "stopped",
          }))
        ) {
          void this.refreshSessions();
        }
      }),
      claudeIpc.onClaudeSessionError((payload) => {
        if (
          !this.updateSession(payload.sessionId, (session) => ({
            ...session,
            lastError: payload.message,
            status: "error",
          }))
        ) {
          void this.refreshSessions();
          return;
        }

        if (payload.sessionId === this.state.activeSessionId) {
          this.updateState((prev) => ({
            ...prev,
            errorMessage: payload.message,
          }));
        }
      }),
      claudeIpc.onClaudeSessionStatus((payload) => {
        if (
          !this.updateSession(payload.sessionId, (session) => ({
            ...session,
            status: payload.status,
            lastError: payload.status === "error" ? session.lastError : null,
          }))
        ) {
          void this.refreshSessions();
        }
      }),
      claudeIpc.onClaudeSessionActivityState((payload) => {
        if (
          !this.updateSession(payload.sessionId, (session) => ({
            ...session,
            activityState: payload.activityState,
          }))
        ) {
          void this.refreshSessions();
        }
      }),
      claudeIpc.onClaudeSessionActivityWarning((payload) => {
        if (
          !this.updateSession(payload.sessionId, (session) => ({
            ...session,
            activityWarning: payload.warning,
          }))
        ) {
          void this.refreshSessions();
        }
      }),
      claudeIpc.onClaudeActiveSessionChanged((payload) => {
        this.updateState((prev) => ({
          ...prev,
          activeSessionId: payload.activeSessionId,
        }));

        if (
          payload.activeSessionId &&
          !(payload.activeSessionId in this.state.sessionsById)
        ) {
          void this.refreshSessions();
        }
      }),
      claudeIpc.onClaudeSessionHookEvent(() => {
        // Hook events are available for future UI surfaces; no-op for now.
      }),
    ];

    await this.refreshSessions();
  }

  private async refreshSessions(): Promise<void> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    this.refreshInFlight = claudeIpc
      .getSessions()
      .then((snapshot) => {
        this.applySnapshot(snapshot);
      })
      .finally(() => {
        this.refreshInFlight = null;
      });

    return this.refreshInFlight;
  }

  private applySnapshot(snapshot: ClaudeSessionsSnapshot): void {
    const sessionsById = snapshot.sessions.reduce<
      Record<SessionId, ClaudeSessionSnapshot>
    >((acc, session) => {
      acc[session.sessionId] = session;
      return acc;
    }, {});

    this.updateState((prev) => ({
      ...prev,
      sessionsById,
      activeSessionId: snapshot.activeSessionId,
    }));
  }

  private updateSession(
    sessionId: SessionId,
    mutate: (session: ClaudeSessionSnapshot) => ClaudeSessionSnapshot,
  ): boolean {
    const existing = this.state.sessionsById[sessionId];
    if (!existing) {
      return false;
    }

    const nextSession = mutate(existing);

    this.updateState((prev) => ({
      ...prev,
      sessionsById: {
        ...prev.sessionsById,
        [sessionId]: nextSession,
      },
    }));

    return true;
  }

  private getActiveSession(): ClaudeSessionSnapshot | null {
    const sessionId = this.state.activeSessionId;
    if (!sessionId) {
      return null;
    }

    return this.state.sessionsById[sessionId] ?? null;
  }

  private updateState(
    updater: (prev: TerminalSessionState) => TerminalSessionState,
  ): void {
    const next = updater(this.state);
    if (next === this.state) {
      return;
    }

    this.state = next;
    this.emitChange();
  }

  private emitChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private disposeSubscriptions(): void {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }

    this.unsubscribers = [];
    this.initialized = false;
    this.refreshInFlight = null;
    this.terminal = null;
  }
}

let singleton: TerminalSessionService | null = null;

export function getTerminalSessionService(): TerminalSessionService {
  if (!singleton) {
    singleton = new TerminalSessionService();
  }

  return singleton;
}
