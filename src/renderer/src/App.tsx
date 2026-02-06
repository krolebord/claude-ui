import type { ClaudeActivityState, ClaudeSessionStatus } from "@shared/claude-types";
import { AlertCircle } from "lucide-react";
import { useCallback, useRef } from "react";
import { FolderControls } from "@renderer/components/folder-controls";
import {
  type TerminalPaneHandle,
  TerminalPane,
} from "@renderer/components/terminal-pane";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@renderer/components/ui/card";
import { Separator } from "@renderer/components/ui/separator";
import { useTerminalSession } from "@renderer/services/use-terminal-session";

function getActivityDetail(nextState: ClaudeActivityState): string | null {
  switch (nextState) {
    case "awaiting_approval":
      return "Claude is waiting for tool approval.";
    case "awaiting_user_response":
      return "Claude is waiting for your input.";
    default:
      return null;
  }
}

function App() {
  const { state, actions } = useTerminalSession();
  const terminalRef = useRef<TerminalPaneHandle | null>(null);

  const activeSession = state.activeSessionId
    ? state.sessionsById[state.activeSessionId] ?? null
    : null;

  const status: ClaudeSessionStatus = activeSession?.status ?? "idle";
  const activityState: ClaudeActivityState =
    activeSession?.activityState ?? "unknown";
  const activityWarning = activeSession?.activityWarning ?? null;
  const errorMessage = state.errorMessage || activeSession?.lastError || "";

  const handleStart = useCallback(() => {
    if (!state.folderPath || state.isStarting) {
      return;
    }

    const terminalSize = terminalRef.current?.getSize() ?? {
      cols: 80,
      rows: 24,
    };

    void actions.startSession({
      cols: terminalSize.cols,
      rows: terminalSize.rows,
    });
  }, [actions, state.folderPath, state.isStarting]);

  const handleStop = useCallback(() => {
    if (state.isStopping) {
      return;
    }

    void actions.stopActiveSession();
  }, [actions, state.isStopping]);

  const handleTerminalResize = useCallback(
    (cols: number, rows: number) => {
      actions.resizeActiveSession(cols, rows);
    },
    [actions],
  );

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

  return (
    <div className="min-h-screen bg-[radial-gradient(120%_80%_at_0%_0%,#d7e6ff_0%,#f4f7ff_45%,#f9fbff_100%)] p-4 lg:p-6">
      <div className="mx-auto flex h-[calc(100vh-2rem)] max-w-7xl flex-col gap-4 lg:h-[calc(100vh-3rem)] lg:gap-6">
        <FolderControls
          folderPath={state.folderPath}
          status={status}
          activityState={activityState}
          activityDetail={getActivityDetail(activityState)}
          activityWarning={activityWarning}
          onSelectFolder={() => {
            void actions.selectFolder();
          }}
          onStart={handleStart}
          onStop={handleStop}
          isSelecting={state.isSelecting}
          isStarting={state.isStarting}
          isStopping={state.isStopping}
          isStartDisabled={!state.folderPath || state.isSelecting || state.isStarting}
          isStopDisabled={
            (status !== "running" && status !== "starting") || state.isStopping
          }
        />

        {errorMessage ? (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="flex items-center gap-2 py-3 text-sm text-destructive">
              <AlertCircle className="size-4" />
              <span>{errorMessage}</span>
            </CardContent>
          </Card>
        ) : null}

        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <CardTitle>Embedded Terminal</CardTitle>
          </CardHeader>
          <Separator />
          <CardContent className="min-h-0 flex-1 p-2 lg:p-3">
            <div className="h-full overflow-hidden rounded-md border border-border bg-[#0c1219]">
              <TerminalPane
                ref={handleTerminalRef}
                onInput={handleTerminalInput}
                onResize={handleTerminalResize}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default App;
