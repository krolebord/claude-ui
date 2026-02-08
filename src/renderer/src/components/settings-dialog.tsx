import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Kbd, KbdGroup } from "@renderer/components/ui/kbd";
import { SHORTCUT_DEFINITIONS } from "@renderer/hooks/use-keyboard-shortcuts";
import { claudeIpc } from "@renderer/lib/ipc";
import { FolderOpen, Keyboard } from "lucide-react";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Application settings</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-white/10 px-4 py-3">
            <div className="space-y-0.5">
              <div className="text-sm font-medium">Log files</div>
              <div className="text-xs text-muted-foreground">
                Open the folder containing application logs
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void claudeIpc.openLogFolder();
              }}
            >
              <FolderOpen className="mr-1.5 size-3.5" />
              Open
            </Button>
          </div>

          <div className="rounded-lg border border-white/10 px-4 py-3">
            <div className="mb-3 flex items-center gap-2">
              <Keyboard className="size-4 text-muted-foreground" />
              <div className="text-sm font-medium">Keyboard shortcuts</div>
            </div>
            <div className="space-y-2">
              {SHORTCUT_DEFINITIONS.map((shortcut) => (
                <div
                  key={shortcut.id}
                  className="flex items-center justify-between"
                >
                  <span className="text-xs text-muted-foreground">
                    {shortcut.label}
                  </span>
                  <KbdGroup>
                    <Kbd>&#8984;</Kbd>
                    <Kbd>{shortcut.key}</Kbd>
                  </KbdGroup>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
