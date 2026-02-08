import { Label } from "@renderer/components/ui/label";
import { Kbd } from "@renderer/components/ui/kbd";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@renderer/components/ui/toggle-group";
import type { ClaudePermissionMode } from "@shared/claude-types";
import { useEffect } from "react";

interface PermissionModeToggleGroupProps {
  label: string;
  permissionMode: ClaudePermissionMode;
  onPermissionModeChange: (value: ClaudePermissionMode) => void;
}

const PERMISSION_MODES: { value: ClaudePermissionMode; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "acceptEdits", label: "Accept edits" },
  { value: "plan", label: "Plan" },
  { value: "yolo", label: "Yolo" },
];

function cyclePermissionMode(
  current: ClaudePermissionMode,
): ClaudePermissionMode {
  const index = PERMISSION_MODES.findIndex((mode) => mode.value === current);
  return PERMISSION_MODES[(index + 1) % PERMISSION_MODES.length].value;
}

export function PermissionModeToggleGroup({
  label,
  permissionMode,
  onPermissionModeChange,
}: PermissionModeToggleGroupProps) {
  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "Tab" ||
        !event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      onPermissionModeChange(cyclePermissionMode(permissionMode));
    };

    window.addEventListener("keydown", onWindowKeyDown, { capture: true });

    return () => {
      window.removeEventListener("keydown", onWindowKeyDown, {
        capture: true,
      });
    };
  }, [onPermissionModeChange, permissionMode]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Kbd>Shift</Kbd>
          <span>+</span>
          <Kbd>Tab</Kbd>
        </span>
      </div>
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
          <ToggleGroupItem key={option.value} value={option.value} className="flex-1">
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
