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
  ClaudeSessionStatus,
  ClaudeSessionStatusEvent,
  ClaudeSessionTitleChangedEvent,
  SessionId,
} from "../shared/claude-types";
import { ClaudeActivityMonitor } from "./claude-activity-monitor";
import { ClaudeSessionManager } from "./claude-session";
import { normalizeLastActivityAt } from "./claude-session-snapshot-utils";

export type SessionActivityPersistMode = "immediate" | "debounced";

export interface ClaudeSessionServiceCallbacks {
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
    persistMode?: SessionActivityPersistMode,
  ) => void;
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

  void options
    .generateTitleFactory(prompt)
    .then((title) => {
      if (!options.hasSession(record.sessionId)) {
        return;
      }

      record.sessionName = title;
      options.persistSessionSnapshots();
      options.callbacks.emitSessionTitleChanged({
        sessionId: record.sessionId,
        title,
      });
    })
    .catch(() => {
      // Title generation failures are non-fatal and should not impact sessions.
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
    manager: null as unknown as SessionManagerLike,
    monitor: null as unknown as ActivityMonitorLike,
    ready: false,
    pendingEvents: [],
    titleGenerationTriggered: options.sessionName !== null,
  };

  const monitor = options.activityMonitorFactory({
    emitActivityState: (activityState) => {
      record.activityState = activityState;
      options.touchSessionActivity(record);
      emitOrQueueSessionEvent(record, () => {
        options.callbacks.emitSessionActivityState({
          sessionId: record.sessionId,
          activityState,
        });
      });
    },
    emitHookEvent: (event) => {
      options.touchSessionActivity(
        record,
        normalizeLastActivityAt(event.timestamp, options.nowFactory()),
      );
      maybeGenerateTitleFromHook(record, event, {
        generateTitleFactory: options.generateTitleFactory,
        persistSessionSnapshots: options.persistSessionSnapshots,
        callbacks: options.callbacks,
        hasSession: options.hasSession,
      });
      emitOrQueueSessionEvent(record, () => {
        options.callbacks.emitSessionHookEvent?.({
          sessionId: record.sessionId,
          event,
        });
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
      options.touchSessionActivity(record);
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
      options.touchSessionActivity(record);
      emitOrQueueSessionEvent(record, () => {
        options.callbacks.emitSessionStatus({
          sessionId: record.sessionId,
          status,
        });
      });
    },
  });

  record.manager = manager;
  record.monitor = monitor;

  if (record.activityWarning !== null) {
    emitOrQueueSessionEvent(record, () => {
      options.callbacks.emitSessionActivityWarning({
        sessionId: record.sessionId,
        warning: record.activityWarning,
      });
    });
  }

  return record;
}
