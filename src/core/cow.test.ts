import { describe, expect, test } from "bun:test";
import { type CowTrick, cowDue, lineFor, TRICKS } from "./cow";
import type { PullState } from "./pull-state";

const tricks = Object.keys(TRICKS) as CowTrick[];

describe("the merge cow", () => {
  test.each(tricks)("the roll picks what she says doing %p, from her own lines", (trick) => {
    const lines: readonly string[] = TRICKS[trick].lines;
    expect(lineFor(trick, 0)).toBe(lines[0]!);
    expect(lineFor(trick, 0.999)).toBe(lines.at(-1)!);
  });

  test.each<[PullState | undefined, PullState | undefined, boolean]>([
    ["open", "merged", true],
    ["draft", "merged", true],
    ["closed", "merged", true],
    [undefined, "merged", false],
    ["merged", "merged", false],
    ["open", "closed", false],
    ["open", undefined, false],
  ])("she comes from %p to %p: %p, only for a merge the viewer watched", (previous, next, due) => {
    expect(cowDue(previous, next)).toBe(due);
  });
});
