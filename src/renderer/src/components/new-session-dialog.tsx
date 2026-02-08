import { Button } from "@renderer/components/ui/button";
import { Checkbox } from "@renderer/components/ui/checkbox";
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
import type { ClaudeModel } from "@shared/claude-types";

interface NewSessionDialogProps {
  open: boolean;
  projectPath: string | null;
  initialPrompt: string;
  sessionName: string;
  model: ClaudeModel;
  dangerouslySkipPermissions: boolean;
  isStarting: boolean;
  onInitialPromptChange: (value: string) => void;
  onSessionNameChange: (value: string) => void;
  onModelChange: (value: ClaudeModel) => void;
  onDangerouslySkipPermissionsChange: (value: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
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

export function NewSessionDialog({
  open,
  projectPath,
  initialPrompt,
  sessionName,
  model,
  dangerouslySkipPermissions,
  isStarting,
  onInitialPromptChange,
  onSessionNameChange,
  onModelChange,
  onDangerouslySkipPermissionsChange,
  onCancel,
  onConfirm,
}: NewSessionDialogProps) {
  if (!open || !projectPath) {
    return null;
  }

  const projectName = getProjectNameFromPath(projectPath);

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel();
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
            onConfirm();
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
                  onConfirm();
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

          <div className="flex items-center gap-2">
            <Checkbox
              id="new-session-dangerously-skip-permissions"
              checked={dangerouslySkipPermissions}
              onCheckedChange={(checked) =>
                onDangerouslySkipPermissionsChange(checked === true)
              }
            />
            <Label
              htmlFor="new-session-dangerously-skip-permissions"
              className="cursor-pointer"
            >
              Create with --dangerously-skip-permissions
            </Label>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={isStarting}>
              {isStarting ? "Starting..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
