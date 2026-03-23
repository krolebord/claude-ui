import { type ClientPromiseResult, consumeEventIterator } from "@orpc/client";
import { ProjectTerminalPane } from "@renderer/components/project-terminal-pane";
import { SessionHeader } from "@renderer/components/session-header";
import {
  TerminalPane,
  type TerminalPaneHandle,
} from "@renderer/components/terminal-pane";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@renderer/components/ui/collapsible";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@renderer/components/ui/resizable";
import { useActiveSessionId } from "@renderer/hooks/use-active-session-id";
import { orpc } from "@renderer/orpc-client";
import type { TerminalEvent } from "@shared/terminal-types";
import { useMutation } from "@tanstack/react-query";
import {
  AlertCircle,
  ChevronRight,
  CircleCheck,
  CircleX,
  LoaderCircle,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useAppState } from "./sync-state-provider";
import { WelcomePage } from "./welcome-page";

function useActiveSession() {
  const activeSessionId = useActiveSessionId();
  const sessions = useAppState((state) => state.sessions);
  return activeSessionId ? (sessions[activeSessionId] ?? null) : null;
}

type Session = Exclude<ReturnType<typeof useActiveSession>, null>;

export function SessionPage() {
  const session = useActiveSession();
  const projectCount = useAppState((state) => state.projects.length);

  if (!session) {
    return (
      <SessionPageLayout
        topPane={<WelcomePage hasProjects={projectCount > 0} />}
        bottomPane={<ProjectTerminalPane cwd={null} />}
      />
    );
  }

  switch (session.type) {
    case "claude-local-terminal":
      return (
        <TerminalPage
          session={session}
          bottomPane={<ProjectTerminalPane cwd={session.startupConfig.cwd} />}
          subscribe={(sessionId) =>
            orpc.sessions.localClaude.subscribeToSessionTerminal.call({
              sessionId,
            })
          }
          writeToTerminal={
            orpc.sessions.localClaude.writeToSessionTerminal.call
          }
          resizeTerminal={orpc.sessions.localClaude.resizeSessionTerminal.call}
        />
      );
    case "local-terminal":
      return null;
    case "codex-local-terminal":
      return (
        <TerminalPage
          session={session}
          bottomPane={<ProjectTerminalPane cwd={session.startupConfig.cwd} />}
          subscribe={(sessionId) =>
            orpc.sessions.codex.subscribeToSessionTerminal.call({
              sessionId,
            })
          }
          writeToTerminal={orpc.sessions.codex.writeToSessionTerminal.call}
          resizeTerminal={orpc.sessions.codex.resizeSessionTerminal.call}
        />
      );
    case "cursor-agent":
      return (
        <TerminalPage
          session={session}
          bottomPane={<ProjectTerminalPane cwd={session.startupConfig.cwd} />}
          subscribe={(sessionId) =>
            orpc.sessions.cursorAgent.subscribeToSessionTerminal.call({
              sessionId,
            })
          }
          writeToTerminal={
            orpc.sessions.cursorAgent.writeToSessionTerminal.call
          }
          resizeTerminal={orpc.sessions.cursorAgent.resizeSessionTerminal.call}
        />
      );
    case "ralph-loop":
      return <RalphLoopSessionPage session={session} />;
    case "worktree-setup":
      return <WorktreeSetupSessionPage session={session} />;
    default:
      return null;
  }
}

function WorktreeSetupSessionPage({
  session,
}: {
  session: Extract<Session, { type: "worktree-setup" }>;
}) {
  return (
    <SessionPageLayout
      topPane={
        <div className="flex h-full min-h-0 flex-col">
          <SessionHeader session={session} />
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-4">
            {session.steps.map((step, index) => (
              <WorktreeSetupStepRow
                key={`${index}-${step.command}`}
                step={step}
              />
            ))}
          </div>
        </div>
      }
      bottomPane={<ProjectTerminalPane cwd={session.startupConfig.cwd} />}
    />
  );
}

function WorktreeSetupStepRow({
  step,
}: {
  step: Extract<Session, { type: "worktree-setup" }>["steps"][number];
}) {
  const isError = step.status === "error";
  const isRunning = step.status === "running";
  const isPending = step.status === "pending";

  return (
    <Collapsible defaultOpen={isRunning || isError}>
      <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent/50">
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
        {isRunning ? (
          <LoaderCircle className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : isError ? (
          <CircleX className="size-3.5 shrink-0 text-rose-400" />
        ) : isPending ? (
          <span className="size-3.5 shrink-0 text-muted-foreground">○</span>
        ) : (
          <CircleCheck className="size-3.5 shrink-0 text-emerald-400" />
        )}
        <code className="truncate">{step.command}</code>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {step.output ? (
          <pre className="mx-2 mb-1 max-h-60 overflow-auto rounded border border-border/60 bg-muted/30 p-2 font-mono text-xs whitespace-pre-wrap">
            {step.output}
            {step.outputTruncated ? (
              <span className="text-muted-foreground"> (truncated)</span>
            ) : null}
          </pre>
        ) : null}
        {isError && step.errorMessage ? (
          <pre className="mx-2 mb-1 max-h-40 overflow-auto rounded border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-300 whitespace-pre-wrap">
            {step.errorMessage}
          </pre>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

function RalphLoopSessionPage({
  session,
}: {
  session: Extract<Session, { type: "ralph-loop" }>;
}) {
  const stopLoop = useMutation(
    orpc.sessions.ralphLoop.stopLoop.mutationOptions(),
  );
  const resumeLoop = useMutation(
    orpc.sessions.ralphLoop.resumeSession.mutationOptions(),
  );
  const runSingleIteration = useMutation(
    orpc.sessions.ralphLoop.runSingleIteration.mutationOptions(),
  );

  const isRunning =
    session.status === "starting" ||
    session.status === "running" ||
    session.status === "stopping";
  const isTerminalCompletion =
    session.loopState.completion === "done" ||
    session.loopState.completion === "max_iterations";

  const loopReadOnly = session.loopState.autonomousEnabled;

  return (
    <TerminalPage
      session={session}
      bottomPane={<ProjectTerminalPane cwd={session.startupConfig.cwd} />}
      subscribe={(sessionId) =>
        orpc.sessions.ralphLoop.subscribeToSessionTerminal.call({
          sessionId,
        })
      }
      writeToTerminal={orpc.sessions.ralphLoop.writeToSessionTerminal.call}
      resizeTerminal={orpc.sessions.ralphLoop.resizeSessionTerminal.call}
      readOnly={loopReadOnly}
      controls={
        <header className="flex h-9 flex-wrap items-center gap-2 border-b border-border/70 px-2">
          <Badge variant="secondary">
            Iteration {session.loopState.currentIteration}/
            {session.startupConfig.maxIterations}
          </Badge>
          <Badge variant="outline">
            Failures {session.loopState.consecutiveFailures}/
            {session.startupConfig.maxConsecutiveFailures}
          </Badge>
          <ElapsedTimeBadge
            createdAt={session.createdAt}
            completedAt={session.loopState.completedAt}
          />
          <Badge variant="outline">{session.loopState.completion}</Badge>

          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={
                stopLoop.isPending ||
                resumeLoop.isPending ||
                (session.loopState.autonomousEnabled
                  ? false
                  : isRunning || isTerminalCompletion)
              }
              onClick={() => {
                if (session.loopState.autonomousEnabled) {
                  stopLoop.mutate({ sessionId: session.sessionId });
                  return;
                }
                resumeLoop.mutate({ sessionId: session.sessionId });
              }}
            >
              {session.loopState.autonomousEnabled
                ? stopLoop.isPending
                  ? "Stopping..."
                  : "Stop Loop"
                : resumeLoop.isPending
                  ? "Resuming..."
                  : "Resume Loop"}
            </Button>
            <Button
              size="sm"
              disabled={runSingleIteration.isPending || isRunning}
              onClick={() => {
                runSingleIteration.mutate({ sessionId: session.sessionId });
              }}
            >
              {runSingleIteration.isPending
                ? "Running..."
                : "Run Single Iteration"}
            </Button>
          </div>
        </header>
      }
    />
  );
}

function ElapsedTimeBadge({
  createdAt,
  completedAt,
}: {
  createdAt: number;
  completedAt?: number;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (completedAt != null) {
      return;
    }
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [completedAt]);

  const elapsedMs = (completedAt ?? now) - createdAt;
  return <Badge variant="outline">Run time {formatElapsed(elapsedMs)}</Badge>;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function TerminalPage({
  session,
  subscribe,
  writeToTerminal,
  resizeTerminal,
  readOnly,
  controls,
  bottomPane,
}: {
  session: Session;
  subscribe: (
    sessionId: string,
  ) => ClientPromiseResult<AsyncGenerator<TerminalEvent, void, unknown>, Error>;
  writeToTerminal: (opts: { sessionId: string; data: string }) => void;
  resizeTerminal: (opts: {
    sessionId: string;
    cols: number;
    rows: number;
  }) => void;
  readOnly?: boolean;
  controls?: ReactNode;
  bottomPane?: ReactNode;
}) {
  const terminalRef = useRef<TerminalPaneHandle | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: subscribe and bufferedOutput are intentionally captured once per session switch
  useEffect(() => {
    terminalRef.current?.clear();
    terminalRef.current?.write(session.bufferedOutput ?? "");
    terminalRef.current?.autofit();

    const cancel = consumeEventIterator(
      subscribe(session.sessionId).then((stream) => {
        terminalRef.current?.focus();
        return stream;
      }),
      {
        onEvent(event) {
          switch (event.type) {
            case "data":
              terminalRef.current?.write(event.data);
              break;
            case "clear":
              terminalRef.current?.clear();
              break;
          }
        },
        onError(error) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          if (message.includes("closed or aborted")) {
            return;
          }
          toast.error(`Terminal stream disconnected: ${message}`);
        },
      },
    );
    return () => void cancel();
  }, [session.sessionId]);

  const handleTerminalInput = useCallback(
    (data: string) => {
      if (readOnly) {
        return;
      }

      writeToTerminal({
        sessionId: session.sessionId,
        data,
      });
    },
    [session.sessionId, readOnly, writeToTerminal],
  );

  const handleTerminalResize = useCallback(
    (cols: number, rows: number) => {
      resizeTerminal({
        sessionId: session.sessionId,
        cols,
        rows,
      });
    },
    [session.sessionId, resizeTerminal],
  );

  const errorMessage = session.errorMessage || session.warningMessage || "";

  return (
    <SessionPageLayout
      topPane={
        <div className="flex h-full min-h-0 flex-col">
          <SessionHeader session={session} />
          {controls}
          {errorMessage ? (
            <div className="mx-4 mt-4 flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              <AlertCircle className="size-4" />
              <span>{errorMessage}</span>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-hidden">
            <TerminalPane
              ref={terminalRef}
              onInput={handleTerminalInput}
              onResize={handleTerminalResize}
              readOnly={readOnly}
            />
          </div>
        </div>
      }
      bottomPane={bottomPane}
    />
  );
}

function SessionPageLayout({
  topPane,
  bottomPane,
}: {
  topPane: ReactNode;
  bottomPane?: ReactNode;
}) {
  return (
    <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
      <ResizablePanel defaultSize={70} minSize={35}>
        {topPane}
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize={30} minSize={15}>
        {bottomPane ?? <div className="h-full bg-black/10" />}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
