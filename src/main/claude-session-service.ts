import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ClaudeActiveSessionChangedEvent,
  ClaudeActivityState,
  ClaudeHookEvent,
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
  StartClaudeSessionInput,
  StartClaudeSessionResult,
  StopClaudeSessionInput,
  StopClaudeSessionResult,
} from "../shared/claude-types";
import { ClaudeActivityMonitor } from "./claude-activity-monitor";
import { ClaudeSessionManager } from "./claude-session";
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
  private readonly sessions = new Map<SessionId, SessionRecord>();
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
  }

  getSessionsSnapshot(): ClaudeSessionsSnapshot {
    const sessions = Array.from(this.sessions.values()).map((session) =>
      this.toSnapshot(session),
    );

    return {
      sessions,
      activeSessionId:
        this.activeSessionId && this.sessions.has(this.activeSessionId)
          ? this.activeSessionId
          : null,
    };
  }

  async startSession(
    input: StartClaudeSessionInput,
  ): Promise<StartClaudeSessionResult> {
    const sessionId = this.sessionIdFactory();
    const record = this.createRecord(
      sessionId,
      input.cwd,
      this.normalizeSessionName(input.sessionName),
    );
    this.sessions.set(sessionId, record);

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
    };
  }

  private createRecord(
    sessionId: SessionId,
    cwd: string,
    sessionName: string | null,
  ): SessionRecord {
    const record: SessionRecord = {
      sessionId,
      cwd,
      sessionName,
      createdAt: this.nowFactory(),
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
        this.emitOrQueue(record, () => {
          this.callbacks.emitSessionActivityState({
            sessionId: record.sessionId,
            activityState,
          });
        });
      },
      emitHookEvent: (event) => {
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
        this.emitOrQueue(record, () => {
          this.callbacks.emitSessionExit({
            sessionId: record.sessionId,
            ...payload,
          });
        });
      },
      emitError: (payload) => {
        record.lastError = payload.message;
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
    }
  }

  private normalizeSessionName(sessionName?: string | null): string | null {
    if (typeof sessionName !== "string") {
      return null;
    }

    const trimmed = sessionName.trim();
    return trimmed.length > 0 ? trimmed : null;
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
}
