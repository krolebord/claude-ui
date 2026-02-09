import { UsagePanel } from "@renderer/components/usage-panel";
import { cn } from "@renderer/lib/utils";
import type {
  ProjectSessionGroup,
  SessionSidebarIndicatorState,
} from "@renderer/services/terminal-session-selectors";
import {
  getSessionLastActivityLabel,
  getSessionSidebarIndicatorState,
  getSessionTitle,
} from "@renderer/services/terminal-session-selectors";
import type { SessionId } from "@shared/claude-types";
import { useEffect, useState } from "react";
import {
  CircleDot,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  GitFork,
  LoaderCircle,
  MessageCircleQuestionMark,
  Play,
  Plus,
  Settings,
  ShieldAlert,
  Square,
  Trash2,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

export interface SidebarCallbacks {
  addProject: () => void;
  openSettings: () => void;
  toggleProject: (projectPath: string) => void;
  openNewSessionDialog: (projectPath: string) => void;
  selectSession: (sessionId: SessionId) => void;
  stopSession: (sessionId: SessionId) => void;
  resumeSession: (sessionId: SessionId) => void;
  forkSession: (sessionId: SessionId) => void;
  deleteSession: (sessionId: SessionId) => void;
  deleteProject: (projectPath: string) => void;
  openProjectDefaults: (projectPath: string) => void;
}

interface SessionSidebarProps {
  groups: ProjectSessionGroup[];
  activeSessionId: SessionId | null;
  isAddingProject: boolean;
  callbacks: SidebarCallbacks;
}

const statusIndicatorMeta: Record<
  SessionSidebarIndicatorState,
  {
    icon: LucideIcon;
    label: string;
    className: string;
    animate?: boolean;
  }
> = {
  idle: {
    icon: CircleDot,
    label: "Idle",
    className: "text-zinc-500",
  },
  pending: {
    icon: LoaderCircle,
    label: "Pending",
    className: "text-sky-400",
    animate: true,
  },
  running: {
    icon: Play,
    label: "Running",
    className: "text-emerald-400",
  },
  awaiting_approval: {
    icon: ShieldAlert,
    label: "Awaiting approval",
    className: "text-amber-400",
  },
  awaiting_user_response: {
    icon: MessageCircleQuestionMark,
    label: "Awaiting user response",
    className: "text-violet-400",
  },
  stopped: {
    icon: Square,
    label: "Stopped",
    className: "text-zinc-500",
  },
  error: {
    icon: TriangleAlert,
    label: "Error",
    className: "text-rose-400",
  },
};

export function SessionSidebar({
  groups,
  activeSessionId,
  isAddingProject,
  callbacks,
}: SessionSidebarProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timerId = setInterval(() => {
      setNow(Date.now());
    }, 30_000);

    return () => {
      clearInterval(timerId);
    };
  }, []);

  return (
    <aside className="flex h-full w-[304px] shrink-0 flex-col border-r border-border/70 bg-black/35 backdrop-blur-xl">
      <div className="flex items-center gap-1.5 border-b border-border/70 p-2">
        <button
          type="button"
          onClick={callbacks.openSettings}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-zinc-300 transition hover:bg-white/10 hover:text-white"
          aria-label="Settings"
        >
          <Settings className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={callbacks.addProject}
          disabled={isAddingProject}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs font-medium text-zinc-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <FolderPlus className="size-3.5" />
          {isAddingProject ? "Selecting project..." : "Add new project"}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="space-y-1.5">
          {groups.map((group) => (
            <section
              key={group.path}
              className="group/project rounded-lg border border-transparent bg-white/[0.02] p-0.5 transition hover:border-white/10"
            >
              <div className="flex items-center gap-1.5 rounded-md px-0.5 py-0.5">
                <button
                  type="button"
                  onClick={() => {
                    if (group.fromProjectList) {
                      callbacks.toggleProject(group.path);
                    }
                  }}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-sm font-medium text-zinc-100 transition",
                    group.fromProjectList
                      ? "hover:bg-white/5"
                      : "cursor-default opacity-90",
                  )}
                >
                  {group.fromProjectList ? (
                    group.collapsed ? (
                      <ChevronRight className="size-4 shrink-0 text-zinc-400" />
                    ) : (
                      <ChevronDown className="size-4 shrink-0 text-zinc-400" />
                    )
                  ) : (
                    <span className="inline-flex w-4 shrink-0" />
                  )}
                  {group.collapsed ? (
                    <Folder className="size-4 shrink-0 text-zinc-300" />
                  ) : (
                    <FolderOpen className="size-4 shrink-0 text-zinc-300" />
                  )}
                  <span className="truncate">{group.name}</span>
                </button>

                {group.fromProjectList ? (
                  <>
                    {group.sessions.length === 0 ? (
                      <button
                        type="button"
                        onClick={() => {
                          callbacks.deleteProject(group.path);
                        }}
                        className="inline-flex size-6 items-center justify-center rounded-md text-zinc-300 opacity-0 transition hover:bg-white/10 hover:text-rose-300 focus-visible:opacity-100 group-hover/project:opacity-100"
                        aria-label={`Delete project ${group.name}`}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        callbacks.openProjectDefaults(group.path);
                      }}
                      className="inline-flex size-6 items-center justify-center rounded-md text-zinc-300 opacity-0 transition hover:bg-white/10 hover:text-white focus-visible:opacity-100 group-hover/project:opacity-100"
                      aria-label={`Project defaults for ${group.name}`}
                    >
                      <Settings className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        callbacks.openNewSessionDialog(group.path);
                      }}
                      className="inline-flex size-6 items-center justify-center rounded-md text-zinc-300 opacity-0 transition hover:bg-white/10 hover:text-white focus-visible:opacity-100 group-hover/project:opacity-100"
                      aria-label={`New session in ${group.name}`}
                    >
                      <Plus className="size-3.5" />
                    </button>
                  </>
                ) : null}
              </div>

              {!group.collapsed ? (
                <ul className="space-y-0.5 px-1.5 pb-1.5">
                  {group.sessions.length > 0 ? (
                    group.sessions.map((session) => {
                      const isActive = activeSessionId === session.sessionId;
                      const statusState =
                        getSessionSidebarIndicatorState(session);
                      const statusMeta = statusIndicatorMeta[statusState];
                      const StatusIcon = statusMeta.icon;
                      const sessionTitle = getSessionTitle(session);
                      const lastActivity = getSessionLastActivityLabel(
                        session,
                        now,
                      );
                      const ariaLabel = `${sessionTitle} (${statusMeta.label})`;
                      const canStop =
                        session.status === "starting" ||
                        session.status === "running";
                      const canResume = session.status === "stopped";
                      const canControl = canStop || canResume;
                      const canFork =
                        session.status === "running" ||
                        session.status === "stopped" ||
                        session.status === "starting";
                      const ControlIcon = canResume ? Play : Square;
                      const controlTitle = canResume
                        ? "Resume session"
                        : "Stop session";
                      const controlAriaLabel = canResume
                        ? `Resume ${sessionTitle}`
                        : `Stop ${sessionTitle}`;

                      return (
                        <li key={session.sessionId} className="group/session relative">
                          <button
                            type="button"
                            onClick={() => {
                              callbacks.selectSession(session.sessionId);
                            }}
                            className={cn(
                              "flex w-full items-center justify-start gap-1.5 rounded-md px-1.5 py-1 pr-[4.5rem] text-sm transition",
                              isActive
                                ? "bg-white/15 text-white"
                                : "text-zinc-300 hover:bg-white/8 hover:text-zinc-100",
                            )}
                            aria-label={ariaLabel}
                          >
                            <span className="inline-flex shrink-0" title={statusMeta.label}>
                              <StatusIcon
                                className={cn(
                                  "size-3",
                                  statusMeta.className,
                                  statusMeta.animate && "animate-spin",
                                )}
                                aria-hidden="true"
                              />
                            </span>
                            <span className="min-w-0 flex-1 truncate text-left">
                              {sessionTitle}
                            </span>
                          </button>
                          <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs tabular-nums text-zinc-400 transition group-hover/session:opacity-0 group-focus-within/session:opacity-0">
                            {lastActivity}
                          </span>
                          <div className="pointer-events-none absolute inset-y-0 right-1 flex items-center gap-0.5 opacity-0 transition group-hover/session:opacity-100 group-focus-within/session:opacity-100">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void callbacks.forkSession(session.sessionId);
                              }}
                              className={cn(
                                "pointer-events-auto inline-flex size-5 items-center justify-center rounded text-zinc-300 transition",
                                canFork
                                  ? "hover:bg-white/10 hover:text-white"
                                  : "cursor-not-allowed opacity-40",
                              )}
                              aria-label={`Fork ${sessionTitle}`}
                              title="Fork session"
                              disabled={!canFork}
                            >
                              <GitFork className="size-3" />
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                if (canResume) {
                                  void callbacks.resumeSession(session.sessionId);
                                  return;
                                }
                                void callbacks.stopSession(session.sessionId);
                              }}
                              className={cn(
                                "pointer-events-auto inline-flex size-5 items-center justify-center rounded text-zinc-300 transition",
                                canControl
                                  ? "hover:bg-white/10 hover:text-white"
                                  : "cursor-not-allowed opacity-40",
                              )}
                              aria-label={controlAriaLabel}
                              title={controlTitle}
                              disabled={!canControl}
                            >
                              <ControlIcon className="size-3" />
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void callbacks.deleteSession(session.sessionId);
                              }}
                              className="pointer-events-auto inline-flex size-5 items-center justify-center rounded text-zinc-300 transition hover:bg-white/10 hover:text-rose-300"
                              aria-label={`Delete ${sessionTitle}`}
                              title="Delete session"
                            >
                              <Trash2 className="size-3" />
                            </button>
                          </div>
                        </li>
                      );
                    })
                  ) : (
                    <li className="px-1.5 py-1 text-xs text-zinc-500">
                      No sessions yet
                    </li>
                  )}
                </ul>
              ) : null}
            </section>
          ))}
        </div>
      </div>
      <UsagePanel />
    </aside>
  );
}
