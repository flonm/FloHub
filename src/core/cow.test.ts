import { describe, expect, test } from "bun:test";
import { cowDue, lineFor, pickTrick, TRICK_NAMES, TRICKS } from "./cow";
import type { PullState } from "./pull-state";

const tricks = TRICK_NAMES;

describe("the merge cow", () => {
  test.each(tricks)("the roll picks what she says doing %p, from her own lines", (trick) => {
    const lines: readonly string[] = TRICKS[trick].lines;
    expect(lineFor(trick, 0)).toBe(lines[0]!);
    expect(lineFor(trick, 0.999)).toBe(lines.at(-1)!);
  });

  test("a random pick can land on every trick", () => {
    const picked = new Set(Array.from({ length: 1000 }, (_, index) => pickTrick(undefined, index / 1000)));
    expect(new Set(tricks)).toEqual(picked);
  });

  test.each(tricks)("a random pick never repeats %p, whatever the roll", (previous) => {
    for (let roll = 0; roll < 1; roll += 0.01) expect(pickTrick(previous, roll)).not.toBe(previous);
  });

  test("a roll outside [0, 1) still picks a trick", () => {
    expect(tricks).toContain(pickTrick("walk", 1));
    expect(tricks).toContain(pickTrick("walk", -1));
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
