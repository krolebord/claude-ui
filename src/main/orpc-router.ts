import { fsRouter } from "./fs.router";
import { projectsRouter } from "./project-service";
import { claudeSessionsRouter } from "./session-service";
import { codexSessionsRouter } from "./sessions/codex.session";
import { localTerminalRouter } from "./sessions/local-terminal.session";
import { ralphLoopRouter } from "./sessions/ralph-loop.session";
import { stateSyncRouter } from "./state-orchestrator";

export const orpcRouter = {
  projects: projectsRouter,
  fs: fsRouter,
  stateSync: stateSyncRouter,
  sessions: {
    localClaude: claudeSessionsRouter,
    localTerminal: localTerminalRouter,
    ralphLoop: ralphLoopRouter,
    codex: codexSessionsRouter,
  },
};
