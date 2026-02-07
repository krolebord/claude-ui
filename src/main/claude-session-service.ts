import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AddClaudeProjectInput,
  AddClaudeProjectResult,
  ClaudeProject,
  ClaudeSessionsSnapshot,
  DeleteClaudeProjectInput,
  DeleteClaudeProjectResult,
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
import { SessionSnapshotPersistScheduler } from "./claude-session-persist-scheduler";
import {
  addProjectToList,
  normalizeProjectPath,
  normalizeProjects,
  removeProjectFromList,
  setProjectCollapsedInList,
} from "./claude-session-projects";
import {
  type ActivityMonitorFactory,
  type ClaudeSessionServiceCallbacks,
  type SessionActivityPersistMode,
  type SessionManagerFactory,
  type SessionRecord,
  createSessionRecord,
  flushPendingSessionEvents,
} from "./claude-session-record-factory";
import { ClaudeSessionManager } from "./claude-session";
import {
  isTimestampNewer,
  normalizeCreatedAt,
  normalizeLastActivityAt,
  normalizeResumeSessionId,
  normalizeSessionName,
  toSnapshot,
} from "./claude-session-snapshot-utils";
import { resumeStoppedSession } from "./claude-session-resume";
import type { ClaudeProjectStoreLike } from "./claude-project-store";
import type { ClaudeSessionSnapshotStoreLike } from "./claude-session-snapshot-store";
import { generateSessionTitle } from "./generate-session-title";
import log from "./logger";

interface ClaudeSessionServiceOptions {
  userDataPath: string;
  pluginDir: string | null;
  pluginWarning: string | null;
  callbacks: ClaudeSessionServiceCallbacks;
  sessionManagerFactory?: SessionManagerFactory;
  activityMonitorFactory?: ActivityMonitorFactory;
  stateFileFactory?: () => Promise<string>;
  sessionIdFactory?: () => SessionId;
  nowFactory?: () => string;
  generateTitleFactory?: (prompt: string) => Promise<string>;
  projectStore?: ClaudeProjectStoreLike;
  sessionSnapshotStore?: ClaudeSessionSnapshotStoreLike;
}

export class ClaudeSessionService {
  private readonly userDataPath: string;
  private readonly pluginDir: string | null;
  private readonly pluginWarning: string | null;
  private readonly callbacks: ClaudeSessionServiceCallbacks;
  private readonly sessionManagerFactory: SessionManagerFactory;
  private readonly activityMonitorFactory: ActivityMonitorFactory;
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
  private readonly persistScheduler: SessionSnapshotPersistScheduler;
  private readonly sessions = new Map<SessionId, SessionRecord>();
  private projects: ClaudeProject[] = [];
  private activeSessionId: SessionId | null = null;

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
    this.persistScheduler = new SessionSnapshotPersistScheduler(() => {
      this.persistSessionSnapshots();
    });

    this.projects = normalizeProjects(this.projectStore.readProjects());
    this.hydratePersistedSessions();
    this.persistSessionSnapshots();
  }

  getSessionsSnapshot(): ClaudeSessionsSnapshot {
    const sessions = Array.from(this.sessions.values()).map((session) =>
      toSnapshot(session),
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
    const next = addProjectToList(this.projects, input);
    if (next.didChange) {
      this.projects = next.projects;
      this.persistProjects();
    }

    return {
      ok: true,
      snapshot: this.getSessionsSnapshot(),
    };
  }

  setProjectCollapsed(
    input: SetClaudeProjectCollapsedInput,
  ): SetClaudeProjectCollapsedResult {
    const next = setProjectCollapsedInList(this.projects, input);
    if (next.didChange) {
      this.projects = next.projects;
      this.persistProjects();
    }

    return {
      ok: true,
      snapshot: this.getSessionsSnapshot(),
    };
  }

  deleteProject(input: DeleteClaudeProjectInput): DeleteClaudeProjectResult {
    const normalizedPath = normalizeProjectPath(input.path);
    const hasSession = Array.from(this.sessions.values()).some(
      (record) => record.cwd === normalizedPath,
    );
    if (hasSession) {
      throw new Error(
        "Cannot delete project that still has sessions. Delete all sessions first.",
      );
    }

    const next = removeProjectFromList(this.projects, input);
    if (next.didChange) {
      this.projects = next.projects;
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
    const resumeSessionId = normalizeResumeSessionId(input.resumeSessionId);
    if (resumeSessionId) {
      return resumeStoppedSession(
        {
          getRecord: (sessionId) => this.sessions.get(sessionId),
          stateFileFactory: this.stateFileFactory,
          pluginDir: this.pluginDir,
          setActiveSession: (sessionId) => {
            this.setActiveSessionInternal(sessionId);
          },
          getSessionsSnapshot: () => this.getSessionsSnapshot(),
        },
        resumeSessionId,
        input,
      );
    }

    const sessionId = this.createUniqueSessionId();
    const initialPrompt = input.initialPrompt?.trim() || null;
    const record = this.createRecord(
      sessionId,
      input.cwd,
      normalizeSessionName(input.sessionName),
      initialPrompt,
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
      flushPendingSessionEvents(record);

      if (initialPrompt && !record.titleGenerationTriggered) {
        record.titleGenerationTriggered = true;
        log.info("Title generation triggered from startSession", {
          sessionId: record.sessionId,
        });
        void this.generateTitleFactory(initialPrompt)
          .then((title) => {
            if (!this.sessions.has(record.sessionId)) {
              return;
            }

            log.info("Title generation completed from startSession", {
              sessionId: record.sessionId,
              title,
            });
            record.sessionName = title;
            this.persistSessionSnapshots();
            this.callbacks.emitSessionTitleChanged({
              sessionId: record.sessionId,
              title,
            });
          })
          .catch((error) => {
            log.error("Title generation failed from startSession", {
              sessionId: record.sessionId,
              error,
            });
          });
      }

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

    this.touchSessionActivity(record, undefined, "debounced");
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
    this.persistScheduler.clear();

    const uniqueRecords = new Set(this.sessions.values());
    for (const record of uniqueRecords) {
      record.monitor.stopMonitoring();
      record.manager.dispose();
    }

    this.sessions.clear();
    this.activeSessionId = null;
  }

  private createRecord(
    sessionId: SessionId,
    cwd: string,
    sessionName: string | null,
    initialPrompt: string | null = null,
  ): SessionRecord {
    return createSessionRecord({
      sessionId,
      cwd,
      sessionName,
      initialPrompt,
      pluginWarning: this.pluginWarning,
      nowFactory: this.nowFactory,
      callbacks: this.callbacks,
      sessionManagerFactory: this.sessionManagerFactory,
      activityMonitorFactory: this.activityMonitorFactory,
      generateTitleFactory: this.generateTitleFactory,
      persistSessionSnapshots: () => {
        this.persistSessionSnapshots();
      },
      hasSession: (candidateSessionId) => this.sessions.has(candidateSessionId),
      touchSessionActivity: (record, sourceTimestamp, persistMode) => {
        this.touchSessionActivity(record, sourceTimestamp, persistMode);
      },
    });
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

  private persistProjects(): void {
    this.projectStore.writeProjects(this.projects);
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
      const sessionId = normalizeResumeSessionId(snapshot.sessionId);
      const cwd = normalizeProjectPath(snapshot.cwd);
      if (!sessionId || !cwd || seenSessionIds.has(sessionId)) {
        continue;
      }

      seenSessionIds.add(sessionId);

      const record = this.createRecord(
        sessionId,
        cwd,
        normalizeSessionName(snapshot.sessionName),
      );

      record.createdAt = normalizeCreatedAt(snapshot.createdAt, this.nowFactory);
      record.lastActivityAt = normalizeLastActivityAt(
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

    const normalizedActiveSessionId = normalizeResumeSessionId(
      persisted.activeSessionId ?? undefined,
    );
    this.activeSessionId =
      normalizedActiveSessionId && this.sessions.has(normalizedActiveSessionId)
        ? normalizedActiveSessionId
        : null;
  }

  private touchSessionActivity(
    record: SessionRecord,
    sourceTimestamp?: string | null,
    persistMode: SessionActivityPersistMode = "immediate",
  ): void {
    const nextTimestamp =
      typeof sourceTimestamp === "string"
        ? normalizeLastActivityAt(sourceTimestamp, this.nowFactory())
        : this.nowFactory();

    if (!isTimestampNewer(nextTimestamp, record.lastActivityAt)) {
      return;
    }

    record.lastActivityAt = nextTimestamp;
    if (persistMode === "debounced") {
      this.persistScheduler.schedule();
      return;
    }

    this.persistSessionSnapshotsImmediately();
  }

  private createUniqueSessionId(): SessionId {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const sessionId = normalizeResumeSessionId(this.sessionIdFactory());
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
    this.persistScheduler.clear();

    this.sessionSnapshotStore.writeSessionSnapshotState({
      sessions: Array.from(this.sessions.values()).map((record) =>
        toSnapshot(record),
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
}
