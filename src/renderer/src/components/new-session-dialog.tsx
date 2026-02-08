import { useMutation } from "@tanstack/react-query";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Input } from "@renderer/components/ui/input";
import { Label } from "@renderer/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import { Textarea } from "@renderer/components/ui/textarea";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@renderer/components/ui/toggle-group";
import { claudeIpc } from "@renderer/lib/ipc";
import type {
  ClaudeModel,
  ClaudePermissionMode,
  ClaudeSessionsSnapshot,
  StartClaudeSessionInput,
} from "@shared/claude-types";
import { AlertCircle } from "lucide-react";

interface NewSessionDialogProps {
  open: boolean;
  projectPath: string | null;
  initialPrompt: string;
  sessionName: string;
  model: ClaudeModel;
  permissionMode: ClaudePermissionMode;
  getTerminalSize: () => { cols: number; rows: number };
  onInitialPromptChange: (value: string) => void;
  onSessionNameChange: (value: string) => void;
  onModelChange: (value: ClaudeModel) => void;
  onPermissionModeChange: (value: ClaudePermissionMode) => void;
  onCancel: () => void;
  onStarted: (snapshot: ClaudeSessionsSnapshot) => void;
}

function getProjectNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);

  return segments[segments.length - 1] ?? path;
}

const MODEL_OPTIONS: { value: ClaudeModel; label: string }[] = [
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "haiku", label: "Haiku" },
];

const PERMISSION_MODES: { value: ClaudePermissionMode; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "acceptEdits", label: "Accept edits" },
  { value: "plan", label: "Plan" },
  { value: "yolo", label: "Yolo" },
];

function cyclePermissionMode(
  current: ClaudePermissionMode,
): ClaudePermissionMode {
  const index = PERMISSION_MODES.findIndex((m) => m.value === current);
  return PERMISSION_MODES[(index + 1) % PERMISSION_MODES.length].value;
}

export function NewSessionDialog({
  open,
  projectPath,
  initialPrompt,
  sessionName,
  model,
  permissionMode,
  getTerminalSize,
  onInitialPromptChange,
  onSessionNameChange,
  onModelChange,
  onPermissionModeChange,
  onCancel,
  onStarted,
}: NewSessionDialogProps) {
  const mutation = useMutation({
    mutationFn: async (input: StartClaudeSessionInput) => {
      const result = await claudeIpc.startClaudeSession(input);
      if (!result.ok) throw new Error(result.message);
      return result;
    },
    onSuccess: (result) => {
      onStarted(result.snapshot);
    },
  });

  const handleCancel = () => {
    mutation.reset();
    onCancel();
  };

  if (!open || !projectPath) {
    return null;
  }

  const projectName = getProjectNameFromPath(projectPath);

  const handleSubmit = () => {
    if (mutation.isPending) {
      return;
    }

    const trimmedName = sessionName.trim();
    const trimmedPrompt = initialPrompt.trim();
    const terminalSize = getTerminalSize();

    mutation.mutate({
      cwd: projectPath,
      cols: terminalSize.cols,
      rows: terminalSize.rows,
      sessionName: trimmedName.length > 0 ? trimmedName : undefined,
      model,
      permissionMode,
      initialPrompt: trimmedPrompt.length > 0 ? trimmedPrompt : undefined,
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) handleCancel();
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Start new session</DialogTitle>
          <DialogDescription>
            Project: <span className="text-foreground">{projectName}</span>
            <br />
            <span className="text-xs text-muted-foreground">{projectPath}</span>
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="new-session-initial-prompt">
              Initial prompt (optional)
            </Label>
            <Textarea
              id="new-session-initial-prompt"
              autoFocus
              placeholder="What would you like Claude to do?"
              value={initialPrompt}
              onChange={(event) => {
                onInitialPromptChange(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  handleSubmit();
                }
              }}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-session-name">Session name (optional)</Label>
            <Input
              id="new-session-name"
              placeholder="Leave blank for generated name"
              value={sessionName}
              onChange={(event) => {
                onSessionNameChange(event.target.value);
              }}
            />
          </div>

          <div className="space-y-2">
            <Label>Model</Label>
            <Select
              value={model}
              onValueChange={(value) =>
                onModelChange(value as ClaudeModel)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODEL_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div
            className="space-y-2"
            onKeyDown={(event) => {
              if (event.shiftKey && event.key === "Tab") {
                event.preventDefault();
                onPermissionModeChange(cyclePermissionMode(permissionMode));
              }
            }}
          >
            <Label>Permission mode</Label>
            <ToggleGroup
              type="single"
              variant="outline"
              value={permissionMode}
              onValueChange={(value) => {
                if (value) {
                  onPermissionModeChange(value as ClaudePermissionMode);
                }
              }}
              className="w-full"
            >
              {PERMISSION_MODES.map((option) => (
                <ToggleGroupItem
                  key={option.value}
                  value={option.value}
                  className="flex-1"
                >
                  {option.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          {mutation.error ? (
            <div className="flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              <AlertCircle className="size-4 shrink-0" />
              <span>
                {mutation.error instanceof Error
                  ? mutation.error.message
                  : "Failed to start session."}
              </span>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Starting..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
