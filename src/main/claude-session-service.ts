import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AddClaudeProjectInput,
  ClaudeActiveSessionChangedEvent,
  ClaudeActivityState,
  ClaudeHookEvent,
  ClaudePermissionMode,
  ClaudeProject,
  ClaudeSessionDataEvent,
  ClaudeSessionErrorEvent,
  ClaudeSessionExitEvent,
  ClaudeSessionStatus,
  ClaudeSessionUpdatedEvent,
  ClaudeSessionsSnapshot,
  DeleteClaudeProjectInput,
  DeleteClaudeSessionInput,
  SessionId,
  SetClaudeProjectCollapsedInput,
  SetClaudeProjectDefaultsInput,
  StartClaudeSessionInput,
  StartClaudeSessionResult,
  StopClaudeSessionInput,
} from "../shared/claude-types";
import { ClaudeActivityMonitor } from "./claude-activity-monitor";
import type { ClaudeProjectStoreLike } from "./claude-project-store";
import { ClaudeSessionManager } from "./claude-session";
import {
  addProjectToList,
  normalizeProjectPath,
  normalizeProjects,
  removeProjectFromList,
  setProjectCollapsedInList,
  setProjectDefaultsInList,
} from "./claude-session-projects";
import type { ClaudeSessionSnapshotStoreLike } from "./claude-session-snapshot-store";
import {
  isTimestampNewer,
  normalizeOptionalString,
  normalizeStringWithFallback,
  toSnapshot,
} from "./claude-session-snapshot-utils";
import { generateSessionTitle } from "./generate-session-title";
import log from "./logger";

export interface ClaudeSessionServiceCallbacks {
  emitSessionData: (payload: ClaudeSessionDataEvent) => void;
  emitSessionExit: (payload: ClaudeSessionExitEvent) => void;
  emitSessionError: (payload: ClaudeSessionErrorEvent) => void;
  emitSessionUpdated: (payload: ClaudeSessionUpdatedEvent) => void;
  emitActiveSessionChanged: (payload: ClaudeActiveSessionChangedEvent) => void;
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

type SessionManagerFactory = (
  callbacks: ConstructorParameters<typeof ClaudeSessionManager>[0],
) => SessionManagerLike;

type ActivityMonitorFactory = (
  callbacks: ConstructorParameters<typeof ClaudeActivityMonitor>[0],
) => ActivityMonitorLike;

interface SessionRecord {
  sessionId: SessionId;
  cwd: string;
  sessionName: string | null;
  permissionMode: ClaudePermissionMode | undefined;
  createdAt: string;
  lastActivityAt: string;
  status: ClaudeSessionStatus;
  activityState: ClaudeActivityState;
  activityWarning: string | null;
  lastError: string | null;
  stateFilePath: string | null;
  manager: SessionManagerLike;
  monitor: ActivityMonitorLike;
  ready: boolean;
  pendingEvents: Array<() => void>;
  titleGenerationTriggered: boolean;
}

interface ClaudeSessionServiceOptions {
  userDataPath: string;
  pluginDir: string | null;
  pluginWarning: string | null;
  callbacks: ClaudeSessionServiceCallbacks;
  sessionManagerFactory?: SessionManagerFactory;
  activityMonitorFactory?: ActivityMonitorFactory;
  stateFileFactory?: (sessionId: SessionId) => Promise<string>;
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
      options.stateFileFactory ??
      ((sessionId) => this.createStateFile(sessionId));
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

  addProject(input: AddClaudeProjectInput): ClaudeSessionsSnapshot {
    const next = addProjectToList(this.projects, input);
    if (next.didChange) {
      this.projects = next.projects;
      this.persistProjects();
    }

    return this.getSessionsSnapshot();
  }

  setProjectCollapsed(
    input: SetClaudeProjectCollapsedInput,
  ): ClaudeSessionsSnapshot {
    const next = setProjectCollapsedInList(this.projects, input);
    if (next.didChange) {
      this.projects = next.projects;
      this.persistProjects();
    }

    return this.getSessionsSnapshot();
  }

  setProjectDefaults(
    input: SetClaudeProjectDefaultsInput,
  ): ClaudeSessionsSnapshot {
    const next = setProjectDefaultsInList(this.projects, input);
    if (next.didChange) {
      this.projects = next.projects;
      this.persistProjects();
    }

    return this.getSessionsSnapshot();
  }

  deleteProject(input: DeleteClaudeProjectInput): ClaudeSessionsSnapshot {
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

    return this.getSessionsSnapshot();
  }

  async startSession(
    input: StartClaudeSessionInput,
  ): Promise<StartClaudeSessionResult> {
    const forkSessionId = normalizeOptionalString(input.forkSessionId);
    if (forkSessionId) {
      const sourceRecord = this.sessions.get(forkSessionId);
      if (!sourceRecord) {
        return {
          ok: false,
          message: `Session to fork does not exist: ${forkSessionId}`,
        };
      }

      const forkedName = sourceRecord.sessionName
        ? `${sourceRecord.sessionName} (fork)`
        : null;

      const sessionId = this.createUniqueSessionId();
      const record = this.createRecord(
        sessionId,
        sourceRecord.cwd,
        forkedName,
        sourceRecord.permissionMode,
      );
      this.sessions.set(sessionId, record);
      this.persistSessionSnapshots();

      return this.startAndMonitor(
        record,
        {
          cwd: sourceRecord.cwd,
          cols: input.cols,
          rows: input.rows,
          permissionMode: sourceRecord.permissionMode,
        },
        {
          pluginDir: this.pluginDir,
          sessionId: record.sessionId,
          resumeSessionId: forkSessionId,
          forkSession: true,
        },
        { isNewRecord: true, errorPrefix: "Failed to fork session" },
      );
    }

    const resumeSessionId = normalizeOptionalString(input.resumeSessionId);
    if (resumeSessionId) {
      const record = this.sessions.get(resumeSessionId);
      if (!record) {
        return {
          ok: false,
          message: `Session does not exist: ${resumeSessionId}`,
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

      this.cleanupStateFile(record);

      const resumePermissionMode =
        input.permissionMode ?? record.permissionMode;

      return this.startAndMonitor(
        record,
        {
          cwd: record.cwd,
          cols: input.cols,
          rows: input.rows,
          permissionMode: resumePermissionMode,
          model: input.model,
        },
        {
          pluginDir: this.pluginDir,
          resumeSessionId: record.sessionId,
        },
        { isNewRecord: false, errorPrefix: "Failed to resume session" },
      );
    }

    const sessionId = this.createUniqueSessionId();
    const initialPrompt = input.initialPrompt?.trim() || null;
    const { initialPrompt: _rawInitialPrompt, ...startInputBase } = input;
    const startInput: StartClaudeSessionInput = initialPrompt
      ? { ...startInputBase, initialPrompt }
      : startInputBase;
    const record = this.createRecord(
      sessionId,
      input.cwd,
      normalizeOptionalString(input.sessionName),
      input.permissionMode,
    );
    this.sessions.set(sessionId, record);
    this.persistSessionSnapshots();

    const result = await this.startAndMonitor(
      record,
      startInput,
      {
        pluginDir: this.pluginDir,
        sessionId: record.sessionId,
      },
      { isNewRecord: true, errorPrefix: "Failed to start session" },
    );

    if (result.ok && initialPrompt && !record.titleGenerationTriggered) {
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
          this.callbacks.emitSessionUpdated({
            sessionId: record.sessionId,
            updates: { sessionName: title },
          });
        })
        .catch((error) => {
          log.error("Title generation failed from startSession", {
            sessionId: record.sessionId,
            error,
          });
        });
    }

    return result;
  }

  async stopSession(input: StopClaudeSessionInput): Promise<void> {
    const record = this.sessions.get(input.sessionId);
    if (!record) {
      return;
    }

    await record.manager.stop();
  }

  async deleteSession(input: DeleteClaudeSessionInput): Promise<void> {
    const record = this.sessions.get(input.sessionId);
    if (!record) {
      return;
    }

    let stopError: unknown = null;

    record.monitor.stopMonitoring();

    try {
      await record.manager.stop();
    } catch (error) {
      stopError = error;
    } finally {
      record.manager.dispose();
      this.cleanupStateFile(record);
      this.removeSessionRecord(input.sessionId, record);

      if (this.activeSessionId === input.sessionId) {
        this.setActiveSessionInternal(null);
      }
    }

    if (stopError) {
      throw stopError;
    }
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
    const uniqueRecords = new Set(this.sessions.values());
    for (const record of uniqueRecords) {
      record.monitor.stopMonitoring();
      record.manager.dispose();
      this.cleanupStateFile(record);
    }

    this.sessions.clear();
    this.activeSessionId = null;
  }

  private createRecord(
    sessionId: SessionId,
    cwd: string,
    sessionName: string | null,
    permissionMode?: ClaudePermissionMode,
  ): SessionRecord {
    const createdAt = this.nowFactory();
    const record: SessionRecord = {
      sessionId,
      cwd,
      sessionName,
      permissionMode,
      createdAt,
      lastActivityAt: createdAt,
      status: "idle",
      activityState: "unknown",
      activityWarning: this.pluginWarning,
      lastError: null,
      stateFilePath: null,
      manager: null as unknown as SessionManagerLike,
      monitor: null as unknown as ActivityMonitorLike,
      ready: false,
      pendingEvents: [],
      titleGenerationTriggered: sessionName !== null,
    };

    const monitor = this.activityMonitorFactory({
      emitActivityState: (activityState) => {
        record.activityState = activityState;
        const updatedAt = this.touchSessionActivity(record);
        this.persistSessionSnapshots();
        this.emitOrQueue(record, () => {
          const updates: ClaudeSessionUpdatedEvent["updates"] = {
            activityState,
          };
          if (updatedAt) updates.lastActivityAt = updatedAt;
          this.callbacks.emitSessionUpdated({
            sessionId: record.sessionId,
            updates,
          });
        });
      },
      emitHookEvent: (event) => {
        const updatedAt = this.touchSessionActivity(
          record,
          normalizeStringWithFallback(event.timestamp, this.nowFactory()),
        );
        if (updatedAt) {
          this.persistSessionSnapshots();
          this.emitOrQueue(record, () => {
            this.callbacks.emitSessionUpdated({
              sessionId: record.sessionId,
              updates: { lastActivityAt: updatedAt },
            });
          });
        }
        this.maybeGenerateTitle(record, event);
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
        this.cleanupStateFile(record);
        this.touchSessionActivity(record);
        this.persistSessionSnapshots();
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
        this.persistSessionSnapshots();
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
        const updatedAt = this.touchSessionActivity(record);
        this.persistSessionSnapshots();
        this.emitOrQueue(record, () => {
          const updates: ClaudeSessionUpdatedEvent["updates"] = { status };
          if (updatedAt) updates.lastActivityAt = updatedAt;
          this.callbacks.emitSessionUpdated({
            sessionId: record.sessionId,
            updates,
          });
        });
      },
    });

    record.manager = manager;
    record.monitor = monitor;

    if (record.activityWarning !== null) {
      this.emitOrQueue(record, () => {
        this.callbacks.emitSessionUpdated({
          sessionId: record.sessionId,
          updates: { activityWarning: record.activityWarning },
        });
      });
    }

    return record;
  }

  private async startAndMonitor(
    record: SessionRecord,
    startInput: StartClaudeSessionInput,
    managerOptions: {
      pluginDir: string | null;
      sessionId?: string;
      resumeSessionId?: string;
      forkSession?: boolean;
    },
    opts: { isNewRecord: boolean; errorPrefix: string },
  ): Promise<StartClaudeSessionResult> {
    try {
      const stateFilePath = await this.stateFileFactory(record.sessionId);
      record.stateFilePath = stateFilePath;
      record.monitor.startMonitoring(stateFilePath);

      const result = await record.manager.start(startInput, {
        ...managerOptions,
        stateFilePath,
      });

      if (!result.ok) {
        record.monitor.stopMonitoring();
        this.cleanupStateFile(record);
        if (opts.isNewRecord) {
          this.removeSessionRecord(record.sessionId, record);
          record.manager.dispose();
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
      record.monitor.stopMonitoring();
      this.cleanupStateFile(record);
      if (opts.isNewRecord) {
        this.removeSessionRecord(record.sessionId, record);
        record.manager.dispose();
      }
      return {
        ok: false,
        message:
          error instanceof Error
            ? `${opts.errorPrefix}: ${error.message}`
            : `${opts.errorPrefix} due to an unknown error.`,
      };
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

  private persistProjects(): void {
    this.projectStore.writeProjects(this.projects);
  }

  private async createStateFile(sessionId: SessionId): Promise<string> {
    const stateDir = path.join(this.userDataPath, "claude-state");
    const stateFilePath = path.join(stateDir, `s-${sessionId}.ndjson`);

    await mkdir(stateDir, { recursive: true });
    await writeFile(stateFilePath, "", "utf8");

    return stateFilePath;
  }

  private cleanupStateFile(record: SessionRecord): void {
    if (!record.stateFilePath) {
      return;
    }

    const filePath = record.stateFilePath;
    record.stateFilePath = null;
    try {
      unlinkSync(filePath);
    } catch {
      // Ignore missing-file and cleanup errors.
    }
  }

  private hydratePersistedSessions(): void {
    const persisted = this.sessionSnapshotStore.readSessionSnapshotState();
    const seenSessionIds = new Set<SessionId>();

    for (const snapshot of persisted.sessions) {
      const sessionId = normalizeOptionalString(snapshot.sessionId);
      const cwd = normalizeProjectPath(snapshot.cwd);
      if (!sessionId || !cwd || seenSessionIds.has(sessionId)) {
        continue;
      }

      seenSessionIds.add(sessionId);

      const record = this.createRecord(
        sessionId,
        cwd,
        normalizeOptionalString(snapshot.sessionName),
        snapshot.permissionMode,
      );

      record.createdAt = normalizeStringWithFallback(
        snapshot.createdAt,
        this.nowFactory(),
      );
      record.lastActivityAt = normalizeStringWithFallback(
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

    const normalizedActiveSessionId = normalizeOptionalString(
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
  ): string | null {
    const nextTimestamp =
      typeof sourceTimestamp === "string"
        ? normalizeStringWithFallback(sourceTimestamp, this.nowFactory())
        : this.nowFactory();

    if (!isTimestampNewer(nextTimestamp, record.lastActivityAt)) {
      return null;
    }

    record.lastActivityAt = nextTimestamp;
    return nextTimestamp;
  }

  private createUniqueSessionId(): SessionId {
    let sessionId = normalizeOptionalString(this.sessionIdFactory());
    while (!sessionId || this.sessions.has(sessionId)) {
      sessionId = normalizeOptionalString(this.sessionIdFactory());
    }
    return sessionId;
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

  private maybeGenerateTitle(
    record: SessionRecord,
    event: ClaudeHookEvent,
  ): void {
    if (record.titleGenerationTriggered) return;
    if (event.hook_event_name !== "UserPromptSubmit") return;

    const prompt = event.prompt?.trim();
    if (!prompt) return;

    record.titleGenerationTriggered = true;
    log.info("Title generation triggered from hook", {
      sessionId: record.sessionId,
      hookEvent: event.hook_event_name,
    });

    void this.generateTitleFactory(prompt)
      .then((title) => {
        if (!this.sessions.has(record.sessionId)) return;

        log.info("Title generation completed from hook", {
          sessionId: record.sessionId,
          title,
        });
        record.sessionName = title;
        this.persistSessionSnapshots();
        this.callbacks.emitSessionUpdated({
          sessionId: record.sessionId,
          updates: { sessionName: title },
        });
      })
      .catch((error) => {
        log.error("Title generation failed from hook", {
          sessionId: record.sessionId,
          error,
        });
      });
  }

  private persistSessionSnapshots(): void {
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
}
