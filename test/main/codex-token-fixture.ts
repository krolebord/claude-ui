/**
 * Builds a JWT-shaped Codex access token. Only the payload matters: nothing in
 * the app verifies the signature, it just reads the claims.
 */
export function makeCodexAccessToken(
  claims: {
    expSeconds?: number;
    chatgptAccountId?: string;
    planType?: string;
    email?: string;
  } = {},
): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const payload = {
    exp: claims.expSeconds,
    "https://api.openai.com/auth": {
      chatgpt_account_id: claims.chatgptAccountId,
      chatgpt_plan_type: claims.planType,
    },
    "https://api.openai.com/profile": {
      email: claims.email,
    },
  };
  return [
    encode({ alg: "none", typ: "JWT" }),
    encode(payload),
    "not-a-real-signature",
  ].join(".");
}
