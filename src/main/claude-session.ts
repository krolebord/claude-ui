import { existsSync, statSync } from "node:fs";
import { type IPty, spawn } from "node-pty";
import type {
  ClaudeModel,
  ClaudeSessionErrorEvent,
  ClaudeSessionExitEvent,
  ClaudeSessionStatus,
  StartClaudeSessionInput,
  StopClaudeSessionResult,
} from "../shared/claude-types";
import log from "./logger";

interface SessionCallbacks {
  emitData: (chunk: string) => void;
  emitExit: (payload: Omit<ClaudeSessionExitEvent, "sessionId">) => void;
  emitError: (payload: Omit<ClaudeSessionErrorEvent, "sessionId">) => void;
  emitStatus: (status: ClaudeSessionStatus) => void;
}

type ClaudeSessionStartResult = { ok: true } | { ok: false; message: string };

interface ActiveSession {
  pty: IPty;
  token: number;
}

interface LaunchCommand {
  file: string;
  args: string[];
}

interface ClaudeLaunchOptions {
  pluginDir?: string | null;
  stateFilePath?: string;
  sessionId?: string;
  resumeSessionId?: string;
}

const GRACEFUL_EXIT_COMMAND = "/exit\r";
const GRACEFUL_STOP_TIMEOUT_MS = 1500;
const FORCE_KILL_TIMEOUT_MS = 500;

export class ClaudeSessionManager {
  private activeSession: ActiveSession | null = null;
  private status: ClaudeSessionStatus = "idle";
  private tokenCounter = 0;

  constructor(private readonly callbacks: SessionCallbacks) {}

  getStatus(): ClaudeSessionStatus {
    return this.status;
  }

  async start(
    input: StartClaudeSessionInput,
    launchOptions?: ClaudeLaunchOptions,
  ): Promise<ClaudeSessionStartResult> {
    const validationError = this.validateInput(input);
    if (validationError) {
      this.setStatus("error");
      this.callbacks.emitError({ message: validationError });
      return { ok: false, message: validationError };
    }

    if (this.activeSession) {
      await this.stop();
    }

    this.setStatus("starting");

    const cols =
      Number.isFinite(input.cols) && input.cols > 0
        ? Math.floor(input.cols)
        : 80;
    const rows =
      Number.isFinite(input.rows) && input.rows > 0
        ? Math.floor(input.rows)
        : 24;

    try {
      const launch = this.getInteractiveLaunchCommand(
        launchOptions?.pluginDir,
        input.dangerouslySkipPermissions === true,
        launchOptions?.sessionId,
        launchOptions?.resumeSessionId,
        input.model,
      );
      log.info("PTY spawn", {
        file: launch.file,
        args: launch.args,
        cwd: input.cwd,
      });
      const pty = spawn(launch.file, launch.args, {
        name: "xterm-256color",
        cols,
        rows,
        cwd: input.cwd,
        env: {
          ...process.env,
          TERM: "xterm-256color",
          CLAUDE_UI_STATE_FILE: launchOptions?.stateFilePath ?? "",
        },
      });

      const token = ++this.tokenCounter;
      this.activeSession = { pty, token };

      pty.onData((chunk) => {
        if (this.activeSession?.token !== token) {
          return;
        }
        this.callbacks.emitData(chunk);
      });

      pty.onExit(({ exitCode, signal }) => {
        if (this.activeSession?.token === token) {
          this.activeSession = null;
          if (exitCode === 127) {
            const message =
              "`claude` was not found in PATH for the interactive shell session.";
            log.error("PTY exit: claude not found (exit code 127)");
            this.setStatus("error");
            this.callbacks.emitError({ message });
          } else {
            this.setStatus("stopped");
          }
        }

        this.callbacks.emitExit({
          exitCode,
          signal: signal ?? undefined,
        });
      });

      this.setStatus("running");
      return { ok: true };
    } catch (error) {
      this.activeSession = null;
      const message = this.getStartErrorMessage(error);
      log.error("PTY spawn failed", { message, error });
      this.setStatus("error");
      this.callbacks.emitError({ message });
      return { ok: false, message };
    }
  }

  async stop(): Promise<StopClaudeSessionResult> {
    if (!this.activeSession) {
      return { ok: true };
    }

    const currentSession = this.activeSession;
    const token = currentSession.token;

    try {
      currentSession.pty.write(GRACEFUL_EXIT_COMMAND);
    } catch {
      // If writing fails, fallback to force kill below.
    }

    const exitedGracefully = await this.waitForExit(
      token,
      GRACEFUL_STOP_TIMEOUT_MS,
    );
    if (!exitedGracefully && this.activeSession?.token === token) {
      try {
        currentSession.pty.kill();
      } catch {
        // No-op if the process already exited.
      }
      await this.waitForExit(token, FORCE_KILL_TIMEOUT_MS);
    }

    if (this.activeSession?.token === token) {
      this.activeSession = null;
      this.setStatus("stopped");
      this.callbacks.emitExit({ exitCode: null });
    }

    return { ok: true };
  }

  write(data: string): void {
    if (!this.activeSession) {
      return;
    }

    this.activeSession.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    if (!this.activeSession) {
      return;
    }

    const safeCols = Number.isFinite(cols) && cols > 0 ? Math.floor(cols) : 80;
    const safeRows = Number.isFinite(rows) && rows > 0 ? Math.floor(rows) : 24;

    this.activeSession.pty.resize(safeCols, safeRows);
  }

  dispose(): void {
    if (!this.activeSession) {
      return;
    }

    try {
      this.activeSession.pty.kill();
    } catch {
      // Ignore cleanup kill errors on app shutdown.
    }

    this.activeSession = null;
    this.status = "idle";
  }

  private setStatus(nextStatus: ClaudeSessionStatus): void {
    if (this.status === nextStatus) {
      return;
    }

    this.status = nextStatus;
    this.callbacks.emitStatus(nextStatus);
  }

  private validateInput(input: StartClaudeSessionInput): string | null {
    if (!input.cwd) {
      return "Select a folder before starting Claude.";
    }

    if (!existsSync(input.cwd)) {
      return `The selected folder does not exist: ${input.cwd}`;
    }

    try {
      const stats = statSync(input.cwd);
      if (!stats.isDirectory()) {
        return `The selected path is not a directory: ${input.cwd}`;
      }
    } catch {
      return `Unable to access the selected folder: ${input.cwd}`;
    }

    return null;
  }

  private getStartErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      if (error.message.includes("ENOENT")) {
        return "`claude` was not found in PATH. Install Claude CLI or add it to PATH.";
      }
      return `Failed to start Claude: ${error.message}`;
    }

    return "Failed to start Claude due to an unknown error.";
  }

  private getInteractiveLaunchCommand(
    pluginDir?: string | null,
    dangerouslySkipPermissions = false,
    sessionId?: string,
    resumeSessionId?: string,
    model?: ClaudeModel,
  ): LaunchCommand {
    const skipPermissionsArgs = dangerouslySkipPermissions
      ? " --dangerously-skip-permissions"
      : "";
    const pluginArgs = pluginDir
      ? ` --plugin-dir ${this.shellQuote(pluginDir)}`
      : "";
    const sessionIdArgs =
      resumeSessionId || !sessionId
        ? ""
        : ` --session-id ${this.shellQuote(sessionId)}`;
    const resumeSessionArgs = resumeSessionId
      ? ` --resume ${this.shellQuote(resumeSessionId)}`
      : "";
    const modelArgs = model ? ` --model ${model}` : "";

    if (process.platform === "win32") {
      const shell = process.env.COMSPEC ?? "cmd.exe";
      const winSkipPermissionsArgs = dangerouslySkipPermissions
        ? " --dangerously-skip-permissions"
        : "";
      const winPluginArgs = pluginDir
        ? ` --plugin-dir "${pluginDir.replace(/\"/g, '""')}"`
        : "";
      const winSessionIdArgs =
        resumeSessionId || !sessionId
          ? ""
          : ` --session-id "${sessionId.replace(/\"/g, '""')}"`;
      const winResumeSessionArgs = resumeSessionId
        ? ` --resume "${resumeSessionId.replace(/\"/g, '""')}"`
        : "";
      const winModelArgs = model ? ` --model ${model}` : "";
      return {
        file: shell,
        args: [
          "/d",
          "/s",
          "/c",
          `claude${winSkipPermissionsArgs}${winPluginArgs}${winSessionIdArgs}${winResumeSessionArgs}${winModelArgs}`,
        ],
      };
    }

    const shell =
      process.env.SHELL ??
      (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");

    return {
      file: shell,
      args: [
        "-ilc",
        `exec claude${skipPermissionsArgs}${pluginArgs}${sessionIdArgs}${resumeSessionArgs}${modelArgs}`,
      ],
    };
  }

  private shellQuote(input: string): string {
    return `'${input.replace(/'/g, `'\"'\"'`)}'`;
  }

  private waitForExit(token: number, timeoutMs: number): Promise<boolean> {
    if (this.activeSession?.token !== token) {
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      const startedAt = Date.now();

      const poll = () => {
        if (this.activeSession?.token !== token) {
          resolve(true);
          return;
        }

        if (Date.now() - startedAt >= timeoutMs) {
          resolve(false);
          return;
        }

        setTimeout(poll, 25);
      };

      poll();
    });
  }
}
