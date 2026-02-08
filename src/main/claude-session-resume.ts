import type {
  ClaudeSessionsSnapshot,
  SessionId,
  StartClaudeSessionInput,
  StartClaudeSessionResult,
} from "../shared/claude-types";
import type { SessionRecord } from "./claude-session-record-factory";

interface ResumeStoppedSessionDeps {
  getRecord: (sessionId: SessionId) => SessionRecord | undefined;
  stateFileFactory: (sessionId: SessionId) => Promise<string>;
  cleanupStateFile: (record: SessionRecord) => void;
  pluginDir: string | null;
  setActiveSession: (sessionId: SessionId) => void;
  getSessionsSnapshot: () => ClaudeSessionsSnapshot;
}

export async function resumeStoppedSession(
  deps: ResumeStoppedSessionDeps,
  sessionId: SessionId,
  input: StartClaudeSessionInput,
): Promise<StartClaudeSessionResult> {
  const record = deps.getRecord(sessionId);
  if (!record) {
    return {
      ok: false,
      message: `Session does not exist: ${sessionId}`,
    };
  }

  if (record.status === "starting" || record.status === "running") {
    deps.setActiveSession(record.sessionId);
    return {
      ok: true,
      sessionId: record.sessionId,
      snapshot: deps.getSessionsSnapshot(),
    };
  }

  try {
    deps.cleanupStateFile(record);
    const stateFilePath = await deps.stateFileFactory(sessionId);
    record.stateFilePath = stateFilePath;
    record.monitor.startMonitoring(stateFilePath);

    const result = await record.manager.start(
      {
        cwd: record.cwd,
        cols: input.cols,
        rows: input.rows,
        permissionMode: input.permissionMode,
        model: input.model,
      },
      {
        pluginDir: deps.pluginDir,
        stateFilePath,
        resumeSessionId: record.sessionId,
      },
    );

    if (!result.ok) {
      record.monitor.stopMonitoring();
      deps.cleanupStateFile(record);
      return result;
    }

    deps.setActiveSession(record.sessionId);
    return {
      ok: true,
      sessionId: record.sessionId,
      snapshot: deps.getSessionsSnapshot(),
    };
  } catch (error) {
    record.monitor.stopMonitoring();
    deps.cleanupStateFile(record);
    return {
      ok: false,
      message:
        error instanceof Error
          ? `Failed to resume session: ${error.message}`
          : "Failed to resume session due to an unknown error.",
    };
  }
}
