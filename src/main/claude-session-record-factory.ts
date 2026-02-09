import type {
  ClaudeActiveSessionChangedEvent,
  ClaudeActivityState,
  ClaudeHookEvent,
  ClaudeSessionDataEvent,
  ClaudeSessionErrorEvent,
  ClaudeSessionExitEvent,
  ClaudeSessionStatus,
  ClaudeSessionUpdatedEvent,
  SessionId,
} from "../shared/claude-types";
import type { ClaudeActivityMonitor } from "./claude-activity-monitor";
import type { ClaudeSessionManager } from "./claude-session";
import { normalizeStringWithFallback } from "./claude-session-snapshot-utils";
import log from "./logger";

export interface ClaudeSessionServiceCallbacks {
  emitSessionData: (payload: ClaudeSessionDataEvent) => void;
  emitSessionExit: (payload: ClaudeSessionExitEvent) => void;
  emitSessionError: (payload: ClaudeSessionErrorEvent) => void;
  emitSessionUpdated: (payload: ClaudeSessionUpdatedEvent) => void;
  emitActiveSessionChanged: (payload: ClaudeActiveSessionChangedEvent) => void;
}

export interface SessionManagerLike {
  start: InstanceType<typeof ClaudeSessionManager>["start"];
  stop: InstanceType<typeof ClaudeSessionManager>["stop"];
  write: InstanceType<typeof ClaudeSessionManager>["write"];
  resize: InstanceType<typeof ClaudeSessionManager>["resize"];
  dispose: InstanceType<typeof ClaudeSessionManager>["dispose"];
}

export interface ActivityMonitorLike {
  startMonitoring: InstanceType<
    typeof ClaudeActivityMonitor
  >["startMonitoring"];
  stopMonitoring: InstanceType<typeof ClaudeActivityMonitor>["stopMonitoring"];
}

export type SessionManagerFactory = (
  callbacks: ConstructorParameters<typeof ClaudeSessionManager>[0],
) => SessionManagerLike;

export type ActivityMonitorFactory = (
  callbacks: ConstructorParameters<typeof ClaudeActivityMonitor>[0],
) => ActivityMonitorLike;

export interface SessionRecord {
  sessionId: SessionId;
  cwd: string;
  sessionName: string | null;
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

interface CreateSessionRecordOptions {
  sessionId: SessionId;
  cwd: string;
  sessionName: string | null;
  pluginWarning: string | null;
  nowFactory: () => string;
  callbacks: ClaudeSessionServiceCallbacks;
  sessionManagerFactory: SessionManagerFactory;
  activityMonitorFactory: ActivityMonitorFactory;
  generateTitleFactory: (prompt: string) => Promise<string>;
  persistSessionSnapshots: () => void;
  hasSession: (sessionId: SessionId) => boolean;
  touchSessionActivity: (
    record: SessionRecord,
    sourceTimestamp?: string | null,
  ) => string | null;
  cleanupStateFile?: (record: SessionRecord) => void;
}

interface MaybeGenerateTitleOptions {
  generateTitleFactory: (prompt: string) => Promise<string>;
  persistSessionSnapshots: () => void;
  callbacks: ClaudeSessionServiceCallbacks;
  hasSession: (sessionId: SessionId) => boolean;
}

function maybeGenerateTitleFromHook(
  record: SessionRecord,
  event: ClaudeHookEvent,
  options: MaybeGenerateTitleOptions,
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

  log.info("Title generation triggered from hook", {
    sessionId: record.sessionId,
    hookEvent: event.hook_event_name,
  });

  void options
    .generateTitleFactory(prompt)
    .then((title) => {
      if (!options.hasSession(record.sessionId)) {
        return;
      }

      log.info("Title generation completed from hook", {
        sessionId: record.sessionId,
        title,
      });
      record.sessionName = title;
      options.persistSessionSnapshots();
      options.callbacks.emitSessionUpdated({
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

export function emitOrQueueSessionEvent(
  record: SessionRecord,
  emit: () => void,
): void {
  if (!record.ready) {
    record.pendingEvents.push(emit);
    return;
  }

  emit();
}

export function flushPendingSessionEvents(record: SessionRecord): void {
  const pending = [...record.pendingEvents];
  record.pendingEvents = [];

  for (const emit of pending) {
    emit();
  }
}

export function createSessionRecord(
  options: CreateSessionRecordOptions,
): SessionRecord {
  const createdAt = options.nowFactory();
  const record: SessionRecord = {
    sessionId: options.sessionId,
    cwd: options.cwd,
    sessionName: options.sessionName,
    createdAt,
    lastActivityAt: createdAt,
    status: "idle",
    activityState: "unknown",
    activityWarning: options.pluginWarning,
    lastError: null,
    stateFilePath: null,
    manager: null as unknown as SessionManagerLike,
    monitor: null as unknown as ActivityMonitorLike,
    ready: false,
    pendingEvents: [],
    titleGenerationTriggered: options.sessionName !== null,
  };

  const monitor = options.activityMonitorFactory({
    emitActivityState: (activityState) => {
      record.activityState = activityState;
      const updatedAt = options.touchSessionActivity(record);
      options.persistSessionSnapshots();
      emitOrQueueSessionEvent(record, () => {
        const updates: ClaudeSessionUpdatedEvent["updates"] = {
          activityState,
        };
        if (updatedAt) updates.lastActivityAt = updatedAt;
        options.callbacks.emitSessionUpdated({
          sessionId: record.sessionId,
          updates,
        });
      });
    },
    emitHookEvent: (event) => {
      const updatedAt = options.touchSessionActivity(
        record,
        normalizeStringWithFallback(event.timestamp, options.nowFactory()),
      );
      if (updatedAt) {
        options.persistSessionSnapshots();
        emitOrQueueSessionEvent(record, () => {
          options.callbacks.emitSessionUpdated({
            sessionId: record.sessionId,
            updates: { lastActivityAt: updatedAt },
          });
        });
      }
      maybeGenerateTitleFromHook(record, event, {
        generateTitleFactory: options.generateTitleFactory,
        persistSessionSnapshots: options.persistSessionSnapshots,
        callbacks: options.callbacks,
        hasSession: options.hasSession,
      });
    },
  });

  const manager = options.sessionManagerFactory({
    emitData: (chunk) => {
      emitOrQueueSessionEvent(record, () => {
        options.callbacks.emitSessionData({
          sessionId: record.sessionId,
          chunk,
        });
      });
    },
    emitExit: (payload) => {
      monitor.stopMonitoring({ preserveState: true });
      options.cleanupStateFile?.(record);
      options.touchSessionActivity(record);
      options.persistSessionSnapshots();
      emitOrQueueSessionEvent(record, () => {
        options.callbacks.emitSessionExit({
          sessionId: record.sessionId,
          ...payload,
        });
      });
    },
    emitError: (payload) => {
      record.lastError = payload.message;
      options.touchSessionActivity(record);
      options.persistSessionSnapshots();
      emitOrQueueSessionEvent(record, () => {
        options.callbacks.emitSessionError({
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
      const updatedAt = options.touchSessionActivity(record);
      options.persistSessionSnapshots();
      emitOrQueueSessionEvent(record, () => {
        const updates: ClaudeSessionUpdatedEvent["updates"] = { status };
        if (updatedAt) updates.lastActivityAt = updatedAt;
        options.callbacks.emitSessionUpdated({
          sessionId: record.sessionId,
          updates,
        });
      });
    },
  });

  record.manager = manager;
  record.monitor = monitor;

  if (record.activityWarning !== null) {
    emitOrQueueSessionEvent(record, () => {
      options.callbacks.emitSessionUpdated({
        sessionId: record.sessionId,
        updates: { activityWarning: record.activityWarning },
      });
    });
  }

  return record;
}
