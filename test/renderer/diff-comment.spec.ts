import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  sessionAcceptsInput,
  useDiffCommentStore,
} from "../../src/renderer/src/components/diff-comment";
import {
  type DiffReviewCommentDraft,
  formatReviewComment,
  getCommentDraftLineAnnotations,
} from "../../src/renderer/src/components/diff-comment-helpers";

vi.mock("@renderer/orpc-client", () => ({ orpc: {} }));
vi.mock("@renderer/lib/autofocus", () => ({ shouldAutoFocus: () => false }));

describe("sessionAcceptsInput", () => {
  it.each([undefined, "starting", "stopping", "stopped", "error"])(
    "disables Add when the session status is %s",
    (status) => {
      expect(sessionAcceptsInput(status)).toBe(false);
    },
  );

  it.each(["idle", "running", "awaiting_user_response", "awaiting_approval"])(
    "enables Add when the session status is %s",
    (status) => {
      expect(sessionAcceptsInput(status)).toBe(true);
    },
  );
});

describe("comment submission completion", () => {
  const projectPath = "/project";
  const store = useDiffCommentStore;
  const startDraft = () => {
    store.getState().startCommentDraft({
      projectPath,
      filePath: "src/app.ts",
      side: "additions",
      lineNumber: 12,
    });
    store.getState().updateCommentDraft(projectPath, "looks wrong");
    const submitted = store.getState().commentDraftByProject[projectPath];
    if (!submitted) throw new Error("Expected a draft");
    return submitted;
  };

  beforeEach(() => {
    store.setState({ commentDraftByProject: {} });
  });

  it("clears the unchanged submitted draft", () => {
    const submitted = startDraft();
    store.getState().completeCommentDraft(projectPath, submitted);
    expect(store.getState().commentDraftByProject[projectPath]).toBeNull();
  });

  it("preserves edits made while a submission is pending", () => {
    const submitted = startDraft();
    store.getState().updateCommentDraft(projectPath, "updated feedback");
    store.getState().completeCommentDraft(projectPath, submitted);
    expect(store.getState().commentDraftByProject[projectPath]?.body).toBe(
      "updated feedback",
    );
  });

  it("preserves a replacement draft even at the same location with identical text", () => {
    const submitted = startDraft();
    store.getState().cancelCommentDraft(projectPath);
    const replacement = startDraft();
    store.getState().completeCommentDraft(projectPath, submitted);
    expect(store.getState().commentDraftByProject[projectPath]).toBe(
      replacement,
    );
  });

  it("does not clear another project's draft", () => {
    const submitted = startDraft();
    store.getState().startCommentDraft({
      projectPath: "/other-project",
      filePath: "src/app.ts",
      side: "additions",
      lineNumber: 12,
    });
    const otherDraft = store.getState().commentDraftByProject["/other-project"];
    store.getState().completeCommentDraft(projectPath, submitted);
    expect(store.getState().commentDraftByProject["/other-project"]).toBe(
      otherDraft,
    );
  });
});

function draft(
  override: Partial<DiffReviewCommentDraft> = {},
): DiffReviewCommentDraft {
  return {
    filePath: "src/app.ts",
    side: "additions",
    lineNumber: 12,
    body: "looks wrong",
    ...override,
  };
}

describe("formatReviewComment", () => {
  it("formats an uncommitted line comment", () => {
    expect(formatReviewComment(draft())).toBe(
      "- src/app.ts (New line 12)\nlooks wrong",
    );
  });

  it("includes the short commit hash for history comments", () => {
    expect(
      formatReviewComment(
        draft({
          side: "deletions",
          commitHash: "abcdef1234567890",
        }),
      ),
    ).toBe("- src/app.ts (Old line 12, commit abcdef1)\nlooks wrong");
  });
});

describe("getCommentDraftLineAnnotations", () => {
  it("returns the draft annotation for the matching uncommitted file", () => {
    expect(getCommentDraftLineAnnotations(draft(), "src/app.ts")).toEqual([
      {
        side: "additions",
        lineNumber: 12,
        metadata: { type: "draft" },
      },
    ]);
  });

  it("hides an uncommitted draft on a history commit", () => {
    expect(
      getCommentDraftLineAnnotations(draft(), "src/app.ts", "abcdef1"),
    ).toEqual([]);
  });

  it("returns the draft annotation for the matching commit file", () => {
    const historyDraft = draft({ commitHash: "abcdef1234567890" });
    expect(
      getCommentDraftLineAnnotations(
        historyDraft,
        "src/app.ts",
        "abcdef1234567890",
      ),
    ).toEqual([
      {
        side: "additions",
        lineNumber: 12,
        metadata: { type: "draft" },
      },
    ]);
  });

  it("hides a history draft on a different commit or file", () => {
    const historyDraft = draft({ commitHash: "abcdef1234567890" });
    expect(
      getCommentDraftLineAnnotations(historyDraft, "src/app.ts", "otherhash"),
    ).toEqual([]);
    expect(
      getCommentDraftLineAnnotations(
        historyDraft,
        "src/other.ts",
        "abcdef1234567890",
      ),
    ).toEqual([]);
  });
});
