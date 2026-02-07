import { Input } from "@renderer/components/ui/input";
import { cn } from "@renderer/lib/utils";
import type { ClaudeModel } from "@shared/claude-types";
import { useEffect } from "react";

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
  useEffect(() => {
    if (!open) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [onCancel, open]);

  if (!open || !projectPath) {
    return null;
  }

  const projectName = getProjectNameFromPath(projectPath);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onMouseDown={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Create new session"
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
        className="w-full max-w-md rounded-xl border border-white/10 bg-[#111418] p-5 shadow-2xl"
      >
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-zinc-100">Start new session</h2>
          <p className="text-sm text-zinc-400">
            Project: <span className="text-zinc-200">{projectName}</span>
          </p>
          <p className="text-xs text-zinc-500">{projectPath}</p>
        </div>

        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm();
          }}
        >
          <div className="space-y-2">
            <label htmlFor="new-session-initial-prompt" className="text-sm text-zinc-300">
              Initial prompt (optional)
            </label>
            <textarea
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
              className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-white/30"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="new-session-name" className="text-sm text-zinc-300">
              Session name (optional)
            </label>
            <Input
              id="new-session-name"
              placeholder="Leave blank for generated name"
              value={sessionName}
              onChange={(event) => {
                onSessionNameChange(event.target.value);
              }}
              className="border-white/15 bg-white/5 text-zinc-100 placeholder:text-zinc-500"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="new-session-model" className="text-sm text-zinc-300">
              Model
            </label>
            <select
              id="new-session-model"
              value={model}
              onChange={(event) => {
                onModelChange(event.target.value as ClaudeModel);
              }}
              className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-zinc-100"
            >
              {MODEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <label
            htmlFor="new-session-dangerously-skip-permissions"
            className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300"
          >
            <input
              id="new-session-dangerously-skip-permissions"
              type="checkbox"
              checked={dangerouslySkipPermissions}
              onChange={(event) => {
                onDangerouslySkipPermissionsChange(event.target.checked);
              }}
              className="size-4 rounded border-white/20 bg-white/5 accent-white"
            />
            <span>Create with --dangerously-skip-permissions</span>
          </label>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-white/15 px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isStarting}
              className={cn(
                "rounded-md bg-white px-3 py-1.5 text-sm font-medium text-black transition",
                "hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60",
              )}
            >
              {isStarting ? "Starting..." : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
