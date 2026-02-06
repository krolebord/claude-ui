import { NewSessionDialog } from "@renderer/components/new-session-dialog";
import { SessionSidebar } from "@renderer/components/session-sidebar";
import {
  type TerminalPaneHandle,
  TerminalPane,
} from "@renderer/components/terminal-pane";
import {
  buildProjectSessionGroups,
  useTerminalSession,
} from "@renderer/services/use-terminal-session";
import { AlertCircle } from "lucide-react";
import { useCallback, useMemo, useRef } from "react";

function App() {
  const { state, actions } = useTerminalSession();
  const terminalRef = useRef<TerminalPaneHandle | null>(null);

  const activeSession = state.activeSessionId
    ? state.sessionsById[state.activeSessionId] ?? null
    : null;

  const groups = useMemo(
    () =>
      buildProjectSessionGroups({
        projects: state.projects,
        sessionsById: state.sessionsById,
      }),
    [state.projects, state.sessionsById]
  );

  const errorMessage = state.errorMessage || activeSession?.lastError || "";

  const handleTerminalResize = useCallback(
    (cols: number, rows: number) => {
      actions.resizeActiveSession(cols, rows);
    },
    [actions]
  );

  const handleTerminalRef = useCallback(
    (handle: TerminalPaneHandle | null) => {
      terminalRef.current = handle;
      actions.attachTerminal(handle);
    },
    [actions]
  );

  const handleTerminalInput = useCallback(
    (data: string) => {
      actions.writeToActiveSession(data);
    },
    [actions]
  );

  const handleConfirmNewSession = useCallback(() => {
    const terminalSize = terminalRef.current?.getSize() ?? {
      cols: 80,
      rows: 24,
    };

    void actions.confirmNewSession({
      cols: terminalSize.cols,
      rows: terminalSize.rows,
    });
  }, [actions]);

  return (
    <div className="min-h-screen bg-[radial-gradient(120%_90%_at_0%_0%,#242b36_0%,#111419_45%,#090b10_100%)]">
      <div className="mx-auto flex h-[calc(100vh-2rem)] max-w-[1600px] overflow-hidden border border-white/10 bg-black/25 shadow-[0_30px_80px_rgba(0,0,0,0.5)]">
        <SessionSidebar
          groups={groups}
          activeSessionId={state.activeSessionId}
          isAddingProject={state.isSelecting}
          onAddProject={() => {
            void actions.addProject();
          }}
          onToggleProject={actions.toggleProjectCollapsed}
          onOpenNewSessionDialog={actions.openNewSessionDialog}
          onSelectSession={(sessionId) => {
            void actions.setActiveSession(sessionId);
          }}
          onStopSession={(sessionId) => {
            void actions.stopSession(sessionId);
          }}
          onDeleteSession={(sessionId) => {
            void actions.deleteSession(sessionId);
          }}
        />

        <main className="flex min-w-0 flex-1 flex-col bg-black/15">
          {errorMessage ? (
            <div className="mx-4 mt-4 flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              <AlertCircle className="size-4" />
              <span>{errorMessage}</span>
            </div>
          ) : null}

          <div className="min-h-0 flex-1">
            <div className="h-full overflow-hidden border border-white/10 bg-[#080a0e]">
              <TerminalPane
                ref={handleTerminalRef}
                onInput={handleTerminalInput}
                onResize={handleTerminalResize}
              />
            </div>
          </div>
        </main>
      </div>

      <NewSessionDialog
        open={state.newSessionDialog.open}
        projectPath={state.newSessionDialog.projectPath}
        sessionName={state.newSessionDialog.sessionName}
        dangerouslySkipPermissions={
          state.newSessionDialog.dangerouslySkipPermissions
        }
        isStarting={state.isStarting}
        onSessionNameChange={actions.setNewSessionName}
        onDangerouslySkipPermissionsChange={
          actions.setNewSessionDangerouslySkipPermissions
        }
        onCancel={actions.closeNewSessionDialog}
        onConfirm={handleConfirmNewSession}
      />
    </div>
  );
}

export default App;
