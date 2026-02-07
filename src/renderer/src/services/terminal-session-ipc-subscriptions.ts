import { claudeIpc } from "@renderer/lib/ipc";
import type { SessionId } from "@shared/claude-types";
import type { TerminalSessionState } from "./terminal-session-service";

interface RegisterTerminalSessionIpcSubscriptionsDeps {
  getState: () => TerminalSessionState;
  appendSessionOutput: (sessionId: SessionId, chunk: string) => void;
  writeToTerminal: (chunk: string) => void;
  setRenderedOutputMeta: (
    sessionId: SessionId | null,
    outputLength: number,
  ) => void;
  getSessionOutputLength: (sessionId: SessionId | null) => number;
  updateSession: (
    sessionId: SessionId,
    mutate: (
      session: TerminalSessionState["sessionsById"][SessionId],
    ) => TerminalSessionState["sessionsById"][SessionId],
  ) => boolean;
  refreshSessions: () => Promise<void>;
  updateState: (
    updater: (prev: TerminalSessionState) => TerminalSessionState,
  ) => void;
  renderActiveSessionOutput: (force?: boolean) => void;
  focusTerminal: () => void;
}

export function registerTerminalSessionIpcSubscriptions(
  deps: RegisterTerminalSessionIpcSubscriptionsDeps,
): Array<() => void> {
  return [
    claudeIpc.onClaudeSessionData((payload) => {
      deps.appendSessionOutput(payload.sessionId, payload.chunk);
      if (payload.sessionId === deps.getState().activeSessionId) {
        deps.writeToTerminal(payload.chunk);
        deps.setRenderedOutputMeta(
          payload.sessionId,
          deps.getSessionOutputLength(payload.sessionId),
        );
      }
    }),
    claudeIpc.onClaudeSessionExit((payload) => {
      const now = new Date().toISOString();
      if (
        !deps.updateSession(payload.sessionId, (session) => ({
          ...session,
          status: "stopped",
          lastActivityAt: now,
        }))
      ) {
        void deps.refreshSessions();
      }
    }),
    claudeIpc.onClaudeSessionError((payload) => {
      const now = new Date().toISOString();
      if (
        !deps.updateSession(payload.sessionId, (session) => ({
          ...session,
          lastError: payload.message,
          status: "error",
          lastActivityAt: now,
        }))
      ) {
        void deps.refreshSessions();
        return;
      }

      if (payload.sessionId === deps.getState().activeSessionId) {
        deps.updateState((prev) => ({
          ...prev,
          errorMessage: payload.message,
        }));
      }
    }),
    claudeIpc.onClaudeSessionStatus((payload) => {
      const now = new Date().toISOString();
      if (
        !deps.updateSession(payload.sessionId, (session) => ({
          ...session,
          status: payload.status,
          lastError: payload.status === "error" ? session.lastError : null,
          lastActivityAt: now,
        }))
      ) {
        void deps.refreshSessions();
      }
    }),
    claudeIpc.onClaudeSessionActivityState((payload) => {
      const now = new Date().toISOString();
      if (
        !deps.updateSession(payload.sessionId, (session) => ({
          ...session,
          activityState: payload.activityState,
          lastActivityAt: now,
        }))
      ) {
        void deps.refreshSessions();
      }
    }),
    claudeIpc.onClaudeSessionActivityWarning((payload) => {
      const now = new Date().toISOString();
      if (
        !deps.updateSession(payload.sessionId, (session) => ({
          ...session,
          activityWarning: payload.warning,
          lastActivityAt: now,
        }))
      ) {
        void deps.refreshSessions();
      }
    }),
    claudeIpc.onClaudeSessionTitleChanged((payload) => {
      deps.updateSession(payload.sessionId, (session) => ({
        ...session,
        sessionName: payload.title,
      }));
    }),
    claudeIpc.onClaudeActiveSessionChanged((payload) => {
      if (deps.getState().activeSessionId !== payload.activeSessionId) {
        deps.updateState((prev) => ({
          ...prev,
          activeSessionId: payload.activeSessionId,
        }));
        deps.renderActiveSessionOutput(true);
        if (payload.activeSessionId) {
          deps.focusTerminal();
        }
      }

      const sessionsById = deps.getState().sessionsById;
      if (payload.activeSessionId && !(payload.activeSessionId in sessionsById)) {
        void deps.refreshSessions();
      }
    }),
    claudeIpc.onClaudeSessionHookEvent((payload) => {
      const fallbackTimestamp = new Date().toISOString();
      const hookTimestamp =
        typeof payload.event.timestamp === "string" &&
        payload.event.timestamp.trim().length > 0
          ? payload.event.timestamp
          : fallbackTimestamp;
      deps.updateSession(payload.sessionId, (session) => ({
        ...session,
        lastActivityAt: hookTimestamp,
      }));
    }),
  ];
}
