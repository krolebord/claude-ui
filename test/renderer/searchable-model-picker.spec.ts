import { describe, expect, it } from "vitest";
import { addRecentModel } from "../../src/renderer/src/components/searchable-model-picker";

describe("addRecentModel", () => {
  it("keeps the three latest unique models", () => {
    expect(addRecentModel(["a", "b", "c", "d"], "b")).toEqual(["b", "a", "c"]);
  });

  it("caps existing history even when the selection is excluded", () => {
    expect(
      addRecentModel(["auto", "a", "a", "b", "c", "d"], "auto", ["auto"]),
    ).toEqual(["a", "b", "c"]);
  });

  it("caps existing history without a new selection", () => {
    expect(addRecentModel(["a", "b", "c", "d"], undefined)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});
