import spawn from "nano-spawn";

const FALLBACK_TITLE = "New Session";

const systemPrompt =
  "You are a summarization assistant. You are given a user prompt and you need to summarize it into a short session title (max 6 words). Output only the title, nothing else.";

export async function generateSessionTitle(prompt: string): Promise<string> {
  try {
    const { output } = await spawn(
      "claude",
      [
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
      ],
      {
        preferLocal: true,
        timeout: 10_000,
        stdin: "ignore",
      },
    );
    const title = output.trim();
    return title || FALLBACK_TITLE;
  } catch (e) {
    console.error("Error generating session title", e);
    return FALLBACK_TITLE;
  }
}
