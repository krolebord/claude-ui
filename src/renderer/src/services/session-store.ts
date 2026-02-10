import type { TerminalPaneHandle } from "@renderer/components/terminal-pane";
import { claudeIpc } from "@renderer/lib/ipc";
import type {
  ClaudeModel,
  ClaudePermissionMode,
  ClaudeProject,
  ClaudeSessionSnapshot,
  ClaudeSessionsState,
  SessionId,
} from "@shared/claude-types";
import {
  SESSION_OUTPUT_MAX_BYTES,
  SESSION_OUTPUT_MAX_LINES,
  SessionOutputRingBuffer,
} from "./session-output-ring-buffer";
import { StateSyncClient } from "./state-sync-client";
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

export interface SessionStoreState {
  projects: ClaudeProject[];
  sessionsById: Record<SessionId, ClaudeSessionSnapshot>;
  activeSessionId: SessionId | null;
  newSessionDialog: NewSessionDialogState;
  projectDefaultsDialog: ProjectDefaultsDialogState;
  settingsDialogOpen: boolean;
  isSelecting: boolean;
  isStarting: boolean;
  isStopping: boolean;
  isSavingProjectDefaults: boolean;
  loadingSessionIds: Set<SessionId>;
  errorMessage: string;
}

type Listener = () => void;

export class SessionStore {
  private state: SessionStoreState;
  private sessionOutputById: Record<SessionId, SessionOutputRingBuffer> = {};
  private renderedSessionId: SessionId | null = null;
  private renderedOutputLength = 0;

  private terminal: TerminalPaneHandle | null = null;
  private listeners = new Set<Listener>();
  private unsubscribers: Array<() => void> = [];
  private initialized = false;
  private subscribers = 0;

  private readonly stateSyncClient = new StateSyncClient({
    onStateChanged: () => {
      this.syncStateFromSyncedStates();
    },
  });

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
      isSavingProjectDefaults: false,
      loadingSessionIds: new Set(),
      errorMessage: "",
    };

    this.actions = createTerminalSessionActions({
      getState: () => this.state,
      updateState: (updater) => {
        this.updateState(updater);
      },
      getTerminalSize: () =>
        this.terminal?.getSize() ?? {
          cols: 80,
          rows: 24,
        },
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

  readonly getSnapshot = (): SessionStoreState => this.state;

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
      claudeIpc.onClaudeSessionError((payload) => {
        if (payload.sessionId === this.state.activeSessionId) {
          this.updateState((prev) => ({
            ...prev,
            errorMessage: payload.message,
          }));
        }
      }),
    ];

    await this.stateSyncClient.initialize();
    this.syncStateFromSyncedStates();
  }

  private syncStateFromSyncedStates(): void {
    const previousActiveSessionId = this.state.activeSessionId;
    const projects = this.stateSyncClient.getState("projects") ?? [];
    const sessionsById: ClaudeSessionsState =
      this.stateSyncClient.getState("sessions") ?? {};
    const activeSessionState = this.stateSyncClient.getState("activeSession");
    const activeSessionId = activeSessionState?.activeSessionId ?? null;

    this.pruneSessionOutput(Object.keys(sessionsById));

    this.updateState((prev) => ({
      ...prev,
      projects,
      sessionsById,
      activeSessionId,
    }));

    if (previousActiveSessionId !== activeSessionId) {
      this.renderActiveSessionOutput(true);
      if (activeSessionId) {
        this.focusTerminal();
      }
    }
  }

  private updateState(
    updater: (prev: SessionStoreState) => SessionStoreState,
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
    this.stateSyncClient.dispose();
    this.initialized = false;
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

let singleton: SessionStore | null = null;

export function getSessionStore(): SessionStore {
  if (!singleton) {
    singleton = new SessionStore();
  }

  return singleton;
}
