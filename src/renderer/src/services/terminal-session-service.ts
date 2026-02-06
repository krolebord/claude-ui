import type { TerminalPaneHandle } from "@renderer/components/terminal-pane";
import { claudeIpc } from "@renderer/lib/ipc";
import type {
  ClaudeSessionSnapshot,
  ClaudeSessionsSnapshot,
  SessionId,
} from "@shared/claude-types";

const PROJECT_STORAGE_KEY = "claude-ui.projects.v1";

export interface SidebarProject {
  path: string;
  collapsed: boolean;
}

export interface NewSessionDialogState {
  open: boolean;
  projectPath: string | null;
  sessionName: string;
}

export interface ProjectSessionGroup {
  path: string;
  name: string;
  collapsed: boolean;
  fromProjectList: boolean;
  sessions: ClaudeSessionSnapshot[];
}

export interface TerminalSessionState {
  projects: SidebarProject[];
  sessionsById: Record<SessionId, ClaudeSessionSnapshot>;
  activeSessionId: SessionId | null;
  newSessionDialog: NewSessionDialogState;
  isSelecting: boolean;
  isStarting: boolean;
  isStopping: boolean;
  errorMessage: string;
}

type Listener = () => void;

interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

interface TerminalSessionServiceOptions {
  storage?: StorageLike | null;
}

function resolveStorage(): StorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

function parseProjects(rawProjects: string | null): SidebarProject[] {
  if (!rawProjects) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawProjects);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }

        const candidate = entry as {
          path?: unknown;
          collapsed?: unknown;
        };

        if (typeof candidate.path !== "string") {
          return null;
        }

        const path = candidate.path.trim();
        if (!path) {
          return null;
        }

        return {
          path,
          collapsed: candidate.collapsed === true,
        } satisfies SidebarProject;
      })
      .filter((entry): entry is SidebarProject => entry !== null);
  } catch {
    return [];
  }
}

function toTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function compareSessionsByCreatedAtDesc(
  a: ClaudeSessionSnapshot,
  b: ClaudeSessionSnapshot,
): number {
  return toTimestamp(b.createdAt) - toTimestamp(a.createdAt);
}

function getProjectNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);

  return segments[segments.length - 1] ?? path;
}

export function getSessionTitle(session: ClaudeSessionSnapshot): string {
  const sessionName = session.sessionName?.trim() ?? "";
  if (sessionName.length > 0) {
    return sessionName;
  }

  return `Session ${session.sessionId.slice(0, 8)}`;
}

export type SessionSidebarIndicatorState =
  | "idle"
  | "pending"
  | "running"
  | "awaiting_approval"
  | "awaiting_user_response"
  | "stopped"
  | "error";

export function getSessionSidebarIndicatorState(
  session: ClaudeSessionSnapshot,
): SessionSidebarIndicatorState {
  if (session.status === "error") {
    return "error";
  }

  if (session.status === "stopped") {
    return "stopped";
  }

  if (session.activityState === "awaiting_approval") {
    return "awaiting_approval";
  }

  if (session.activityState === "awaiting_user_response") {
    return "awaiting_user_response";
  }

  if (
    session.status === "starting" ||
    session.activityState === "working"
  ) {
    return "pending";
  }

  if (session.status === "running") {
    return "running";
  }

  return "idle";
}

export function buildProjectSessionGroups(
  state: Pick<TerminalSessionState, "projects" | "sessionsById">,
): ProjectSessionGroup[] {
  const allSessions = Object.values(state.sessionsById).sort(
    compareSessionsByCreatedAtDesc,
  );

  const sessionsByPath = new Map<string, ClaudeSessionSnapshot[]>();
  for (const session of allSessions) {
    const bucket = sessionsByPath.get(session.cwd);
    if (bucket) {
      bucket.push(session);
      continue;
    }

    sessionsByPath.set(session.cwd, [session]);
  }

  const groups: ProjectSessionGroup[] = [];
  const seenPaths = new Set<string>();

  for (const project of state.projects) {
    groups.push({
      path: project.path,
      name: getProjectNameFromPath(project.path),
      collapsed: project.collapsed,
      fromProjectList: true,
      sessions: sessionsByPath.get(project.path) ?? [],
    });
    seenPaths.add(project.path);
  }

  for (const [path, sessions] of sessionsByPath.entries()) {
    if (seenPaths.has(path)) {
      continue;
    }

    groups.push({
      path,
      name: getProjectNameFromPath(path),
      collapsed: false,
      fromProjectList: false,
      sessions,
    });
  }

  return groups;
}

export class TerminalSessionService {
  private readonly storage: StorageLike | null;

  private state: TerminalSessionState;
  private sessionOutputById: Record<SessionId, string> = {};
  private renderedSessionId: SessionId | null = null;
  private renderedOutputLength = 0;

  private terminal: TerminalPaneHandle | null = null;
  private listeners = new Set<Listener>();
  private unsubscribers: Array<() => void> = [];
  private initialized = false;
  private subscribers = 0;
  private refreshInFlight: Promise<void> | null = null;

  constructor(options?: TerminalSessionServiceOptions) {
    this.storage = options?.storage ?? resolveStorage();
    this.state = {
      projects: this.readProjects(),
      sessionsById: {},
      activeSessionId: null,
      newSessionDialog: {
        open: false,
        projectPath: null,
        sessionName: "",
      },
      isSelecting: false,
      isStarting: false,
      isStopping: false,
      errorMessage: "",
    };
  }

  readonly actions = {
    addProject: async (): Promise<void> => {
      if (this.state.isSelecting) {
        return;
      }

      this.updateState((prev) => ({
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
          this.state.projects.some((project) => project.path === normalizedPath)
        ) {
          return;
        }

        const nextProjects = [
          ...this.state.projects,
          {
            path: normalizedPath,
            collapsed: false,
          },
        ];

        this.persistProjects(nextProjects);
        this.updateState((prev) => ({
          ...prev,
          projects: nextProjects,
        }));
      } finally {
        this.updateState((prev) => ({
          ...prev,
          isSelecting: false,
        }));
      }
    },
    toggleProjectCollapsed: (projectPath: string): void => {
      let didToggle = false;

      const nextProjects = this.state.projects.map((project) => {
        if (project.path !== projectPath) {
          return project;
        }

        didToggle = true;
        return {
          ...project,
          collapsed: !project.collapsed,
        };
      });

      if (!didToggle) {
        return;
      }

      this.persistProjects(nextProjects);
      this.updateState((prev) => ({
        ...prev,
        projects: nextProjects,
      }));
    },
    openNewSessionDialog: (projectPath: string): void => {
      this.updateState((prev) => ({
        ...prev,
        newSessionDialog: {
          open: true,
          projectPath,
          sessionName: "",
        },
      }));
    },
    closeNewSessionDialog: (): void => {
      this.updateState((prev) => ({
        ...prev,
        newSessionDialog: {
          open: false,
          projectPath: null,
          sessionName: "",
        },
      }));
    },
    setNewSessionName: (value: string): void => {
      this.updateState((prev) => ({
        ...prev,
        newSessionDialog: {
          ...prev.newSessionDialog,
          sessionName: value,
        },
      }));
    },
    confirmNewSession: async (input: {
      cols: number;
      rows: number;
    }): Promise<void> => {
      const projectPath = this.state.newSessionDialog.projectPath?.trim() ?? "";
      if (!projectPath || this.state.isStarting) {
        return;
      }

      const sessionName = this.state.newSessionDialog.sessionName;

      this.updateState((prev) => ({
        ...prev,
        newSessionDialog: {
          open: false,
          projectPath: null,
          sessionName: "",
        },
      }));

      await this.startSessionInProject({
        cwd: projectPath,
        sessionName,
        cols: input.cols,
        rows: input.rows,
      });
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
    stopSession: async (sessionId: SessionId): Promise<void> => {
      if (!(sessionId in this.state.sessionsById)) {
        return;
      }

      try {
        await claudeIpc.stopClaudeSession({ sessionId });
      } catch (error) {
        this.updateState((prev) => ({
          ...prev,
          errorMessage:
            error instanceof Error ? error.message : "Failed to stop session.",
        }));
      }
    },
    deleteSession: async (sessionId: SessionId): Promise<void> => {
      if (!(sessionId in this.state.sessionsById)) {
        return;
      }

      try {
        await claudeIpc.deleteClaudeSession({ sessionId });
        await this.refreshSessions();
      } catch (error) {
        this.updateState((prev) => ({
          ...prev,
          errorMessage:
            error instanceof Error
              ? error.message
              : "Failed to delete session.",
        }));
      }
    },
    setActiveSession: async (sessionId: SessionId): Promise<void> => {
      if (this.state.activeSessionId === sessionId) {
        return;
      }

      try {
        await claudeIpc.setActiveSession({ sessionId });
      } catch (error) {
        this.updateState((prev) => ({
          ...prev,
          errorMessage:
            error instanceof Error
              ? error.message
              : "Failed to switch session.",
        }));
      }
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
      this.renderActiveSessionOutput();
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

  private async startSessionInProject(input: {
    cwd: string;
    sessionName: string;
    cols: number;
    rows: number;
  }): Promise<void> {
    this.updateState((prev) => ({
      ...prev,
      isStarting: true,
      errorMessage: "",
    }));

    try {
      const normalizedSessionName = input.sessionName.trim();
      const result = await claudeIpc.startClaudeSession({
        cwd: input.cwd,
        sessionName:
          normalizedSessionName.length > 0 ? normalizedSessionName : null,
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
          this.renderedOutputLength =
            this.sessionOutputById[payload.sessionId]?.length ?? 0;
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
        if (this.state.activeSessionId !== payload.activeSessionId) {
          this.updateState((prev) => ({
            ...prev,
            activeSessionId: payload.activeSessionId,
          }));
          this.renderActiveSessionOutput(true);
        }

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

  private readProjects(): SidebarProject[] {
    return parseProjects(this.storage?.getItem(PROJECT_STORAGE_KEY) ?? null);
  }

  private persistProjects(projects: SidebarProject[]): void {
    this.storage?.setItem(PROJECT_STORAGE_KEY, JSON.stringify(projects));
  }

  private appendSessionOutput(sessionId: SessionId, chunk: string): void {
    const previous = this.sessionOutputById[sessionId] ?? "";
    this.sessionOutputById = {
      ...this.sessionOutputById,
      [sessionId]: previous + chunk,
    };
  }

  private pruneSessionOutput(sessionIds: SessionId[]): void {
    const nextOutputById: Record<SessionId, string> = {};

    for (const sessionId of sessionIds) {
      nextOutputById[sessionId] = this.sessionOutputById[sessionId] ?? "";
    }

    this.sessionOutputById = nextOutputById;
  }

  private renderActiveSessionOutput(force = false): void {
    if (!this.terminal) {
      return;
    }

    const activeSessionId = this.state.activeSessionId;
    const output = activeSessionId
      ? (this.sessionOutputById[activeSessionId] ?? "")
      : "";

    if (
      !force &&
      this.renderedSessionId === activeSessionId &&
      this.renderedOutputLength === output.length
    ) {
      return;
    }

    this.terminal.clear();

    if (!activeSessionId || !output) {
      this.renderedSessionId = activeSessionId;
      this.renderedOutputLength = output.length;
      return;
    }

    this.terminal.write(output);
    this.renderedSessionId = activeSessionId;
    this.renderedOutputLength = output.length;
  }
}

let singleton: TerminalSessionService | null = null;

export function getTerminalSessionService(): TerminalSessionService {
  if (!singleton) {
    singleton = new TerminalSessionService();
  }

  return singleton;
}
