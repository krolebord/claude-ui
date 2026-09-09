import { z } from "zod";

/**
 * Assumed token lifetime when no `exp` claim is readable. Matches the
 * staleness threshold the Codex CLI applies to its own stored tokens.
 */
export const CODEX_TOKEN_FALLBACK_LIFETIME_MS = 8 * 24 * 60 * 60_000;

/**
 * Codex access tokens are JWTs whose claims carry everything we need to label
 * an account: the workspace id Codex bills against, the plan, and the email.
 * Reading them beats an extra API call, and it is how the app-server itself
 * derives account metadata in external auth mode.
 */
const accessTokenClaimsSchema = z.object({
  exp: z.number().optional(),
  "https://api.openai.com/auth": z
    .object({
      chatgpt_account_id: z.string().optional(),
      chatgpt_plan_type: z.string().optional(),
    })
    .optional(),
  "https://api.openai.com/profile": z
    .object({
      email: z.string().optional(),
    })
    .optional(),
});

export interface CodexTokenClaims {
  /** Workspace id, sent to the app-server as `chatgptAccountId`. */
  chatgptAccountId?: string;
  planType?: string;
  email?: string;
  /** Unix epoch milliseconds, from the JWT `exp` claim. */
  expiresAt?: number;
}

export function decodeCodexTokenClaims(token: string): CodexTokenClaims | null {
  const payload = token.split(".")[1];
  if (!payload) {
    return null;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  const parsed = accessTokenClaimsSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return null;
  }

  const auth = parsed.data["https://api.openai.com/auth"];
  const profile = parsed.data["https://api.openai.com/profile"];
  return {
    chatgptAccountId: auth?.chatgpt_account_id,
    planType: auth?.chatgpt_plan_type,
    email: profile?.email,
    expiresAt: parsed.data.exp != null ? parsed.data.exp * 1_000 : undefined,
  };
}
