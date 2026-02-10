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
import { useTerminalSession } from "@renderer/services/use-terminal-session";
import {
  MODEL_OPTIONS,
  getProjectNameFromPath,
} from "@renderer/services/terminal-session-selectors";
import type { ClaudeModel } from "@shared/claude-types";
import { AlertCircle } from "lucide-react";
import { useLocation } from "wouter";

export function NewSessionDialog() {
  const { state, actions } = useTerminalSession();
  const [, navigate] = useLocation();
  const { newSessionDialog } = state;
  const {
    open,
    projectPath,
    initialPrompt,
    sessionName,
    model,
    permissionMode,
  } = newSessionDialog;

  if (!open || !projectPath) {
    return null;
  }

  const projectName = getProjectNameFromPath(projectPath);

  const handleSubmit = () => {
    void actions.startNewSession().then((nextSessionId) => {
      if (nextSessionId) {
        navigate(`/session/${nextSessionId}`);
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          actions.closeNewSessionDialog();
        }
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
                actions.updateNewSessionDialog("initialPrompt", event.target.value);
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

          <PermissionModeToggleGroup
            label="Permission mode"
            permissionMode={permissionMode}
            onPermissionModeChange={(value) => {
              actions.updateNewSessionDialog("permissionMode", value);
            }}
          />

          <div className="space-y-2">
            <Label htmlFor="new-session-name">Session name (optional)</Label>
            <Input
              id="new-session-name"
              placeholder="Leave blank for generated name"
              value={sessionName}
              onChange={(event) => {
                actions.updateNewSessionDialog("sessionName", event.target.value);
              }}
            />
          </div>

          <div className="space-y-2">
            <Label>Model</Label>
            <Select
              value={model}
              onValueChange={(value) => {
                actions.updateNewSessionDialog("model", value as ClaudeModel);
              }}
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

          {state.errorMessage ? (
            <div className="flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              <AlertCircle className="size-4 shrink-0" />
              <span>{state.errorMessage}</span>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={actions.closeNewSessionDialog}
              disabled={state.isStarting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={state.isStarting}>
              {state.isStarting ? "Starting..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

