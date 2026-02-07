import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AddClaudeProjectInput,
  AddClaudeProjectResult,
  ClaudeActiveSessionChangedEvent,
  ClaudeActivityState,
  ClaudeHookEvent,
  ClaudeProject,
  ClaudeSessionActivityStateEvent,
  ClaudeSessionActivityWarningEvent,
  ClaudeSessionDataEvent,
  ClaudeSessionErrorEvent,
  ClaudeSessionExitEvent,
  ClaudeSessionHookEvent,
  ClaudeSessionSnapshot,
  ClaudeSessionStatus,
  ClaudeSessionStatusEvent,
  ClaudeSessionTitleChangedEvent,
  ClaudeSessionsSnapshot,
  DeleteClaudeSessionInput,
  DeleteClaudeSessionResult,
  SessionId,
  SetClaudeProjectCollapsedInput,
  SetClaudeProjectCollapsedResult,
  StartClaudeSessionInput,
  StartClaudeSessionResult,
  StopClaudeSessionInput,
  StopClaudeSessionResult,
} from "../shared/claude-types";
import { ClaudeActivityMonitor } from "./claude-activity-monitor";
import type { ClaudeProjectStoreLike } from "./claude-project-store";
import { ClaudeSessionManager } from "./claude-session";
import type { ClaudeSessionSnapshotStoreLike } from "./claude-session-snapshot-store";
import { generateSessionTitle } from "./generate-session-title";

interface ClaudeSessionServiceCallbacks {
  emitSessionData: (payload: ClaudeSessionDataEvent) => void;
  emitSessionExit: (payload: ClaudeSessionExitEvent) => void;
  emitSessionError: (payload: ClaudeSessionErrorEvent) => void;
  emitSessionStatus: (payload: ClaudeSessionStatusEvent) => void;
  emitSessionActivityState: (payload: ClaudeSessionActivityStateEvent) => void;
  emitSessionActivityWarning: (
    payload: ClaudeSessionActivityWarningEvent,
  ) => void;
  emitSessionTitleChanged: (payload: ClaudeSessionTitleChangedEvent) => void;
  emitActiveSessionChanged: (payload: ClaudeActiveSessionChangedEvent) => void;
  emitSessionHookEvent?: (payload: ClaudeSessionHookEvent) => void;
}

interface ClaudeSessionServiceOptions {
  userDataPath: string;
  pluginDir: string | null;
  pluginWarning: string | null;
  callbacks: ClaudeSessionServiceCallbacks;
  sessionManagerFactory?: (
    callbacks: ConstructorParameters<typeof ClaudeSessionManager>[0],
  ) => SessionManagerLike;
  activityMonitorFactory?: (
    callbacks: ConstructorParameters<typeof ClaudeActivityMonitor>[0],
  ) => ActivityMonitorLike;
  stateFileFactory?: () => Promise<string>;
  sessionIdFactory?: () => SessionId;
  nowFactory?: () => string;
  generateTitleFactory?: (prompt: string) => Promise<string>;
  projectStore?: ClaudeProjectStoreLike;
  sessionSnapshotStore?: ClaudeSessionSnapshotStoreLike;
}

interface SessionManagerLike {
  start: InstanceType<typeof ClaudeSessionManager>["start"];
  stop: InstanceType<typeof ClaudeSessionManager>["stop"];
  write: InstanceType<typeof ClaudeSessionManager>["write"];
  resize: InstanceType<typeof ClaudeSessionManager>["resize"];
  dispose: InstanceType<typeof ClaudeSessionManager>["dispose"];
}

interface ActivityMonitorLike {
  startMonitoring: InstanceType<
    typeof ClaudeActivityMonitor
  >["startMonitoring"];
  stopMonitoring: InstanceType<typeof ClaudeActivityMonitor>["stopMonitoring"];
}

interface SessionRecord {
  sessionId: SessionId;
  cwd: string;
  sessionName: string | null;
  createdAt: string;
  lastActivityAt: string;
  status: ClaudeSessionStatus;
  activityState: ClaudeActivityState;
  activityWarning: string | null;
  lastError: string | null;
  manager: SessionManagerLike;
  monitor: ActivityMonitorLike;
  ready: boolean;
  pendingEvents: Array<() => void>;
  titleGenerationTriggered: boolean;
}

type SessionActivityPersistMode = "immediate" | "debounced";

const SESSION_ACTIVITY_PERSIST_DEBOUNCE_MS = 1000;

export class ClaudeSessionService {
  private readonly userDataPath: string;
  private readonly pluginDir: string | null;
  private readonly pluginWarning: string | null;
  private readonly callbacks: ClaudeSessionServiceCallbacks;
  private readonly sessionManagerFactory: NonNullable<
    ClaudeSessionServiceOptions["sessionManagerFactory"]
  >;
  private readonly activityMonitorFactory: NonNullable<
    ClaudeSessionServiceOptions["activityMonitorFactory"]
  >;
  private readonly stateFileFactory: NonNullable<
    ClaudeSessionServiceOptions["stateFileFactory"]
  >;
  private readonly sessionIdFactory: NonNullable<
    ClaudeSessionServiceOptions["sessionIdFactory"]
  >;
  private readonly nowFactory: NonNullable<
    ClaudeSessionServiceOptions["nowFactory"]
  >;
  private readonly generateTitleFactory: NonNullable<
    ClaudeSessionServiceOptions["generateTitleFactory"]
  >;
  private readonly projectStore: ClaudeProjectStoreLike;
  private readonly sessionSnapshotStore: ClaudeSessionSnapshotStoreLike;
  private readonly sessions = new Map<SessionId, SessionRecord>();
  private projects: ClaudeProject[] = [];
  private activeSessionId: SessionId | null = null;
  private pendingSessionSnapshotPersist: NodeJS.Timeout | null = null;

  constructor(options: ClaudeSessionServiceOptions) {
    this.userDataPath = options.userDataPath;
    this.pluginDir = options.pluginDir;
    this.pluginWarning = options.pluginWarning;
    this.callbacks = options.callbacks;
    this.sessionManagerFactory =
      options.sessionManagerFactory ??
      ((callbacks) => new ClaudeSessionManager(callbacks));
    this.activityMonitorFactory =
      options.activityMonitorFactory ??
      ((callbacks) => new ClaudeActivityMonitor(callbacks));
    this.stateFileFactory =
      options.stateFileFactory ?? (() => this.createStateFile());
    this.sessionIdFactory = options.sessionIdFactory ?? (() => randomUUID());
    this.nowFactory = options.nowFactory ?? (() => new Date().toISOString());
    this.generateTitleFactory =
      options.generateTitleFactory ?? generateSessionTitle;
    this.projectStore = options.projectStore ?? {
      readProjects: () => [],
      writeProjects: () => undefined,
    };
    this.sessionSnapshotStore = options.sessionSnapshotStore ?? {
      readSessionSnapshotState: () => ({
        sessions: [],
        activeSessionId: null,
      }),
      writeSessionSnapshotState: () => undefined,
    };
    this.projects = this.normalizeProjects(this.projectStore.readProjects());
    this.hydratePersistedSessions();
    this.persistSessionSnapshots();
  }

  getSessionsSnapshot(): ClaudeSessionsSnapshot {
    const sessions = Array.from(this.sessions.values()).map((session) =>
      this.toSnapshot(session),
    );

    return {
      projects: this.projects.map((project) => ({ ...project })),
      sessions,
      activeSessionId:
        this.activeSessionId && this.sessions.has(this.activeSessionId)
          ? this.activeSessionId
          : null,
    };
  }

  addProject(input: AddClaudeProjectInput): AddClaudeProjectResult {
    const projectPath = this.normalizeProjectPath(input.path);
    if (!projectPath) {
      return {
        ok: true,
        snapshot: this.getSessionsSnapshot(),
      };
    }

    if (this.projects.some((project) => project.path === projectPath)) {
      return {
        ok: true,
        snapshot: this.getSessionsSnapshot(),
      };
    }

    this.projects = [
      ...this.projects,
      {
        path: projectPath,
        collapsed: false,
      },
    ];
    this.persistProjects();

    return {
      ok: true,
      snapshot: this.getSessionsSnapshot(),
    };
  }

  setProjectCollapsed(
    input: SetClaudeProjectCollapsedInput,
  ): SetClaudeProjectCollapsedResult {
    const projectPath = this.normalizeProjectPath(input.path);
    if (!projectPath) {
      return {
        ok: true,
        snapshot: this.getSessionsSnapshot(),
      };
    }

    let didChange = false;
    this.projects = this.projects.map((project) => {
      if (project.path !== projectPath) {
        return project;
      }

      if (project.collapsed === input.collapsed) {
        return project;
      }

      didChange = true;
      return {
        ...project,
        collapsed: input.collapsed,
      };
    });

    if (didChange) {
      this.persistProjects();
    }

    return {
      ok: true,
      snapshot: this.getSessionsSnapshot(),
    };
  }

  async startSession(
    input: StartClaudeSessionInput,
  ): Promise<StartClaudeSessionResult> {
    const resumeSessionId = this.normalizeResumeSessionId(
      input.resumeSessionId,
    );
    if (resumeSessionId) {
      return this.resumeStoppedSession(resumeSessionId, input);
    }

    const sessionId = this.createUniqueSessionId();
    const record = this.createRecord(
      sessionId,
      input.cwd,
      this.normalizeSessionName(input.sessionName),
    );
    this.sessions.set(sessionId, record);
    this.persistSessionSnapshots();

    try {
      const stateFilePath = await this.stateFileFactory();
      record.monitor.startMonitoring(stateFilePath);

      const result = await record.manager.start(input, {
        pluginDir: this.pluginDir,
        stateFilePath,
        sessionId: record.sessionId,
      });

      if (!result.ok) {
        this.removeSessionRecord(sessionId, record);
        record.monitor.stopMonitoring();
        record.manager.dispose();
        if (this.activeSessionId === sessionId) {
          this.setActiveSessionInternal(null);
        }
        return result;
      }

      record.ready = true;
      this.setActiveSessionInternal(record.sessionId);
      this.flushPendingEvents(record);

      return {
        ok: true,
        sessionId: record.sessionId,
        snapshot: this.getSessionsSnapshot(),
      };
    } catch (error) {
      this.removeSessionRecord(sessionId, record);
      record.monitor.stopMonitoring();
      record.manager.dispose();
      if (this.activeSessionId === sessionId) {
        this.setActiveSessionInternal(null);
      }

      return {
        ok: false,
        message:
          error instanceof Error
            ? `Failed to start session: ${error.message}`
            : "Failed to start session due to an unknown error.",
      };
    }
  }

  private async resumeStoppedSession(
    sessionId: SessionId,
    input: StartClaudeSessionInput,
  ): Promise<StartClaudeSessionResult> {
    const record = this.sessions.get(sessionId);
    if (!record) {
      return {
        ok: false,
        message: `Session does not exist: ${sessionId}`,
      };
    }

    if (record.status === "starting" || record.status === "running") {
      this.setActiveSessionInternal(record.sessionId);
      return {
        ok: true,
        sessionId: record.sessionId,
        snapshot: this.getSessionsSnapshot(),
      };
    }

    try {
      const stateFilePath = await this.stateFileFactory();
      record.monitor.startMonitoring(stateFilePath);

      const result = await record.manager.start(
        {
          cwd: record.cwd,
          cols: input.cols,
          rows: input.rows,
          dangerouslySkipPermissions: input.dangerouslySkipPermissions,
          model: input.model,
        },
        {
          pluginDir: this.pluginDir,
          stateFilePath,
          resumeSessionId: record.sessionId,
        },
      );

      if (!result.ok) {
        record.monitor.stopMonitoring();
        return result;
      }

      this.setActiveSessionInternal(record.sessionId);
      return {
        ok: true,
        sessionId: record.sessionId,
        snapshot: this.getSessionsSnapshot(),
      };
    } catch (error) {
      record.monitor.stopMonitoring();
      return {
        ok: false,
        message:
          error instanceof Error
            ? `Failed to resume session: ${error.message}`
            : "Failed to resume session due to an unknown error.",
      };
    }
  }

  async stopSession(
    input: StopClaudeSessionInput,
  ): Promise<StopClaudeSessionResult> {
    const record = this.sessions.get(input.sessionId);
    if (!record) {
      return { ok: true };
    }

    await record.manager.stop();
    return { ok: true };
  }

  async deleteSession(
    input: DeleteClaudeSessionInput,
  ): Promise<DeleteClaudeSessionResult> {
    const record = this.sessions.get(input.sessionId);
    if (!record) {
      return { ok: true };
    }

    let stopError: unknown = null;

    record.monitor.stopMonitoring();

    try {
      await record.manager.stop();
    } catch (error) {
      stopError = error;
    } finally {
      record.manager.dispose();
      this.removeSessionRecord(input.sessionId, record);

      if (this.activeSessionId === input.sessionId) {
        this.setActiveSessionInternal(null);
      }
    }

    if (stopError) {
      throw stopError;
    }

    return { ok: true };
  }

  async setActiveSession(sessionId: SessionId): Promise<void> {
    if (!this.sessions.has(sessionId)) {
      return;
    }

    this.setActiveSessionInternal(sessionId);
  }

  writeToSession(sessionId: SessionId, data: string): void {
    const record = this.sessions.get(sessionId);
    if (!record) {
      return;
    }

    record.manager.write(data);
  }

  resizeSession(sessionId: SessionId, cols: number, rows: number): void {
    const record = this.sessions.get(sessionId);
    if (!record) {
      return;
    }

    record.manager.resize(cols, rows);
  }

  dispose(): void {
    this.clearPendingSessionSnapshotPersist();

    const uniqueRecords = new Set(this.sessions.values());
    for (const record of uniqueRecords) {
      record.monitor.stopMonitoring();
      record.manager.dispose();
    }

    this.sessions.clear();
    this.activeSessionId = null;
  }

  private toSnapshot(record: SessionRecord): ClaudeSessionSnapshot {
    return {
      sessionId: record.sessionId,
      cwd: record.cwd,
      sessionName: record.sessionName,
      status: record.status,
      activityState: record.activityState,
      activityWarning: record.activityWarning,
      lastError: record.lastError,
      createdAt: record.createdAt,
      lastActivityAt: record.lastActivityAt,
    };
  }

  private createRecord(
    sessionId: SessionId,
    cwd: string,
    sessionName: string | null,
  ): SessionRecord {
    const createdAt = this.nowFactory();
    const record: SessionRecord = {
      sessionId,
      cwd,
      sessionName,
      createdAt,
      lastActivityAt: createdAt,
      status: "idle",
      activityState: "unknown",
      activityWarning: this.pluginWarning,
      lastError: null,
      manager: null as unknown as SessionManagerLike,
      monitor: null as unknown as ActivityMonitorLike,
      ready: false,
      pendingEvents: [],
      titleGenerationTriggered: sessionName !== null,
    };

    const monitor = this.activityMonitorFactory({
      emitActivityState: (activityState) => {
        record.activityState = activityState;
        this.touchSessionActivity(record);
        this.emitOrQueue(record, () => {
          this.callbacks.emitSessionActivityState({
            sessionId: record.sessionId,
            activityState,
          });
        });
      },
      emitHookEvent: (event) => {
        this.touchSessionActivity(record, event.timestamp);
        this.maybeGenerateTitleFromHook(record, event);
        this.emitOrQueue(record, () => {
          this.callbacks.emitSessionHookEvent?.({
            sessionId: record.sessionId,
            event,
          });
        });
      },
    });

    const manager = this.sessionManagerFactory({
      emitData: (chunk) => {
        this.emitOrQueue(record, () => {
          this.callbacks.emitSessionData({
            sessionId: record.sessionId,
            chunk,
          });
        });
      },
      emitExit: (payload) => {
        monitor.stopMonitoring({ preserveState: true });
        this.touchSessionActivity(record);
        this.emitOrQueue(record, () => {
          this.callbacks.emitSessionExit({
            sessionId: record.sessionId,
            ...payload,
          });
        });
      },
      emitError: (payload) => {
        record.lastError = payload.message;
        this.touchSessionActivity(record);
        this.emitOrQueue(record, () => {
          this.callbacks.emitSessionError({
            sessionId: record.sessionId,
            message: payload.message,
          });
        });
      },
      emitStatus: (status) => {
        record.status = status;
        if (status !== "error") {
          record.lastError = null;
        }
        this.touchSessionActivity(record);
        this.emitOrQueue(record, () => {
          this.callbacks.emitSessionStatus({
            sessionId: record.sessionId,
            status,
          });
        });
      },
    });

    record.manager = manager;
    record.monitor = monitor;

    if (record.activityWarning !== null) {
      this.emitOrQueue(record, () => {
        this.callbacks.emitSessionActivityWarning({
          sessionId: record.sessionId,
          warning: record.activityWarning,
        });
      });
    }

    return record;
  }

  private emitOrQueue(record: SessionRecord, emit: () => void): void {
    if (!record.ready) {
      record.pendingEvents.push(emit);
      return;
    }

    emit();
  }

  private flushPendingEvents(record: SessionRecord): void {
    const pending = [...record.pendingEvents];
    record.pendingEvents = [];

    for (const emit of pending) {
      emit();
    }
  }

  private setActiveSessionInternal(sessionId: SessionId | null): void {
    if (sessionId !== null && !this.sessions.has(sessionId)) {
      return;
    }

    if (this.activeSessionId === sessionId) {
      return;
    }

    this.activeSessionId = sessionId;
    this.persistSessionSnapshots();
    this.callbacks.emitActiveSessionChanged({
      activeSessionId: sessionId,
    });
  }

  private removeSessionRecord(
    sessionId: SessionId,
    record: SessionRecord,
  ): void {
    if (this.sessions.get(sessionId) === record) {
      this.sessions.delete(sessionId);
      this.persistSessionSnapshots();
    }
  }

  private normalizeSessionName(sessionName?: string | null): string | null {
    if (typeof sessionName !== "string") {
      return null;
    }

    const trimmed = sessionName.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private normalizeResumeSessionId(sessionId?: SessionId): SessionId | null {
    if (typeof sessionId !== "string") {
      return null;
    }

    const trimmed = sessionId.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private normalizeProjects(projects: ClaudeProject[]): ClaudeProject[] {
    const seenPaths = new Set<string>();
    const normalized: ClaudeProject[] = [];

    for (const project of projects) {
      const path = this.normalizeProjectPath(project.path);
      if (!path || seenPaths.has(path)) {
        continue;
      }

      seenPaths.add(path);
      normalized.push({
        path,
        collapsed: project.collapsed === true,
      });
    }

    return normalized;
  }

  private persistProjects(): void {
    this.projectStore.writeProjects(this.projects);
  }

  private normalizeProjectPath(pathValue: string): string {
    return pathValue.trim();
  }

  private maybeGenerateTitleFromHook(
    record: SessionRecord,
    event: ClaudeHookEvent,
  ): void {
    if (record.titleGenerationTriggered) {
      return;
    }

    if (event.hook_event_name !== "UserPromptSubmit") {
      return;
    }

    const prompt = event.prompt?.trim();

    if (!prompt) {
      return;
    }

    record.titleGenerationTriggered = true;

    void this.generateTitleFactory(prompt)
      .then((title) => {
        if (!this.sessions.has(record.sessionId)) {
          return;
        }

        record.sessionName = title;
        this.persistSessionSnapshots();
        this.callbacks.emitSessionTitleChanged({
          sessionId: record.sessionId,
          title,
        });
      })
      .catch(() => {
        // Title generation failures are non-fatal and should not impact sessions.
      });
  }

  private async createStateFile(): Promise<string> {
    const stateDir = path.join(this.userDataPath, "claude-state");
    const stateFilePath = path.join(stateDir, `${randomUUID()}.ndjson`);

    await mkdir(stateDir, { recursive: true });
    await writeFile(stateFilePath, "", "utf8");

    return stateFilePath;
  }

  private hydratePersistedSessions(): void {
    const persisted = this.sessionSnapshotStore.readSessionSnapshotState();
    const seenSessionIds = new Set<SessionId>();

    for (const snapshot of persisted.sessions) {
      const sessionId = this.normalizeResumeSessionId(snapshot.sessionId);
      const cwd = this.normalizeProjectPath(snapshot.cwd);
      if (!sessionId || !cwd || seenSessionIds.has(sessionId)) {
        continue;
      }

      seenSessionIds.add(sessionId);

      const record = this.createRecord(
        sessionId,
        cwd,
        this.normalizeSessionName(snapshot.sessionName),
      );

      record.createdAt = this.normalizeCreatedAt(snapshot.createdAt);
      record.lastActivityAt = this.normalizeLastActivityAt(
        snapshot.lastActivityAt,
        record.createdAt,
      );
      record.status = "stopped";
      record.activityState = "idle";
      record.activityWarning = this.pluginWarning;
      record.lastError = snapshot.lastError;
      record.ready = true;
      record.pendingEvents = [];

      this.sessions.set(sessionId, record);
    }

    const normalizedActiveSessionId = this.normalizeResumeSessionId(
      persisted.activeSessionId ?? undefined,
    );
    this.activeSessionId =
      normalizedActiveSessionId && this.sessions.has(normalizedActiveSessionId)
        ? normalizedActiveSessionId
        : null;
  }

  private normalizeCreatedAt(createdAt: string): string {
    const normalized = createdAt.trim();
    return normalized.length > 0 ? normalized : this.nowFactory();
  }

  private normalizeLastActivityAt(
    lastActivityAt: string,
    fallbackTimestamp: string,
  ): string {
    const normalized = lastActivityAt.trim();
    return normalized.length > 0 ? normalized : fallbackTimestamp;
  }

  private touchSessionActivity(
    record: SessionRecord,
    sourceTimestamp?: string | null,
    persistMode: SessionActivityPersistMode = "immediate",
  ): void {
    const nextTimestamp =
      typeof sourceTimestamp === "string"
        ? this.normalizeLastActivityAt(sourceTimestamp, this.nowFactory())
        : this.nowFactory();

    if (!this.isTimestampNewer(nextTimestamp, record.lastActivityAt)) {
      return;
    }

    record.lastActivityAt = nextTimestamp;
    if (persistMode === "debounced") {
      this.scheduleSessionSnapshotPersist();
      return;
    }

    this.persistSessionSnapshotsImmediately();
  }

  private isTimestampNewer(next: string, current: string): boolean {
    if (next === current) {
      return false;
    }

    const nextTimestamp = Date.parse(next);
    const currentTimestamp = Date.parse(current);
    const nextIsValid = !Number.isNaN(nextTimestamp);
    const currentIsValid = !Number.isNaN(currentTimestamp);

    if (nextIsValid && currentIsValid) {
      return nextTimestamp > currentTimestamp;
    }

    if (nextIsValid && !currentIsValid) {
      return true;
    }

    if (!nextIsValid && currentIsValid) {
      return false;
    }

    return true;
  }

  private createUniqueSessionId(): SessionId {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const sessionId = this.normalizeResumeSessionId(this.sessionIdFactory());
      if (sessionId && !this.sessions.has(sessionId)) {
        return sessionId;
      }
    }

    let fallbackSessionId = randomUUID();
    while (this.sessions.has(fallbackSessionId)) {
      fallbackSessionId = randomUUID();
    }

    return fallbackSessionId;
  }

  private persistSessionSnapshots(): void {
    this.clearPendingSessionSnapshotPersist();

    this.sessionSnapshotStore.writeSessionSnapshotState({
      sessions: Array.from(this.sessions.values()).map((record) =>
        this.toSnapshot(record),
      ),
      activeSessionId:
        this.activeSessionId && this.sessions.has(this.activeSessionId)
          ? this.activeSessionId
          : null,
    });
  }

  private persistSessionSnapshotsImmediately(): void {
    this.persistSessionSnapshots();
  }

  private scheduleSessionSnapshotPersist(): void {
    if (this.pendingSessionSnapshotPersist) {
      return;
    }

    this.pendingSessionSnapshotPersist = setTimeout(() => {
      this.pendingSessionSnapshotPersist = null;
      this.persistSessionSnapshots();
    }, SESSION_ACTIVITY_PERSIST_DEBOUNCE_MS);
  }

  private clearPendingSessionSnapshotPersist(): void {
    if (!this.pendingSessionSnapshotPersist) {
      return;
    }

    clearTimeout(this.pendingSessionSnapshotPersist);
    this.pendingSessionSnapshotPersist = null;
  }
}
