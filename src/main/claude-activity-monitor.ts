import { open, stat } from "node:fs/promises";
import type {
  ClaudeActivityState,
  ClaudeHookEvent,
} from "../shared/claude-types";

const POLL_INTERVAL_MS = 180;

interface ActivityMonitorCallbacks {
  emitActivityState: (state: ClaudeActivityState) => void;
  emitHookEvent: (event: ClaudeHookEvent) => void;
}

export class ClaudeActivityMonitor {
  private readonly callbacks: ActivityMonitorCallbacks;
  private state: ClaudeActivityState = "unknown";
  private stateFilePath: string | null = null;
  private fileOffset = 0;
  private buffer = "";
  private intervalId: NodeJS.Timeout | null = null;
  private isPolling = false;

  constructor(callbacks: ActivityMonitorCallbacks) {
    this.callbacks = callbacks;
  }

  getState(): ClaudeActivityState {
    return this.state;
  }

  startMonitoring(stateFilePath: string): void {
    this.stopMonitoring({ preserveState: false });

    this.stateFilePath = stateFilePath;
    this.fileOffset = 0;
    this.buffer = "";
    this.setState("unknown");

    this.intervalId = setInterval(() => {
      void this.poll();
    }, POLL_INTERVAL_MS);

    void this.poll();
  }

  stopMonitoring(options?: { preserveState?: boolean }): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.stateFilePath = null;
    this.fileOffset = 0;
    this.buffer = "";
    this.isPolling = false;

    if (!options?.preserveState) {
      this.setState("unknown");
    }
  }

  private async poll(): Promise<void> {
    if (this.isPolling || !this.stateFilePath) {
      return;
    }

    this.isPolling = true;

    try {
      const fileStats = await stat(this.stateFilePath).catch(() => null);
      if (!fileStats) {
        return;
      }

      if (fileStats.size < this.fileOffset) {
        this.fileOffset = 0;
        this.buffer = "";
      }

      if (fileStats.size === this.fileOffset) {
        return;
      }

      const bytesToRead = Number(fileStats.size - this.fileOffset);
      const handle = await open(this.stateFilePath, "r");

      try {
        const chunkBuffer = Buffer.alloc(bytesToRead);
        const { bytesRead } = await handle.read(
          chunkBuffer,
          0,
          bytesToRead,
          this.fileOffset,
        );

        if (!bytesRead) {
          return;
        }

        this.fileOffset += bytesRead;
        this.processChunk(chunkBuffer.toString("utf8", 0, bytesRead));
      } finally {
        await handle.close();
      }
    } finally {
      this.isPolling = false;
    }
  }

  private processChunk(chunk: string): void {
    this.buffer += chunk;

    while (true) {
      const newLineIndex = this.buffer.indexOf("\n");
      if (newLineIndex < 0) {
        break;
      }

      const line = this.buffer.slice(0, newLineIndex).trim();
      this.buffer = this.buffer.slice(newLineIndex + 1);

      if (!line) {
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }

      if (!parsed || typeof parsed !== "object") {
        continue;
      }

      const event = parsed as ClaudeHookEvent;
      if (typeof event.hook_event_name !== "string") {
        continue;
      }

      this.callbacks.emitHookEvent(event);
      this.setState(this.reduceState(event));
    }
  }

  private reduceState(event: ClaudeHookEvent): ClaudeActivityState {
    switch (event.hook_event_name) {
      case "SessionStart":
      case "SessionEnd": {
        return "idle";
      }
      case "Stop": {
        return "awaiting_user_response";
      }
      case "UserPromptSubmit":
      case "PreToolUse":
      case "PostToolUse":
      case "PostToolUseFailure": {
        return "working";
      }
      case "PermissionRequest": {
        return "awaiting_approval";
      }
      case "Notification": {
        if (
          event.notification_type === "permission_prompt" ||
          event.notification_type === "permission_request"
        ) {
          return "awaiting_approval";
        }

        if (
          event.notification_type === "idle_prompt" ||
          event.notification_type === "idle"
        ) {
          return "awaiting_user_response";
        }

        return this.state;
      }
      default: {
        return this.state;
      }
    }
  }

  private setState(nextState: ClaudeActivityState): void {
    if (this.state === nextState) {
      return;
    }

    this.state = nextState;
    this.callbacks.emitActivityState(nextState);
  }
}
