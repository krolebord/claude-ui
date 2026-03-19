import { orpc } from "@renderer/orpc-client";
import { skipToken, useQuery } from "@tanstack/react-query";
import { Repeat, TerminalSquare } from "lucide-react";
import { type ComponentType, type SVGProps, useEffect } from "react";
import type { Session } from "src/main/sessions/state";
import {
  ClaudeCodeIcon,
  CodexIcon,
  CursorAgentIcon,
} from "./session-type-icons";
import { useAppState } from "./sync-state-provider";

const sessionTypeConfig: Record<
  Session["type"],
  { icon: ComponentType<SVGProps<SVGSVGElement>> }
> = {
  "claude-local-terminal": { icon: ClaudeCodeIcon },
  "local-terminal": { icon: TerminalSquare },
  "ralph-loop": { icon: Repeat },
  "codex-local-terminal": { icon: CodexIcon },
  "cursor-agent": { icon: CursorAgentIcon },
};

export function SessionHeader({ session }: { session: Session }) {
  const Icon = sessionTypeConfig[session.type]?.icon;

  const activeProject = useAppState((state) =>
    state.projects.find(
      (project) => project.path === session.startupConfig.cwd,
    ),
  );

  const { refetch } = useQuery(
    orpc.projects.refreshProject.queryOptions({
      input: activeProject
        ? {
            path: activeProject.path,
          }
        : skipToken,
      enabled: !!activeProject,
    }),
  );

  useEffect(() => {
    if (session.status === "awaiting_user_response") {
      void refetch();
    }
  }, [refetch, session.status]);

  return (
    <header className="flex min-h-11 shrink-0 items-center gap-3 border-b border-border/70 px-2 py-1.5">
      {Icon ? <Icon className="size-4 shrink-0 text-muted-foreground" /> : null}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{session.title}</div>
        {activeProject?.gitBranch ? (
          <div className="truncate text-xs text-muted-foreground">
            {activeProject.gitBranch}
          </div>
        ) : null}
      </div>
      {activeProject?.gitDiffStats ? (
        <div className="shrink-0 font-mono text-xs text-muted-foreground">
          <span className="text-emerald-400">
            +{activeProject.gitDiffStats.addedLines}
          </span>
          <span className="ml-2 text-rose-400">
            -{activeProject.gitDiffStats.deletedLines}
          </span>
        </div>
      ) : null}
    </header>
  );
}
