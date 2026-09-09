import { useAppState } from "./sync-state-provider";

export function MachineStatsLine() {
  const enabled = useAppState(
    (state) => state.appSettings.machineStats.enabled,
  );
  const stats = useAppState((state) => state.machineStats);

  if (!enabled) {
    return null;
  }

  const cpuLabel =
    stats.cpuLoadPercent === null
      ? "--"
      : `${Math.round(stats.cpuLoadPercent)}%`;
  const memoryLabel = formatUsage(
    stats.memoryUsedBytes,
    stats.memoryTotalBytes,
  );
  const diskLabel = formatUsage(stats.diskUsedBytes, stats.diskTotalBytes);

  return (
    <div
      className="flex h-7 shrink-0 items-center border-t border-border/60 px-2 font-mono text-[10px] text-zinc-500"
      title={stats.error ?? undefined}
    >
      <span className="truncate">
        CPU: {cpuLabel} | RAM: {memoryLabel} | Disk: {diskLabel}
      </span>
    </div>
  );
}

function formatUsage(
  usedBytes: number | null,
  totalBytes: number | null,
): string {
  if (usedBytes === null || totalBytes === null) {
    return "-- / -- GB";
  }
  return `${formatGiB(usedBytes)} / ${formatGiB(totalBytes)} GB`;
}

function formatGiB(bytes: number): string {
  const value = bytes / 1024 ** 3;
  return value >= 10 ? value.toFixed(1) : value.toFixed(2);
}
