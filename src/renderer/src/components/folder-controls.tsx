import type {
  ClaudeActivityState,
  ClaudeSessionStatus,
} from "@shared/claude-types";
import { FolderOpen, Play, Square } from "lucide-react";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@renderer/components/ui/card";
import { Input } from "@renderer/components/ui/input";
import { cn } from "@renderer/lib/utils";

interface FolderControlsProps {
  folderPath: string;
  status: ClaudeSessionStatus;
  activityState: ClaudeActivityState;
  activityDetail: string | null;
  activityWarning: string | null;
  onSelectFolder: () => void;
  onStart: () => void;
  onStop: () => void;
  isSelecting: boolean;
  isStarting: boolean;
  isStopping: boolean;
  isStartDisabled: boolean;
  isStopDisabled: boolean;
}

const statusStyle: Record<ClaudeSessionStatus, string> = {
  idle: "bg-muted text-muted-foreground border-border",
  starting: "bg-accent text-accent-foreground border-accent/40",
  running: "bg-emerald-100 text-emerald-700 border-emerald-200",
  stopped: "bg-secondary text-secondary-foreground border-secondary",
  error: "bg-destructive/15 text-destructive border-destructive/30",
};

const activityStyle: Record<ClaudeActivityState, string> = {
  idle: "bg-muted text-muted-foreground border-border",
  unknown: "bg-slate-100 text-slate-700 border-slate-200",
  working: "bg-blue-100 text-blue-700 border-blue-200",
  awaiting_approval: "bg-amber-100 text-amber-700 border-amber-200",
  awaiting_user_response:
    "bg-violet-100 text-violet-700 border-violet-200",
};

export function FolderControls({
  folderPath,
  status,
  activityState,
  activityDetail,
  activityWarning,
  onSelectFolder,
  onStart,
  onStop,
  isSelecting,
  isStarting,
  isStopping,
  isStartDisabled,
  isStopDisabled,
}: FolderControlsProps) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Claude Launcher</CardTitle>
        <div className="flex items-center gap-2">
          <Badge className={cn("border uppercase", statusStyle[status])}>
            {status}
          </Badge>
          <Badge className={cn("border uppercase", activityStyle[activityState])}>
            {activityState}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row">
          <Input
            value={folderPath || "No folder selected"}
            readOnly
            aria-label="Selected folder"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onSelectFolder}
              disabled={isSelecting}
              className="min-w-36"
            >
              <FolderOpen className="size-4" />
              {isSelecting ? "Selecting..." : "Select Folder"}
            </Button>
            <Button
              type="button"
              onClick={onStart}
              disabled={isStartDisabled}
              className="min-w-24"
            >
              <Play className="size-4" />
              {isStarting ? "Starting..." : "Start"}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={onStop}
              disabled={isStopDisabled}
              className="min-w-24"
            >
              <Square className="size-4" />
              {isStopping ? "Stopping..." : "Stop"}
            </Button>
          </div>
        </div>
        {activityDetail ? (
          <p className="text-xs text-muted-foreground">{activityDetail}</p>
        ) : null}
        {activityWarning ? (
          <p className="text-xs text-amber-700">{activityWarning}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
