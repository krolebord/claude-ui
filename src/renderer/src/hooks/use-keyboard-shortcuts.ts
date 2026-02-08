import type { ClaudeSessionSnapshot, SessionId } from "@shared/claude-types";
import { useEffect, useRef } from "react";
import type { TerminalSessionState } from "../services/terminal-session-service";
import type { TerminalSessionService } from "../services/terminal-session-service";

export const SHORTCUT_DEFINITIONS = [
  { id: "new-session", label: "New session", key: "N", cmdOrCtrl: true },
  { id: "next-session", label: "Next session", key: "J", cmdOrCtrl: true },
  {
    id: "delete-session",
    label: "Delete session",
    key: "⌫",
    cmdOrCtrl: true,
  },
] as const;

export function getNextSession(
  state: TerminalSessionState,
  excludeSessionId?: SessionId,
): SessionId | null {
  const activeId = state.activeSessionId;
  const sessions = Object.values(state.sessionsById);
  const activeSession = activeId ? state.sessionsById[activeId] : null;
  const activeCwd = activeSession?.cwd ?? null;

  const candidates = sessions.filter(
    (s) => s.sessionId !== activeId && s.sessionId !== excludeSessionId,
  );

  if (candidates.length === 0) return null;

  const awaitingStates = new Set([
    "awaiting_user_response",
    "awaiting_approval",
  ]);

  const isAwaiting = (s: ClaudeSessionSnapshot) =>
    awaitingStates.has(s.activityState);

  const byRecent = (a: ClaudeSessionSnapshot, b: ClaudeSessionSnapshot) =>
    new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime();

  // Tier 1: awaiting user in same project
  if (activeCwd) {
    const tier1 = candidates
      .filter((s) => isAwaiting(s) && s.cwd === activeCwd)
      .sort(byRecent);
    if (tier1.length > 0) return tier1[0].sessionId;
  }

  // Tier 2: awaiting user in other projects
  const tier2 = candidates
    .filter((s) => isAwaiting(s) && s.cwd !== activeCwd)
    .sort(byRecent);
  if (tier2.length > 0) return tier2[0].sessionId;

  // Tier 3: idle running sessions
  const tier3 = candidates
    .filter((s) => s.status === "running" && s.activityState === "idle")
    .sort(byRecent);
  if (tier3.length > 0) return tier3[0].sessionId;

  return null;
}

export function useKeyboardShortcuts(
  state: TerminalSessionState,
  actions: TerminalSessionService["actions"],
): void {
  const stateRef = useRef(state);
  const actionsRef = useRef(actions);
  stateRef.current = state;
  actionsRef.current = actions;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;

      const s = stateRef.current;

      // Skip if any dialog is open
      if (
        s.newSessionDialog.open ||
        s.settingsDialogOpen ||
        s.projectDefaultsDialog.open
      )
        return;

      const key = event.key.toLowerCase();

      if (key === "n") {
        event.preventDefault();
        event.stopPropagation();

        const activeSession = s.activeSessionId
          ? s.sessionsById[s.activeSessionId]
          : null;
        if (!activeSession) return;

        actionsRef.current.openNewSessionDialog(activeSession.cwd);
        return;
      }

      if (key === "j") {
        event.preventDefault();
        event.stopPropagation();

        const nextId = getNextSession(s);
        if (nextId) {
          void actionsRef.current.setActiveSession(nextId);
        }
        return;
      }

      if (key === "backspace") {
        event.preventDefault();
        event.stopPropagation();

        const activeId = s.activeSessionId;
        if (!activeId) return;

        const nextId = getNextSession(s, activeId);
        void actionsRef.current.deleteSession(activeId).then(() => {
          if (nextId) {
            void actionsRef.current.setActiveSession(nextId);
          }
        });
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, []);
}
