import type {
  ClaudeActivityState,
  ClaudeSessionStatus,
} from "@shared/claude-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { claudeIpc } from "@renderer/lib/ipc";

const statusQueryKey = ["claude-status"];
const activityQueryKey = ["claude-activity-state"];
const activityWarningQueryKey = ["claude-activity-warning"];

function App() {
  const queryClient = useQueryClient();
  const terminalRef = useRef<TerminalPaneHandle>(null);

  const [folderPath, setFolderPath] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const statusQuery = useQuery({
    queryKey: statusQueryKey,
    queryFn: claudeIpc.getStatus,
  });

  const status: ClaudeSessionStatus = statusQuery.data ?? "idle";
  const activityStateQuery = useQuery({
    queryKey: activityQueryKey,
    queryFn: claudeIpc.getActivityState,
  });
  const activityWarningQuery = useQuery({
    queryKey: activityWarningQueryKey,
    queryFn: claudeIpc.getActivityWarning,
  });
  const activityState: ClaudeActivityState =
    activityStateQuery.data ?? "unknown";
  const activityWarning = activityWarningQuery.data ?? null;

  const selectFolderMutation = useMutation({
    mutationFn: claudeIpc.selectFolder,
    onSuccess: (selectedPath) => {
      if (selectedPath) {
        setFolderPath(selectedPath);
      }
    },
  });

  const startMutation = useMutation({
    mutationFn: async () => {
      const terminalSize = terminalRef.current?.getSize() ?? {
        cols: 80,
        rows: 24,
      };
      return claudeIpc.startClaude({
        cwd: folderPath,
        cols: terminalSize.cols,
        rows: terminalSize.rows,
      });
    },
    onMutate: () => {
      setErrorMessage("");
    },
    onSuccess: (result) => {
      if (!result.ok) {
        setErrorMessage(result.message);
        queryClient.setQueryData<ClaudeSessionStatus>(statusQueryKey, "error");
        return;
      }

      terminalRef.current?.clear();
      void queryClient.invalidateQueries({ queryKey: statusQueryKey });
    },
  });

  const stopMutation = useMutation({
    mutationFn: claudeIpc.stopClaude,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: statusQueryKey });
    },
  });

  useEffect(() => {
    const unsubscribeData = window.claude.onClaudeData((chunk) => {
      terminalRef.current?.write(chunk);
    });

    const unsubscribeExit = window.claude.onClaudeExit(() => {
      void queryClient.invalidateQueries({ queryKey: statusQueryKey });
    });

    const unsubscribeError = window.claude.onClaudeError((payload) => {
      setErrorMessage(payload.message);
      queryClient.setQueryData<ClaudeSessionStatus>(statusQueryKey, "error");
    });

    const unsubscribeStatus = window.claude.onClaudeStatus((nextStatus) => {
      if (nextStatus !== "error") {
        setErrorMessage("");
      }
      queryClient.setQueryData<ClaudeSessionStatus>(statusQueryKey, nextStatus);
    });

    const unsubscribeActivityState = window.claude.onClaudeActivityState(
      (nextActivityState) => {
        queryClient.setQueryData<ClaudeActivityState>(
          activityQueryKey,
          nextActivityState,
        );
      },
    );

    const unsubscribeActivityWarning = window.claude.onClaudeActivityWarning(
      (warning) => {
        queryClient.setQueryData<string | null>(activityWarningQueryKey, warning);
      },
    );

    return () => {
      unsubscribeData();
      unsubscribeExit();
      unsubscribeError();
      unsubscribeStatus();
      unsubscribeActivityState();
      unsubscribeActivityWarning();
    };
  }, [queryClient]);

  const handleStart = () => {
    if (!folderPath || startMutation.isPending) {
      return;
    }

    startMutation.mutate();
  };

  const handleStop = () => {
    if (stopMutation.isPending) {
      return;
    }

    stopMutation.mutate();
  };

  const handleTerminalResize = (cols: number, rows: number) => {
    claudeIpc.resizeClaude(cols, rows);
  };

  const getActivityDetail = (nextState: ClaudeActivityState): string | null => {
    switch (nextState) {
      case "awaiting_approval":
        return "Claude is waiting for tool approval.";
      case "awaiting_user_response":
        return "Claude is waiting for your input.";
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(120%_80%_at_0%_0%,#d7e6ff_0%,#f4f7ff_45%,#f9fbff_100%)] p-4 lg:p-6">
      <div className="mx-auto flex h-[calc(100vh-2rem)] max-w-7xl flex-col gap-4 lg:h-[calc(100vh-3rem)] lg:gap-6">
        <FolderControls
          folderPath={folderPath}
          status={status}
          activityState={activityState}
          activityDetail={getActivityDetail(activityState)}
          activityWarning={activityWarning}
          onSelectFolder={() => selectFolderMutation.mutate()}
          onStart={handleStart}
          onStop={handleStop}
          isSelecting={selectFolderMutation.isPending}
          isStarting={startMutation.isPending}
          isStopping={stopMutation.isPending}
          isStartDisabled={
            !folderPath ||
            selectFolderMutation.isPending ||
            startMutation.isPending
          }
          isStopDisabled={
            (status !== "running" && status !== "starting") ||
            stopMutation.isPending
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
                ref={terminalRef}
                onInput={claudeIpc.writeToClaude}
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
