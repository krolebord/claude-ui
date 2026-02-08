import { cn } from "@renderer/lib/utils";
import { claudeIpc } from "@renderer/lib/ipc";
import type { ClaudeUsageData } from "@shared/claude-types";
import { BarChart3, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type UsagePanelState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "active"; usage: ClaudeUsageData };

const BUCKET_LABELS: { key: keyof ClaudeUsageData; label: string }[] = [
  { key: "five_hour", label: "5 hour" },
  { key: "seven_day", label: "Daily" },
  { key: "seven_day_sonnet", label: "Sonnet" },
];

function getBarColor(pct: number): string {
  return pct >= 100 ? "bg-[#DE7356]" : "bg-zinc-500";
}

function getTextColor(pct: number): string {
  return pct >= 100 ? "text-[#DE7356]" : "text-zinc-400";
}

export function UsagePanel() {
  const [state, setState] = useState<UsagePanelState>({ status: "idle" });
  const unsubRef = useRef<(() => void) | null>(null);

  const subscribe = useCallback(() => {
    unsubRef.current?.();
    unsubRef.current = claudeIpc.onClaudeUsageUpdate(({ result }) => {
      if (result.ok) {
        setState({ status: "active", usage: result.usage });
      } else {
        toast.error(result.message);
      }
    });
  }, []);

  useEffect(() => {
    return () => {
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, []);

  const handleStart = useCallback(async () => {
    setState({ status: "loading" });
    subscribe();
    try {
      const result = await claudeIpc.startUsageMonitor();
      if (result.ok) {
        setState({ status: "active", usage: result.usage });
      } else {
        toast.error(result.message);
        setState({ status: "idle" });
      }
    } catch {
      toast.error("Failed to start usage monitor");
      setState({ status: "idle" });
    }
  }, [subscribe]);

  if (state.status === "idle") {
    return (
      <div className="border-t border-border/70 p-2">
        <button
          type="button"
          onClick={() => void handleStart()}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs font-medium text-zinc-100 transition hover:bg-white/10"
        >
          <BarChart3 className="size-3.5" />
          Show Usage
        </button>
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div className="border-t border-border/70 p-2">
        <div className="flex items-center justify-center gap-1.5 py-1.5 text-xs text-zinc-400">
          <LoaderCircle className="size-3.5 animate-spin" />
          Loading usage...
        </div>
      </div>
    );
  }

  const { usage } = state;

  return (
    <div className="border-t border-border/70 p-2">
      <div className="space-y-1.5">
        {BUCKET_LABELS.map(({ key, label }) => {
          const bucket = usage[key];
          if (!bucket || typeof bucket !== "object" || !("utilization" in bucket)) return null;
          const pct = Math.round(bucket.utilization);
          return (
            <div key={key} className="space-y-0.5">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-zinc-400">{label}</span>
                <span className={cn("tabular-nums", getTextColor(pct))}>
                  {pct}%
                </span>
              </div>
              <div className="h-1 rounded-full bg-white/10">
                <div
                  className={cn("h-full rounded-full transition-all", getBarColor(pct))}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>
            </div>
          );
        })}
        {usage.extra_usage && usage.extra_usage.is_enabled ? (() => {
          const used = usage.extra_usage.used_credits / 100;
          const limit = usage.extra_usage.monthly_limit / 100;
          const pct = Math.round(usage.extra_usage.utilization);
          return (
            <div className="space-y-0.5">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-zinc-400">Extra usage</span>
                <span className={cn("tabular-nums", getTextColor(pct))}>
                  ${used.toFixed(2)} / ${limit.toFixed(2)}
                </span>
              </div>
              <div className="h-1 rounded-full bg-white/10">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    getBarColor(pct),
                  )}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>
            </div>
          );
        })() : null}
      </div>
    </div>
  );
}
