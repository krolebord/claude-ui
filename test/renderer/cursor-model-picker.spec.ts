import { cursorModelFamilies } from "@shared/cursor-models";
import { describe, expect, it } from "vitest";
import { filterCursorModels } from "../../src/renderer/src/components/cursor-model-picker";

const models = cursorModelFamilies.flatMap((family) => family.variants);

describe("filterCursorModels", () => {
  it("matches family and variant terms regardless of case or order", () => {
    const results = filterCursorModels(models, " THINKING   Fable 5.1 High ");
    expect(results.length).toBeGreaterThan(0);
    expect(
      results.every(
        (model) =>
          model.value.startsWith("claude-fable-5-1-thinking-") &&
          model.value.includes("high"),
      ),
    ).toBe(true);
  });

  it("finds a model by its exact CLI ID", () => {
    expect(
      filterCursorModels(models, "composer-2.5-fast").map(
        (model) => model.value,
      ),
    ).toEqual(["composer-2.5-fast"]);
  });

  it("restores every model for whitespace and returns no unrelated matches", () => {
    expect(filterCursorModels(models, "   ")).toEqual(models);
    expect(filterCursorModels(models, "nonexistent-model")).toEqual([]);
  });
});
