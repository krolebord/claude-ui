import {
  type TerminalPaneHandle,
  TerminalPane,
} from "@renderer/components/terminal-pane";
import { useTerminalSession } from "@renderer/services/use-terminal-session";
import { AlertCircle } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { Redirect } from "wouter";

interface SessionPageProps {
  sessionId: string;
}

export function SessionPage({ sessionId }: SessionPageProps) {
  const { state, actions } = useTerminalSession();
  const terminalRef = useRef<TerminalPaneHandle | null>(null);

  const sessionExists = Object.prototype.hasOwnProperty.call(
    state.sessionsById,
    sessionId,
  );

  // Route → State sync: activate this session if it isn't already active
  useEffect(() => {
    if (sessionExists && sessionId && state.activeSessionId !== sessionId) {
      void actions.setActiveSession(sessionId);
    }
  }, [sessionId, sessionExists, state.activeSessionId, actions]);

  const handleTerminalRef = useCallback(
    (handle: TerminalPaneHandle | null) => {
      terminalRef.current = handle;
      actions.attachTerminal(handle);
    },
    [actions],
  );

  const handleTerminalInput = useCallback(
    (data: string) => {
      actions.writeToActiveSession(data);
    },
    [actions],
  );

  const handleTerminalResize = useCallback(
    (cols: number, rows: number) => {
      actions.resizeActiveSession(cols, rows);
    },
    [actions],
  );

  if (!sessionExists) {
    return <Redirect to="/" replace />;
  }

  const session = state.sessionsById[sessionId];
  const errorMessage = state.errorMessage || session?.lastError || "";

  return (
    <>
      {errorMessage ? (
        <div className="mx-4 mt-4 flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
          <AlertCircle className="size-4" />
          <span>{errorMessage}</span>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden">
        <TerminalPane
          ref={handleTerminalRef}
          onInput={handleTerminalInput}
          onResize={handleTerminalResize}
        />
      </div>
    </>
  );
}
