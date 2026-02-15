import { Label } from "@renderer/components/ui/label";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@renderer/components/ui/toggle-group";
import type { ClaudeEffort } from "@shared/claude-types";

interface EffortToggleGroupProps {
  label: string;
  effort: ClaudeEffort | undefined;
  onEffortChange: (value: ClaudeEffort | undefined) => void;
}

const EFFORT_OPTIONS: { value: ClaudeEffort; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export function EffortToggleGroup({
  label,
  effort,
  onEffortChange,
}: EffortToggleGroupProps) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <ToggleGroup
        type="single"
        variant="outline"
        value={effort ?? ""}
        onValueChange={(value) => {
          onEffortChange((value as ClaudeEffort) || undefined);
        }}
        className="w-full"
      >
        {EFFORT_OPTIONS.map((option) => (
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
  );
}
