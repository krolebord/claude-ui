import type { AnnotationSide, DiffLineAnnotation } from "@pierre/diffs/react";
import { useAppState } from "@renderer/components/sync-state-provider";
import { useActiveSessionId } from "@renderer/hooks/use-active-session-id";
import { useCopyToClipboard } from "@renderer/hooks/use-copy-to-clipboard";
import { shouldAutoFocus } from "@renderer/lib/autofocus";
import { cn } from "@renderer/lib/utils";
import { orpc } from "@renderer/orpc-client";
import { Check, Copy, MessageSquarePlus } from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { create } from "zustand";
import { combine } from "zustand/middleware";
import {
  type DiffReviewAnnotationMetadata,
  type DiffReviewCommentDraft,
  formatReviewComment,
  formatReviewCommentForTerminal,
} from "./diff-comment-helpers";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

export type {
  DiffReviewAnnotationMetadata,
  DiffReviewCommentDraft,
} from "./diff-comment-helpers";
export {
  formatReviewComment,
  formatReviewCommentForTerminal,
  getCommentDraftLineAnnotations,
} from "./diff-comment-helpers";

export function sessionAcceptsInput(status: string | undefined) {
  return (
    status === "idle" ||
    status === "running" ||
    status === "awaiting_user_response" ||
    status === "awaiting_approval"
  );
}

export const useDiffCommentStore = create(
  combine(
    {
      commentDraftByProject: {} as Record<
        string,
        DiffReviewCommentDraft | null
      >,
    },
    (set, get) => ({
      startCommentDraft: ({
        projectPath,
        filePath,
        side,
        lineNumber,
        commitHash,
      }: {
        projectPath: string;
        filePath: string;
        side: AnnotationSide;
        lineNumber: number;
        commitHash?: string;
      }) => {
        const current = get().commentDraftByProject[projectPath];
        set((state) => ({
          commentDraftByProject: {
            ...state.commentDraftByProject,
            [projectPath]:
              current &&
              current.filePath === filePath &&
              current.side === side &&
              current.lineNumber === lineNumber &&
              current.commitHash === commitHash
                ? current
                : commitHash
                  ? { filePath, side, lineNumber, body: "", commitHash }
                  : { filePath, side, lineNumber, body: "" },
          },
        }));
      },
      updateCommentDraft: (projectPath: string, body: string) => {
        set((state) => {
          const draft = state.commentDraftByProject[projectPath];
          return {
            commentDraftByProject: {
              ...state.commentDraftByProject,
              [projectPath]: draft ? { ...draft, body } : draft,
            },
          };
        });
      },
      cancelCommentDraft: (projectPath: string) => {
        set((state) => ({
          commentDraftByProject: {
            ...state.commentDraftByProject,
            [projectPath]: null,
          },
        }));
      },
      completeCommentDraft: (
        projectPath: string,
        submittedDraft: DiffReviewCommentDraft,
      ) => {
        set((state) => {
          if (state.commentDraftByProject[projectPath] !== submittedDraft) {
            return state;
          }
          return {
            commentDraftByProject: {
              ...state.commentDraftByProject,
              [projectPath]: null,
            },
          };
        });
      },
      applyEditedAnnotationPositions: (
        projectPath: string,
        filePath: string,
        annotations: DiffLineAnnotation<DiffReviewAnnotationMetadata>[],
      ) => {
        const draftPosition = annotations.find(
          (annotation) => annotation.metadata.type === "draft",
        );
        set((state) => {
          const commentDraft = state.commentDraftByProject[projectPath];
          return {
            commentDraftByProject: {
              ...state.commentDraftByProject,
              [projectPath]:
                commentDraft?.filePath === filePath &&
                !commentDraft.commitHash &&
                draftPosition
                  ? {
                      ...commentDraft,
                      side: draftPosition.side,
                      lineNumber: draftPosition.lineNumber,
                    }
                  : commentDraft,
            },
          };
        });
      },
    }),
  ),
);

export function CommentDraftForm({
  body,
  onBodyChange,
  onCancel,
  onAdded,
  filePath,
  side,
  lineNumber,
  commitHash,
}: {
  body: string;
  onBodyChange: (body: string) => void;
  onCancel: () => void;
  onAdded: () => void;
  filePath: string;
  side: AnnotationSide;
  lineNumber: number;
  commitHash?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const initialSelectionEndRef = useRef(body.length);
  const addingRef = useRef(false);
  const { copied, copy } = useCopyToClipboard();
  const trimmedBody = body.trim();
  const formattedComment = formatReviewComment({
    filePath,
    side,
    lineNumber,
    body: trimmedBody,
    commitHash,
  });
  const sessionId = useActiveSessionId();
  const sessionStatus = useAppState((state) =>
    sessionId ? state.sessions[sessionId]?.status : undefined,
  );
  const canWriteToSession =
    sessionId != null && sessionAcceptsInput(sessionStatus);

  useEffect(() => {
    if (!shouldAutoFocus()) {
      return;
    }
    const handle = window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(
        initialSelectionEndRef.current,
        initialSelectionEndRef.current,
      );
    });
    return () => window.cancelAnimationFrame(handle);
  }, []);

  const addToTerminal = () => {
    if (!trimmedBody || !sessionId || !canWriteToSession || addingRef.current) {
      return;
    }
    addingRef.current = true;
    void orpc.terminals.writeToTerminal
      .call({
        terminalId: sessionId,
        data: `\x1b[200~${formatReviewCommentForTerminal({
          filePath,
          side,
          lineNumber,
          body: trimmedBody,
          commitHash,
        })}\x1b[201~`,
      })
      .then(() => {
        onAdded();
      })
      .catch((error) => {
        toast.error(
          error instanceof Error ? error.message : "Failed to add comment",
        );
      })
      .finally(() => {
        addingRef.current = false;
      });
  };

  return (
    <form
      className="mx-2 my-1 max-w-3xl rounded-md border border-sky-500/40 bg-zinc-950/95 p-2 shadow-lg"
      onSubmit={(event) => {
        event.preventDefault();
        addToTerminal();
      }}
    >
      <Textarea
        ref={textareaRef}
        value={body}
        onChange={(event) => onBodyChange(event.currentTarget.value)}
        placeholder="Leave a comment"
        className="min-h-20 resize-y border-zinc-700 bg-zinc-900/80 text-xs"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
            return;
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            addToTerminal();
          }
        }}
      />
      <div className="mt-2 flex justify-end gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 px-2 text-xs",
            copied && "text-emerald-400 hover:text-emerald-300",
          )}
          disabled={!trimmedBody}
          onClick={() => {
            void copy(formattedComment);
          }}
        >
          {copied ? (
            <>
              <Check className="size-3" />
              Copied
            </>
          ) : (
            <>
              <Copy className="size-3" />
              Copy
            </>
          )}
        </Button>
        <Button
          type="submit"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={!trimmedBody || !canWriteToSession}
          title={canWriteToSession ? undefined : "Session isn't ready"}
        >
          Add
        </Button>
      </div>
    </form>
  );
}

export function DiffCommentAnnotation({
  projectPath,
}: {
  projectPath: string;
}) {
  const draft = useDiffCommentStore(
    (state) => state.commentDraftByProject[projectPath] ?? null,
  );
  const updateCommentDraft = useDiffCommentStore(
    (state) => state.updateCommentDraft,
  );
  const cancelCommentDraft = useDiffCommentStore(
    (state) => state.cancelCommentDraft,
  );
  const completeCommentDraft = useDiffCommentStore(
    (state) => state.completeCommentDraft,
  );

  if (!draft) return null;

  return (
    <CommentDraftForm
      body={draft.body}
      onBodyChange={(body) => updateCommentDraft(projectPath, body)}
      onCancel={() => cancelCommentDraft(projectPath)}
      onAdded={() => completeCommentDraft(projectPath, draft)}
      filePath={draft.filePath}
      side={draft.side}
      lineNumber={draft.lineNumber}
      commitHash={draft.commitHash}
    />
  );
}

export function AddCommentGutterButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="relative z-20 ml-6 flex size-5 items-center justify-center rounded-sm border border-sky-300/70 bg-sky-600 text-white shadow-lg ring-1 ring-black/70 hover:bg-sky-500"
      aria-label="Add comment"
      title="Add comment"
      onClick={onClick}
    >
      <MessageSquarePlus className="size-3" />
    </button>
  );
}
