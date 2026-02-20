import { describe, expect, it, vi } from "vitest";
import {
  type ClaudeLocalTerminalSessionData,
  SessionsServiceNew,
} from "../../src/main/session-service";
import type { SessionStateFileManager } from "../../src/main/session-state-file-manager";
import type { SessionTitleManager } from "../../src/main/session-title-manager";
import type { SessionServiceState } from "../../src/main/sessions/state";

function createService() {
  const state: Record<string, ClaudeLocalTerminalSessionData> = {};
  const sessionsState = {
    state,
    updateState: (updater: (draft: typeof state) => void) => {
      updater(state);
    },
  } as unknown as SessionServiceState;

  const titleManager = {
    maybeGenerate: vi.fn(),
    forget: vi.fn(),
  } as unknown as SessionTitleManager;

  const stateFileManager = {
    create: vi.fn().mockResolvedValue("/tmp/test-state.ndjson"),
    cleanup: vi.fn(),
  } as unknown as SessionStateFileManager;

  const service = new SessionsServiceNew({
    pluginDir: null,
    pluginWarning: null,
    titleManager,
    stateFileManager,
    state: sessionsState,
  });

  return { service, state, titleManager };
}

describe("SessionsServiceNew.renameSession", () => {
  it("updates the Claude session title", () => {
    const { service, state, titleManager } = createService();

    state["session-1"] = {
      sessionId: "session-1",
      type: "claude-local-terminal",
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      status: "stopped",
      title: "Old Name",
      startupConfig: {
        cwd: "/tmp",
        permissionMode: "default",
        model: "opus",
      },
      bufferedOutput: "",
    };

    service.renameSession("session-1", "  New Name  ");

    expect(state["session-1"]?.title).toBe("New Name");
    expect(vi.mocked(titleManager.forget)).toHaveBeenCalledWith("session-1");
  });
});
