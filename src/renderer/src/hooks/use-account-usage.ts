import { useAppState } from "@renderer/components/sync-state-provider";
import type { SyncStateStore } from "@renderer/services/state-sync-client";
import { usageEntryKey } from "@shared/usage-keys";
import { useCallback } from "react";
import type { ExtractState } from "zustand";

export type UsageEntry =
  ExtractState<SyncStateStore>["usage"]["entries"][string];

/**
 * Utilization of the shortest rate-limit window an entry reports: Claude's
 * five-hour bucket, and Codex's shortest window — usually five hours, but the
 * app-server decides which windows it hands out.
 */
export function shortWindowUsagePercent(
  entry: UsageEntry | undefined,
): number | null {
  if (!entry) {
    return null;
  }

  switch (entry.provider) {
    case "claude": {
      const utilization = entry.data?.five_hour?.utilization;
      return utilization == null ? null : Math.round(utilization);
    }
    case "codex": {
      const windows = [
        entry.data?.primaryWindow,
        entry.data?.secondaryWindow,
      ].filter(
        (window): window is NonNullable<typeof window> => window != null,
      );
      if (windows.length === 0) {
        return null;
      }
      const shortest = windows.reduce((current, window) =>
        window.windowSeconds < current.windowSeconds ? window : current,
      );
      return Math.round(shortest.utilization);
    }
    default:
      return null;
  }
}

/**
 * Reads the tracked short-window utilization for a provider's accounts. A null
 * account id means the provider CLI's own login, and a null result means usage
 * has not been read yet.
 */
export function useAccountUsagePercent(provider: "claude" | "codex") {
  const entries = useAppState((state) => state.usage.entries);

  return useCallback(
    (accountId: string | null) =>
      shortWindowUsagePercent(entries[usageEntryKey(provider, accountId)]),
    [entries, provider],
  );
}
