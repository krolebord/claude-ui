import type { TerminalPaneHandle } from "@renderer/components/terminal-pane";
import { claudeIpc } from "@renderer/lib/ipc";
import type {
  ClaudeModel,
  ClaudePermissionMode,
  ClaudeProject,
  ClaudeSessionSnapshot,
  ClaudeSessionsSnapshot,
  SessionId,
} from "@shared/claude-types";
import {
  SESSION_OUTPUT_MAX_BYTES,
  SESSION_OUTPUT_MAX_LINES,
  SessionOutputRingBuffer,
} from "./session-output-ring-buffer";
import {
  createTerminalSessionActions,
  getDefaultDialogState,
} from "./terminal-session-actions";

export type { ClaudeProject as SidebarProject } from "@shared/claude-types";

export interface NewSessionDialogState {
  open: boolean;
  projectPath: string | null;
  initialPrompt: string;
  sessionName: string;
  model: ClaudeModel;
  permissionMode: ClaudePermissionMode;
}

export interface ProjectDefaultsDialogState {
  open: boolean;
  projectPath: string | null;
  defaultModel: ClaudeModel | undefined;
  defaultPermissionMode: ClaudePermissionMode | undefined;
}

export interface TerminalSessionState {
  projects: ClaudeProject[];
  sessionsById: Record<SessionId, ClaudeSessionSnapshot>;
  activeSessionId: SessionId | null;
  newSessionDialog: NewSessionDialogState;
  projectDefaultsDialog: ProjectDefaultsDialogState;
  settingsDialogOpen: boolean;
  isSelecting: boolean;
  isStarting: boolean;
  isStopping: boolean;
  errorMessage: string;
}

type Listener = () => void;

export class TerminalSessionService {
  private state: TerminalSessionState;
  private sessionOutputById: Record<SessionId, SessionOutputRingBuffer> = {};
  private renderedSessionId: SessionId | null = null;
  private renderedOutputLength = 0;

  private terminal: TerminalPaneHandle | null = null;
  private listeners = new Set<Listener>();
  private unsubscribers: Array<() => void> = [];
  private initialized = false;
  private subscribers = 0;
  private refreshInFlight: Promise<void> | null = null;

  readonly actions: ReturnType<typeof createTerminalSessionActions>;

  constructor() {
    this.state = {
      projects: [],
      sessionsById: {},
      activeSessionId: null,
      newSessionDialog: getDefaultDialogState(null, false),
      projectDefaultsDialog: {
        open: false,
        projectPath: null,
        defaultModel: undefined,
        defaultPermissionMode: undefined,
      },
      settingsDialogOpen: false,
      isSelecting: false,
      isStarting: false,
      isStopping: false,
      errorMessage: "",
    };

    this.actions = createTerminalSessionActions({
      getState: () => this.state,
      updateState: (updater) => {
        this.updateState(updater);
      },
      updateSession: (sessionId, mutate) =>
        this.updateSession(sessionId, mutate),
      applySnapshot: (snapshot) => {
        this.applySnapshot(snapshot);
      },
      refreshSessions: async () => this.refreshSessions(),
      setTerminal: (handle) => {
        this.terminal = handle;
      },
      renderActiveSessionOutput: () => {
        this.renderActiveSessionOutput();
      },
      clearTerminal: () => {
        this.terminal?.clear();
      },
      focusTerminal: () => {
        this.focusTerminal();
      },
    });
  }

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
        this.appendSessionOutput(payload.sessionId, payload.chunk);
        if (payload.sessionId === this.state.activeSessionId) {
          this.terminal?.write(payload.chunk);
          this.renderedSessionId = payload.sessionId;
          this.renderedOutputLength = this.getSessionOutputLength(
            payload.sessionId,
          );
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
      claudeIpc.onClaudeSessionUpdated((payload) => {
        const { sessionId, updates } = payload;

        const didUpdate = this.updateSession(sessionId, (session) => {
          const merged = { ...session, ...updates };
          if ("status" in updates && updates.status !== "error") {
            merged.lastError = null;
          }
          return merged;
        });

        if (
          !didUpdate &&
          ("status" in updates ||
            "activityState" in updates ||
            "activityWarning" in updates)
        ) {
          void this.refreshSessions();
        }
      }),
      claudeIpc.onClaudeActiveSessionChanged((payload) => {
        if (this.state.activeSessionId !== payload.activeSessionId) {
          this.updateState((prev) => ({
            ...prev,
            activeSessionId: payload.activeSessionId,
          }));
          this.renderActiveSessionOutput(true);
          if (payload.activeSessionId) {
            this.focusTerminal();
          }
        }

        if (
          payload.activeSessionId &&
          !(payload.activeSessionId in this.state.sessionsById)
        ) {
          void this.refreshSessions();
        }
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
    const previousActiveSessionId = this.state.activeSessionId;
    const sessionsById = snapshot.sessions.reduce<
      Record<SessionId, ClaudeSessionSnapshot>
    >((acc, session) => {
      acc[session.sessionId] = session;
      return acc;
    }, {});

    this.pruneSessionOutput(
      snapshot.sessions.map((session) => session.sessionId),
    );

    this.updateState((prev) => ({
      ...prev,
      projects: snapshot.projects,
      sessionsById,
      activeSessionId: snapshot.activeSessionId,
    }));

    if (previousActiveSessionId !== snapshot.activeSessionId) {
      this.renderActiveSessionOutput();
    }
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
    this.renderedSessionId = null;
    this.renderedOutputLength = 0;
  }

  private appendSessionOutput(sessionId: SessionId, chunk: string): void {
    let outputBuffer = this.sessionOutputById[sessionId];
    if (!outputBuffer) {
      outputBuffer = new SessionOutputRingBuffer(
        SESSION_OUTPUT_MAX_LINES,
        SESSION_OUTPUT_MAX_BYTES,
      );
      this.sessionOutputById = {
        ...this.sessionOutputById,
        [sessionId]: outputBuffer,
      };
    }

    outputBuffer.append(chunk);
  }

  private pruneSessionOutput(sessionIds: SessionId[]): void {
    const nextOutputById: Record<SessionId, SessionOutputRingBuffer> = {};

    for (const sessionId of sessionIds) {
      const existingOutput = this.sessionOutputById[sessionId];
      if (existingOutput) {
        nextOutputById[sessionId] = existingOutput;
      }
    }

    this.sessionOutputById = nextOutputById;
  }

  private getSessionOutput(sessionId: SessionId | null): string {
    if (!sessionId) {
      return "";
    }

    return this.sessionOutputById[sessionId]?.toString() ?? "";
  }

  private getSessionOutputLength(sessionId: SessionId | null): number {
    if (!sessionId) {
      return 0;
    }

    return this.sessionOutputById[sessionId]?.getCharLength() ?? 0;
  }

  private renderActiveSessionOutput(force = false): void {
    if (!this.terminal) {
      return;
    }

    const activeSessionId = this.state.activeSessionId;
    const output = this.getSessionOutput(activeSessionId);
    const outputLength = this.getSessionOutputLength(activeSessionId);

    if (
      !force &&
      this.renderedSessionId === activeSessionId &&
      this.renderedOutputLength === outputLength
    ) {
      return;
    }

    this.terminal.clear();

    if (!activeSessionId || !output) {
      this.renderedSessionId = activeSessionId;
      this.renderedOutputLength = outputLength;
      return;
    }

    this.terminal.write(output);
    this.renderedSessionId = activeSessionId;
    this.renderedOutputLength = outputLength;
  }

  private focusTerminal(): void {
    this.terminal?.focus();
  }
}

let singleton: TerminalSessionService | null = null;

export function getTerminalSessionService(): TerminalSessionService {
  if (!singleton) {
    singleton = new TerminalSessionService();
  }

  return singleton;
}
