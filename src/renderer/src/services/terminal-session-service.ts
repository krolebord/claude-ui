import type { TerminalPaneHandle } from "@renderer/components/terminal-pane";
import { claudeIpc } from "@renderer/lib/ipc";
import type {
  ClaudeModel,
  ClaudeProject,
  ClaudeSessionSnapshot,
  ClaudeSessionsSnapshot,
  SessionId,
  StartClaudeSessionInput,
} from "@shared/claude-types";
export type { ClaudeProject as SidebarProject } from "@shared/claude-types";

export interface NewSessionDialogState {
  open: boolean;
  projectPath: string | null;
  sessionName: string;
  model: ClaudeModel;
  dangerouslySkipPermissions: boolean;
}

export interface ProjectSessionGroup {
  path: string;
  name: string;
  collapsed: boolean;
  fromProjectList: boolean;
  sessions: ClaudeSessionSnapshot[];
}

export interface TerminalSessionState {
  projects: ClaudeProject[];
  sessionsById: Record<SessionId, ClaudeSessionSnapshot>;
  activeSessionId: SessionId | null;
  newSessionDialog: NewSessionDialogState;
  isSelecting: boolean;
  isStarting: boolean;
  isStopping: boolean;
  errorMessage: string;
}

type Listener = () => void;

const SESSION_OUTPUT_MAX_LINES = 10_000;
const SESSION_OUTPUT_MAX_BYTES = 2 * 1024 * 1024;
const SESSION_OUTPUT_COMPACT_THRESHOLD = 1_024;

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder();

interface BufferedOutputLine {
  text: string;
  byteLength: number;
  charLength: number;
}

function getUtf8ByteLength(value: string): number {
  return UTF8_ENCODER.encode(value).length;
}

function trimToUtf8ByteSuffix(value: string, maxBytes: number): string {
  if (maxBytes <= 0 || !value) {
    return "";
  }

  const encoded = UTF8_ENCODER.encode(value);
  if (encoded.length <= maxBytes) {
    return value;
  }

  let start = encoded.length - maxBytes;

  while (
    start < encoded.length &&
    (encoded[start] & 0b1100_0000) === 0b1000_0000
  ) {
    start += 1;
  }

  return UTF8_DECODER.decode(encoded.subarray(start));
}

class SessionOutputRingBuffer {
  private readonly maxLines: number;
  private readonly maxBytes: number;
  private readonly lines: BufferedOutputLine[] = [];
  private firstLineIndex = 0;
  private trailingFragment = "";
  private trailingFragmentBytes = 0;
  private trailingFragmentChars = 0;
  private totalBytes = 0;
  private totalChars = 0;

  constructor(maxLines: number, maxBytes: number) {
    this.maxLines = maxLines;
    this.maxBytes = maxBytes;
  }

  append(chunk: string): void {
    if (!chunk) {
      return;
    }

    const combined = this.trailingFragment + chunk;
    this.clearTrailingFragment();

    const segments = combined.split("\n");
    const nextTrailingFragment = segments.pop() ?? "";

    for (const segment of segments) {
      const lineText = `${segment}\n`;
      const byteLength = getUtf8ByteLength(lineText);
      const charLength = lineText.length;
      this.lines.push({
        text: lineText,
        byteLength,
        charLength,
      });
      this.totalBytes += byteLength;
      this.totalChars += charLength;
    }

    this.setTrailingFragment(nextTrailingFragment);
    this.evictByLineLimit();
    this.evictByByteLimit();
  }

  getCharLength(): number {
    return this.totalChars;
  }

  toString(): string {
    const visibleLines = this.lines.slice(this.firstLineIndex);
    if (visibleLines.length === 0) {
      return this.trailingFragment;
    }

    return (
      visibleLines.map((line) => line.text).join("") + this.trailingFragment
    );
  }

  private getLineCount(): number {
    return this.lines.length - this.firstLineIndex;
  }

  private clearTrailingFragment(): void {
    this.totalBytes -= this.trailingFragmentBytes;
    this.totalChars -= this.trailingFragmentChars;
    this.trailingFragment = "";
    this.trailingFragmentBytes = 0;
    this.trailingFragmentChars = 0;
  }

  private setTrailingFragment(value: string): void {
    this.trailingFragment = value;
    this.trailingFragmentBytes = getUtf8ByteLength(value);
    this.trailingFragmentChars = value.length;
    this.totalBytes += this.trailingFragmentBytes;
    this.totalChars += this.trailingFragmentChars;
  }

  private removeOldestLine(): void {
    if (this.getLineCount() <= 0) {
      return;
    }

    const oldest = this.lines[this.firstLineIndex];
    this.firstLineIndex += 1;
    this.totalBytes -= oldest.byteLength;
    this.totalChars -= oldest.charLength;
    this.compactLinesIfNeeded();
  }

  private compactLinesIfNeeded(): void {
    if (
      this.firstLineIndex >= SESSION_OUTPUT_COMPACT_THRESHOLD &&
      this.firstLineIndex * 2 >= this.lines.length
    ) {
      this.lines.splice(0, this.firstLineIndex);
      this.firstLineIndex = 0;
    }
  }

  private evictByLineLimit(): void {
    while (this.getLineCount() > this.maxLines) {
      this.removeOldestLine();
    }
  }

  private evictByByteLimit(): void {
    while (this.totalBytes > this.maxBytes && this.getLineCount() > 0) {
      this.removeOldestLine();
    }

    if (this.totalBytes <= this.maxBytes || this.getLineCount() > 0) {
      return;
    }

    const trimmedFragment = trimToUtf8ByteSuffix(
      this.trailingFragment,
      this.maxBytes,
    );
    this.clearTrailingFragment();
    this.setTrailingFragment(trimmedFragment);
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
  const byLastActivity =
    toTimestamp(b.lastActivityAt) - toTimestamp(a.lastActivityAt);
  if (byLastActivity !== 0) {
    return byLastActivity;
  }

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

export function getSessionLastActivityLabel(
  session: ClaudeSessionSnapshot,
  now = Date.now(),
): string {
  const timestamp = toTimestamp(session.lastActivityAt);
  if (timestamp <= 0) {
    return "";
  }

  const deltaSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (deltaSeconds < 60) {
    const roundedSeconds = Math.round(deltaSeconds / 10) * 10;
    if (roundedSeconds === 0) {
      return "now";
    }
    return `${roundedSeconds}s`;
  }

  const minutes = Math.floor(deltaSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d`;
  }

  const weeks = Math.floor(days / 7);
  if (weeks < 5) {
    return `${weeks}w`;
  }

  const months = Math.floor(days / 30);
  if (months < 12 || days < 365) {
    return `${months}mo`;
  }

  return `${Math.floor(days / 365)}y`;
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

  if (session.status === "starting" || session.activityState === "working") {
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

  constructor() {
    this.state = {
      projects: [],
      sessionsById: {},
      activeSessionId: null,
      newSessionDialog: {
        open: false,
        projectPath: null,
        sessionName: "",
        model: "opus",
        dangerouslySkipPermissions: false,
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

        const result = await claudeIpc.addClaudeProject({
          path: normalizedPath,
        });
        this.applySnapshot(result.snapshot);
      } catch (error) {
        this.updateState((prev) => ({
          ...prev,
          errorMessage:
            error instanceof Error ? error.message : "Failed to add project.",
        }));
      } finally {
        this.updateState((prev) => ({
          ...prev,
          isSelecting: false,
        }));
      }
    },
    toggleProjectCollapsed: async (projectPath: string): Promise<void> => {
      const project = this.state.projects.find(
        (candidate) => candidate.path === projectPath,
      );
      if (!project) {
        return;
      }

      try {
        const result = await claudeIpc.setClaudeProjectCollapsed({
          path: projectPath,
          collapsed: !project.collapsed,
        });
        this.applySnapshot(result.snapshot);
      } catch (error) {
        this.updateState((prev) => ({
          ...prev,
          errorMessage:
            error instanceof Error
              ? error.message
              : "Failed to update project state.",
        }));
      }
    },
    openNewSessionDialog: (projectPath: string): void => {
      this.updateState((prev) => ({
        ...prev,
        newSessionDialog: {
          open: true,
          projectPath,
          sessionName: "",
          model: "opus",
          dangerouslySkipPermissions: false,
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
          model: "opus",
          dangerouslySkipPermissions: false,
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
    setNewSessionModel: (value: ClaudeModel): void => {
      this.updateState((prev) => ({
        ...prev,
        newSessionDialog: {
          ...prev.newSessionDialog,
          model: value,
        },
      }));
    },
    setNewSessionDangerouslySkipPermissions: (value: boolean): void => {
      this.updateState((prev) => ({
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
      const projectPath = this.state.newSessionDialog.projectPath?.trim() ?? "";
      if (!projectPath || this.state.isStarting) {
        return;
      }

      const sessionName = this.state.newSessionDialog.sessionName;
      const model = this.state.newSessionDialog.model;
      const dangerouslySkipPermissions =
        this.state.newSessionDialog.dangerouslySkipPermissions;

      this.updateState((prev) => ({
        ...prev,
        newSessionDialog: {
          open: false,
          projectPath: null,
          sessionName: "",
          model: "opus",
          dangerouslySkipPermissions: false,
        },
      }));

      await this.startSessionInProject({
        cwd: projectPath,
        sessionName,
        model,
        dangerouslySkipPermissions,
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
    resumeSession: async (
      sessionId: SessionId,
      input: { cols: number; rows: number },
    ): Promise<void> => {
      const session = this.state.sessionsById[sessionId];
      if (!session || session.status !== "stopped" || this.state.isStarting) {
        return;
      }

      await this.startSessionInProject({
        cwd: session.cwd,
        cols: input.cols,
        rows: input.rows,
        resumeSessionId: sessionId,
      });
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
    cols: number;
    rows: number;
    sessionName?: string;
    model?: ClaudeModel;
    dangerouslySkipPermissions?: boolean;
    resumeSessionId?: SessionId;
  }): Promise<void> {
    this.updateState((prev) => ({
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
        startInput.dangerouslySkipPermissions =
          input.dangerouslySkipPermissions;
      }

      const result = await claudeIpc.startClaudeSession(startInput);

      if (!result.ok) {
        this.updateState((prev) => ({
          ...prev,
          errorMessage: result.message,
        }));
        return;
      }

      this.applySnapshot(result.snapshot);
      this.terminal?.clear();
      this.focusTerminal();
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
          this.renderedOutputLength = this.getSessionOutputLength(
            payload.sessionId,
          );
        }
      }),
      claudeIpc.onClaudeSessionExit((payload) => {
        const now = new Date().toISOString();
        if (
          !this.updateSession(payload.sessionId, (session) => ({
            ...session,
            status: "stopped",
            lastActivityAt: now,
          }))
        ) {
          void this.refreshSessions();
        }
      }),
      claudeIpc.onClaudeSessionError((payload) => {
        const now = new Date().toISOString();
        if (
          !this.updateSession(payload.sessionId, (session) => ({
            ...session,
            lastError: payload.message,
            status: "error",
            lastActivityAt: now,
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
        const now = new Date().toISOString();
        if (
          !this.updateSession(payload.sessionId, (session) => ({
            ...session,
            status: payload.status,
            lastError: payload.status === "error" ? session.lastError : null,
            lastActivityAt: now,
          }))
        ) {
          void this.refreshSessions();
        }
      }),
      claudeIpc.onClaudeSessionActivityState((payload) => {
        const now = new Date().toISOString();
        if (
          !this.updateSession(payload.sessionId, (session) => ({
            ...session,
            activityState: payload.activityState,
            lastActivityAt: now,
          }))
        ) {
          void this.refreshSessions();
        }
      }),
      claudeIpc.onClaudeSessionActivityWarning((payload) => {
        const now = new Date().toISOString();
        if (
          !this.updateSession(payload.sessionId, (session) => ({
            ...session,
            activityWarning: payload.warning,
            lastActivityAt: now,
          }))
        ) {
          void this.refreshSessions();
        }
      }),
      claudeIpc.onClaudeSessionTitleChanged((payload) => {
        this.updateSession(payload.sessionId, (session) => ({
          ...session,
          sessionName: payload.title,
        }));
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
      claudeIpc.onClaudeSessionHookEvent((payload) => {
        const fallbackTimestamp = new Date().toISOString();
        const hookTimestamp =
          typeof payload.event.timestamp === "string" &&
          payload.event.timestamp.trim().length > 0
            ? payload.event.timestamp
            : fallbackTimestamp;
        this.updateSession(payload.sessionId, (session) => ({
          ...session,
          lastActivityAt: hookTimestamp,
        }));
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
