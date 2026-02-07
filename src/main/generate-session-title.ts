import spawn from "nano-spawn";
import log from "./logger";

const FALLBACK_TITLE = "New Session";

const systemPrompt =
  "You are a summarization assistant. You are given a user prompt and you need to summarize it into a short session title (max 6 words). Output only the title, nothing else.";

export async function generateSessionTitle(prompt: string): Promise<string> {
  const args = [
    "--system-prompt",
    systemPrompt,
    "--print",
    `User prompt:\n${prompt}`,
    "--model",
    "haiku",
    "--fallback-model",
    "sonnet",
    "--no-chrome",
    "--no-session-persistence",
    "--permission-mode",
    "dontAsk",
    "--tools",
    "",
  ];

  log.info("Title generation: spawning claude", {
    args,
    PATH: process.env.PATH,
    SHELL: process.env.SHELL,
    HOME: process.env.HOME,
  });

  try {
    const { output } = await spawn("claude", args, {
      preferLocal: true,
      timeout: 10_000,
      stdin: "ignore",
    });
    const title = output.trim();
    log.info("Title generation: success", { title: title || FALLBACK_TITLE });
    return title || FALLBACK_TITLE;
  } catch (e: unknown) {
    const err = e as {
      message?: string;
      code?: string;
      stderr?: string;
      exitCode?: number;
    };
    log.error("Title generation: failed", {
      message: err.message,
      code: err.code,
      stderr: err.stderr,
      exitCode: err.exitCode,
    });
    return FALLBACK_TITLE;
  }
}
