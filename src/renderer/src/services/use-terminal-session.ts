import { useEffect, useSyncExternalStore } from "react";
import {
  type TerminalSessionService,
  type TerminalSessionState,
  getTerminalSessionService,
} from "./terminal-session-service";
import { buildProjectSessionGroups } from "./terminal-session-selectors";

interface UseTerminalSessionResult {
  state: TerminalSessionState;
  actions: TerminalSessionService["actions"];
}

export function useTerminalSession(): UseTerminalSessionResult {
  const service = getTerminalSessionService();

  useEffect(() => {
    service.retain();

    return () => {
      service.release();
    };
  }, [service]);

  const state = useSyncExternalStore(
    service.subscribe,
    service.getSnapshot,
    service.getSnapshot,
  );

  return {
    state,
    actions: service.actions,
  };
}

export { buildProjectSessionGroups };
