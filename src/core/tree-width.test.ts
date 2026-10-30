import { describe, expect, test } from "bun:test";
import { clampTreeWidth, MIN_TREE_WIDTH, TREE_WIDTH, treeWidthForKey } from "./tree-width";

describe("clampTreeWidth", () => {
  test.each([
    [300, 1200, 300],
    [100, 1200, MIN_TREE_WIDTH],
    [900, 1200, 720],
    [250.6, 1200, 251],
  ])("keeps %p within its limits in a %ppx view: %p", (width, available, expected) => {
    expect(clampTreeWidth(width, available)).toBe(expected);
  });

  test("never goes below the narrowest, even in a view too narrow for the share", () => {
    expect(clampTreeWidth(400, 200)).toBe(MIN_TREE_WIDTH);
  });
});

describe("treeWidthForKey", () => {
  test.each([
    ["ArrowLeft", 284],
    ["ArrowRight", 316],
    ["Home", MIN_TREE_WIDTH],
    ["End", 720],
    ["Enter", TREE_WIDTH],
  ])("%s moves the edge", (key, expected) => {
    expect(treeWidthForKey(key, 300, 1200)).toBe(expected);
  });

  test("an arrow stops at the limits", () => {
    expect(treeWidthForKey("ArrowLeft", MIN_TREE_WIDTH, 1200)).toBe(MIN_TREE_WIDTH);
    expect(treeWidthForKey("ArrowRight", 720, 1200)).toBe(720);
  });

  test("other keys don't resize", () => {
    expect(treeWidthForKey("a", 300, 1200)).toBeNull();
  });
});
