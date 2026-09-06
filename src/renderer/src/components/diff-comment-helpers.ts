import type { AnnotationSide, DiffLineAnnotation } from "@pierre/diffs/react";

export type DiffReviewCommentDraft = {
  filePath: string;
  side: AnnotationSide;
  lineNumber: number;
  body: string;
  commitHash?: string;
};

export type DiffReviewAnnotationMetadata = {
  type: "draft";
};

export function formatReviewComment(comment: DiffReviewCommentDraft) {
  const sideLabel = comment.side === "additions" ? "New" : "Old";
  const commitLabel = comment.commitHash
    ? `, commit ${comment.commitHash.slice(0, 7)}`
    : "";
  return `- ${comment.filePath} (${sideLabel} line ${comment.lineNumber}${commitLabel})\n${comment.body}`;
}

export function formatReviewCommentForTerminal(
  comment: DiffReviewCommentDraft,
) {
  return `\n${formatReviewComment(comment)}`;
}

export function getCommentDraftLineAnnotations(
  draft: DiffReviewCommentDraft | null,
  filePath: string,
  commitHash?: string,
): DiffLineAnnotation<DiffReviewAnnotationMetadata>[] {
  if (
    !draft ||
    draft.filePath !== filePath ||
    draft.commitHash !== commitHash
  ) {
    return [];
  }
  return [
    {
      side: draft.side,
      lineNumber: draft.lineNumber,
      metadata: { type: "draft" },
    },
  ];
}
