import { useEffect, useSyncExternalStore } from "react";
import {
  type SessionStore,
  type SessionStoreState,
  getSessionStore,
} from "./session-store";

interface UseTerminalSessionResult {
  state: SessionStoreState;
  actions: SessionStore["actions"];
}

export function useTerminalSession(): UseTerminalSessionResult {
  const service = getSessionStore();

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
