import { describe, expect, test } from "bun:test";
import type { ReviewThread } from "../core/threads";
import { threadPlace } from "./review-thread";

const thread = (overrides: Partial<ReviewThread>): ReviewThread => ({
  id: "PRRT_1",
  path: "a.ts",
  resolved: false,
  outdated: false,
  line: null,
  startLine: null,
  originalLine: null,
  originalStartLine: null,
  side: "RIGHT",
  resolvedBy: null,
  comments: [],
  ...overrides,
});

describe("threadPlace", () => {
  test.each([
    [{ line: 809, originalLine: 800 }, "Comment on line R809"],
    [{ line: 243, startLine: 241 }, "Comment on lines R241 to R243"],
    [{ line: 17, side: "LEFT" as const }, "Comment on line L17"],
    [{ originalLine: 8, outdated: true }, "Comment on line R8"],
    [{ originalLine: 9, originalStartLine: 7, outdated: true }, "Comment on lines R7 to R9"],
    [{}, "Comment on the file"],
  ])("%p reads %p, as GitHub's thread header says it", (overrides, place) => {
    expect(threadPlace(thread(overrides))).toBe(place);
  });
});
