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
import { useTerminalSession } from "@renderer/services/use-terminal-session";
import {
  MODEL_OPTIONS,
  getProjectNameFromPath,
} from "@renderer/services/terminal-session-selectors";
import type { ClaudeModel } from "@shared/claude-types";
import { AlertCircle } from "lucide-react";

export function ProjectDefaultsDialog() {
  const { state, actions } = useTerminalSession();
  const { projectDefaultsDialog } = state;
  const {
    open,
    projectPath,
    defaultModel,
    defaultPermissionMode,
  } = projectDefaultsDialog;

  if (!open || !projectPath) {
    return null;
  }

  const projectName = getProjectNameFromPath(projectPath);
  const effectivePermissionMode = defaultPermissionMode ?? "default";

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          actions.closeProjectDefaultsDialog();
        }
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
            void actions.saveProjectDefaults();
          }}
        >
          <div className="space-y-2">
            <Label>Default model</Label>
            <Select
              value={defaultModel ?? "opus"}
              onValueChange={(value) => {
                actions.updateProjectDefaultsDialog("defaultModel", value as ClaudeModel);
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

          <PermissionModeToggleGroup
            label="Default permission mode"
            permissionMode={effectivePermissionMode}
            onPermissionModeChange={(value) => {
              actions.updateProjectDefaultsDialog("defaultPermissionMode", value);
            }}
          />

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
              onClick={actions.closeProjectDefaultsDialog}
              disabled={state.isSavingProjectDefaults}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={state.isSavingProjectDefaults}>
              {state.isSavingProjectDefaults ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

