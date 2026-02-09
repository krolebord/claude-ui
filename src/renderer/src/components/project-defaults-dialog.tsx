import { useMutation } from "@tanstack/react-query";
import { PermissionModeToggleGroup } from "@renderer/components/permission-mode-toggle-group";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Label } from "@renderer/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import { claudeIpc } from "@renderer/lib/ipc";
import type {
  ClaudeModel,
  ClaudePermissionMode,
  ClaudeSessionsSnapshot,
} from "@shared/claude-types";
import { AlertCircle } from "lucide-react";

interface ProjectDefaultsDialogProps {
  open: boolean;
  projectPath: string | null;
  defaultModel: ClaudeModel | undefined;
  defaultPermissionMode: ClaudePermissionMode | undefined;
  onDefaultModelChange: (value: ClaudeModel | undefined) => void;
  onDefaultPermissionModeChange: (
    value: ClaudePermissionMode | undefined,
  ) => void;
  onCancel: () => void;
  onSaved: (snapshot: ClaudeSessionsSnapshot) => void;
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

export function ProjectDefaultsDialog({
  open,
  projectPath,
  defaultModel,
  defaultPermissionMode,
  onDefaultModelChange,
  onDefaultPermissionModeChange,
  onCancel,
  onSaved,
}: ProjectDefaultsDialogProps) {
  const mutation = useMutation({
    mutationFn: claudeIpc.setClaudeProjectDefaults,
    onSuccess: (snapshot) => {
      onSaved(snapshot);
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
  const effectivePermissionMode = defaultPermissionMode ?? "default";

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) handleCancel();
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Project defaults</DialogTitle>
          <DialogDescription>
            Set default session options for{" "}
            <span className="text-foreground">{projectName}</span>
            <br />
            <span className="text-xs text-muted-foreground">{projectPath}</span>
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate({
              path: projectPath,
              defaultModel,
              defaultPermissionMode,
            });
          }}
        >
          <div className="space-y-2">
            <Label>Default model</Label>
            <Select
              value={defaultModel ?? "opus"}
              onValueChange={(value) =>
                onDefaultModelChange(value as ClaudeModel)
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

          <PermissionModeToggleGroup
            label="Default permission mode"
            permissionMode={effectivePermissionMode}
            onPermissionModeChange={(value) => {
              onDefaultPermissionModeChange(value);
            }}
          />

          {mutation.error ? (
            <div className="flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              <AlertCircle className="size-4 shrink-0" />
              <span>
                {mutation.error instanceof Error
                  ? mutation.error.message
                  : "Failed to save project defaults."}
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
              {mutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
