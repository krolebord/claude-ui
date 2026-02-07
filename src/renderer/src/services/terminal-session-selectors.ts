import type {
  ClaudeProject,
  ClaudeSessionSnapshot,
  SessionId,
} from "@shared/claude-types";

export interface ProjectSessionGroup {
  path: string;
  name: string;
  collapsed: boolean;
  fromProjectList: boolean;
  sessions: ClaudeSessionSnapshot[];
}

export type SessionSidebarIndicatorState =
  | "idle"
  | "pending"
  | "running"
  | "awaiting_approval"
  | "awaiting_user_response"
  | "stopped"
  | "error";

interface BuildProjectSessionGroupsInput {
  projects: ClaudeProject[];
  sessionsById: Record<SessionId, ClaudeSessionSnapshot>;
}

function toTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function compareSessionsByCreatedAtDesc(
  a: ClaudeSessionSnapshot,
  b: ClaudeSessionSnapshot,
): number {
  return toTimestamp(b.createdAt) - toTimestamp(a.createdAt);
}

function getProjectNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);

  return segments[segments.length - 1] ?? path;
}

export function getSessionTitle(session: ClaudeSessionSnapshot): string {
  const sessionName = session.sessionName?.trim() ?? "";
  if (sessionName.length > 0) {
    return sessionName;
  }

  return `Session ${session.sessionId.slice(0, 8)}`;
}

export function getSessionLastActivityLabel(
  session: ClaudeSessionSnapshot,
  now = Date.now(),
): string {
  const timestamp = toTimestamp(session.lastActivityAt);
  if (timestamp <= 0) {
    return "";
  }

  const deltaSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (deltaSeconds < 60) {
    const roundedSeconds = Math.round(deltaSeconds / 10) * 10;
    if (roundedSeconds <= 0) {
      return "now";
    }
    if (roundedSeconds >= 60) {
      return "1m";
    }
    if (roundedSeconds < 60) {
      return `${roundedSeconds}s`;
    }
  }

  const minutes = Math.floor(deltaSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d`;
  }

  const weeks = Math.floor(days / 7);
  if (weeks < 5) {
    return `${weeks}w`;
  }

  const months = Math.floor(days / 30);
  if (months < 12 || days < 365) {
    return `${months}mo`;
  }

  return `${Math.floor(days / 365)}y`;
}

export function getSessionSidebarIndicatorState(
  session: ClaudeSessionSnapshot,
): SessionSidebarIndicatorState {
  if (session.status === "error") {
    return "error";
  }

  if (session.status === "stopped") {
    return "stopped";
  }

  if (session.activityState === "awaiting_approval") {
    return "awaiting_approval";
  }

  if (session.activityState === "awaiting_user_response") {
    return "awaiting_user_response";
  }

  if (session.status === "starting" || session.activityState === "working") {
    return "pending";
  }

  if (session.status === "running") {
    return "running";
  }

  return "idle";
}

export function buildProjectSessionGroups(
  state: BuildProjectSessionGroupsInput,
): ProjectSessionGroup[] {
  const allSessions = Object.values(state.sessionsById).sort(
    compareSessionsByCreatedAtDesc,
  );

  const sessionsByPath = new Map<string, ClaudeSessionSnapshot[]>();
  for (const session of allSessions) {
    const bucket = sessionsByPath.get(session.cwd);
    if (bucket) {
      bucket.push(session);
      continue;
    }

    sessionsByPath.set(session.cwd, [session]);
  }

  const groups: ProjectSessionGroup[] = [];
  const seenPaths = new Set<string>();

  for (const project of state.projects) {
    groups.push({
      path: project.path,
      name: getProjectNameFromPath(project.path),
      collapsed: project.collapsed,
      fromProjectList: true,
      sessions: sessionsByPath.get(project.path) ?? [],
    });
    seenPaths.add(project.path);
  }

  for (const [path, sessions] of sessionsByPath.entries()) {
    if (seenPaths.has(path)) {
      continue;
    }

    groups.push({
      path,
      name: getProjectNameFromPath(path),
      collapsed: false,
      fromProjectList: false,
      sessions,
    });
  }

  return groups;
}
