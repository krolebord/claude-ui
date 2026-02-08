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
      if (
        !deps.updateSession(payload.sessionId, (session) => ({
          ...session,
          status: "stopped",
        }))
      ) {
        void deps.refreshSessions();
      }
    }),
    claudeIpc.onClaudeSessionError((payload) => {
      if (
        !deps.updateSession(payload.sessionId, (session) => ({
          ...session,
          lastError: payload.message,
          status: "error",
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
    claudeIpc.onClaudeSessionUpdated((payload) => {
      const { sessionId, updates } = payload;

      const didUpdate = deps.updateSession(sessionId, (session) => {
        const merged = { ...session, ...updates };
        if ("status" in updates && updates.status !== "error") {
          merged.lastError = null;
        }
        return merged;
      });

      if (
        !didUpdate &&
        ("status" in updates ||
          "activityState" in updates ||
          "activityWarning" in updates)
      ) {
        void deps.refreshSessions();
      }
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
      if (
        payload.activeSessionId &&
        !(payload.activeSessionId in sessionsById)
      ) {
        void deps.refreshSessions();
      }
    }),
  ];
}
