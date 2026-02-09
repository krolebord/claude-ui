import { NewSessionDialog } from "@renderer/components/new-session-dialog";
import { ProjectDefaultsDialog } from "@renderer/components/project-defaults-dialog";
import { SessionSidebar } from "@renderer/components/session-sidebar";
import { SettingsDialog } from "@renderer/components/settings-dialog";
import {
  type TerminalPaneHandle,
  TerminalPane,
} from "@renderer/components/terminal-pane";
import { Toaster } from "@renderer/components/ui/sonner";
import { useKeyboardShortcuts } from "@renderer/hooks/use-keyboard-shortcuts";
import {
  useTerminalSession,
} from "@renderer/services/use-terminal-session";
import { buildProjectSessionGroups } from "@renderer/services/terminal-session-selectors";
import { AlertCircle } from "lucide-react";
import { useCallback, useMemo, useRef } from "react";

function App() {
  const { state, actions } = useTerminalSession();
  useKeyboardShortcuts(state, actions);
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

  const getTerminalSize = useCallback(
    () =>
      terminalRef.current?.getSize() ?? {
        cols: 80,
        rows: 24,
      },
    [],
  );

  return (
    <div className="flex h-screen overflow-hidden">
      <SessionSidebar
        groups={groups}
        activeSessionId={state.activeSessionId}
        isAddingProject={state.isSelecting}
        onAddProject={() => {
          void actions.addProject();
        }}
        onOpenSettings={actions.openSettingsDialog}
        onToggleProject={(projectPath) => {
          void actions.toggleProjectCollapsed(projectPath);
        }}
        onOpenNewSessionDialog={actions.openNewSessionDialog}
        onSelectSession={(sessionId) => {
          void actions.setActiveSession(sessionId);
        }}
        onStopSession={(sessionId) => {
          void actions.stopSession(sessionId);
        }}
        onResumeSession={(sessionId) => {
          const terminalSize = terminalRef.current?.getSize() ?? {
            cols: 80,
            rows: 24,
          };

          void actions.resumeSession(sessionId, {
            cols: terminalSize.cols,
            rows: terminalSize.rows,
          });
        }}
        onForkSession={(sessionId) => {
          const terminalSize = terminalRef.current?.getSize() ?? {
            cols: 80,
            rows: 24,
          };
          void actions.forkSession(sessionId, terminalSize);
        }}
        onDeleteSession={(sessionId) => {
          void actions.deleteSession(sessionId);
        }}
        onDeleteProject={(projectPath) => {
          void actions.deleteProject(projectPath);
        }}
        onOpenProjectDefaults={actions.openProjectDefaultsDialog}
      />

      <main className="flex min-w-0 flex-1 flex-col bg-black/15">
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
      </main>

      <NewSessionDialog
        open={state.newSessionDialog.open}
        projectPath={state.newSessionDialog.projectPath}
        initialPrompt={state.newSessionDialog.initialPrompt}
        sessionName={state.newSessionDialog.sessionName}
        model={state.newSessionDialog.model}
        permissionMode={state.newSessionDialog.permissionMode}
        getTerminalSize={getTerminalSize}
        onInitialPromptChange={(v) => actions.updateNewSessionDialog("initialPrompt", v)}
        onSessionNameChange={(v) => actions.updateNewSessionDialog("sessionName", v)}
        onModelChange={(v) => actions.updateNewSessionDialog("model", v)}
        onPermissionModeChange={(v) => actions.updateNewSessionDialog("permissionMode", v)}
        onCancel={actions.closeNewSessionDialog}
        onStarted={actions.newSessionStarted}
      />

      <ProjectDefaultsDialog
        open={state.projectDefaultsDialog.open}
        projectPath={state.projectDefaultsDialog.projectPath}
        defaultModel={state.projectDefaultsDialog.defaultModel}
        defaultPermissionMode={
          state.projectDefaultsDialog.defaultPermissionMode
        }
        onDefaultModelChange={(v) => actions.updateProjectDefaultsDialog("defaultModel", v)}
        onDefaultPermissionModeChange={(v) => actions.updateProjectDefaultsDialog("defaultPermissionMode", v)}
        onCancel={actions.closeProjectDefaultsDialog}
        onSaved={actions.projectDefaultsSaved}
      />

      <SettingsDialog
        open={state.settingsDialogOpen}
        onClose={actions.closeSettingsDialog}
      />

      <Toaster />
    </div>
  );
}

export default App;
