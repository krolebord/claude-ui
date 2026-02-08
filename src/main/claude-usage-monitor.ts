import { type ClaudeUsageResult, getUsage } from "./claude-usage-service";
import log from "./logger";

export class ClaudeUsageMonitor {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private onUpdate: (result: ClaudeUsageResult) => void;

  constructor(onUpdate: (result: ClaudeUsageResult) => void) {
    this.onUpdate = onUpdate;
  }

  async start(): Promise<ClaudeUsageResult> {
    this.stop();
    const result = await getUsage();
    if (!result.ok) {
      return result;
    }
    this.intervalId = setInterval(() => {
      void this.poll();
    }, 60_000);
    return result;
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async poll(): Promise<void> {
    const result = await getUsage();
    log.info("Usage monitor: poll complete", { ok: result.ok });
    this.onUpdate(result);
  }
}
