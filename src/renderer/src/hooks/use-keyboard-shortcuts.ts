import type { ClaudeSessionSnapshot, SessionId } from "@shared/claude-types";
import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import type { SessionStoreState } from "../services/session-store";
import type { SessionStore } from "../services/session-store";
import { useTerminalSession } from "../services/use-terminal-session";
import { useActiveSessionId } from "./use-active-session-id";

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
  state: SessionStoreState,
  activeSessionId: SessionId | null,
  excludeSessionId?: SessionId,
): SessionId | null {
  const activeId = activeSessionId;
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

export function useKeyboardShortcuts(): void {
  const { state, actions } = useTerminalSession();
  const activeSessionId = useActiveSessionId();
  const [, navigate] = useLocation();
  const stateRef = useRef(state);
  const actionsRef = useRef(actions);
  const navigateRef = useRef(navigate);
  const activeSessionIdRef = useRef(activeSessionId);
  stateRef.current = state;
  actionsRef.current = actions;
  navigateRef.current = navigate;
  activeSessionIdRef.current = activeSessionId;

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

      const currentActiveId = activeSessionIdRef.current;

      if (key === "n") {
        event.preventDefault();
        event.stopPropagation();

        const activeSession = currentActiveId
          ? s.sessionsById[currentActiveId]
          : null;
        if (!activeSession) return;

        actionsRef.current.openNewSessionDialog(activeSession.cwd);
        return;
      }

      if (key === "j") {
        event.preventDefault();
        event.stopPropagation();

        const nextId = getNextSession(s, currentActiveId);
        if (nextId) {
          void actionsRef.current.setActiveSession(nextId).then(() => {
            navigateRef.current(`/session/${nextId}`);
          });
        }
        return;
      }

      if (key === "backspace") {
        event.preventDefault();
        event.stopPropagation();

        if (!currentActiveId) return;

        const nextId = getNextSession(s, currentActiveId, currentActiveId);
        if (nextId) {
          navigateRef.current(`/session/${nextId}`);
        } else {
          navigateRef.current("/");
        }
        void actionsRef.current.deleteSession(currentActiveId);
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, []);
}
