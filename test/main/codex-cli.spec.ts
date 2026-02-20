import { describe, expect, it } from "vitest";
import { buildCodexArgs } from "../../src/main/codex-cli";

describe("buildCodexArgs", () => {
  it("defaults model reasoning effort to high", () => {
    const { args } = buildCodexArgs({
      permissionMode: "default",
    });

    expect(args).toEqual([
      "--no-alt-screen",
      "--model",
      "gpt-5.3-codex",
      "-c",
      "model_reasoning_effort=high",
    ]);
  });

  it("uses provided model reasoning effort", () => {
    const { args } = buildCodexArgs({
      permissionMode: "default",
      modelReasoningEffort: "minimal",
    });

    expect(args).toContain("-c");
    expect(args).toContain("model_reasoning_effort=minimal");
  });
});
