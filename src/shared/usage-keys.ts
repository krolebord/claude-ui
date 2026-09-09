export type UsageProvider = "claude" | "codex" | "cursor";

/**
 * Stable key for a provider/account pair in the synced usage state. A null
 * account means the provider CLI's own login rather than a managed account.
 */
export function usageEntryKey(
  provider: UsageProvider,
  accountId: string | null | undefined,
): string {
  return `${provider}:${accountId ?? "default"}`;
}
