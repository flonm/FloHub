import { describe, expect, test } from "bun:test";
import { CHEERS, cowDue, funFrom, withCheer } from "./fun";
import type { PullState } from "./pull-state";

describe("fun mode", () => {
  test.each<[unknown, boolean]>([
    [undefined, true],
    [true, true],
    [false, false],
    ["false", true],
    [null, true],
  ])("a stored %p means fun mode is %p: only an explicit false turns it off", (stored, on) => {
    expect(funFrom(stored)).toBe(on);
  });

  test("a cheer follows the message, the roll picks which", () => {
    expect(withCheer("Approved #7.", 0)).toBe(`Approved #7. ${CHEERS[0]}`);
    expect(withCheer("Approved #7.", 0.99)).toBe(`Approved #7. ${CHEERS.at(-1)}`);
  });

  test("a roll outside [0, 1) still picks a cheer", () => {
    expect(withCheer("Done.", 1)).toBe(`Done. ${CHEERS.at(-1)}`);
    expect(withCheer("Done.", -1)).toBe(`Done. ${CHEERS[0]}`);
  });

  test.each<[PullState | undefined, PullState | undefined, boolean]>([
    ["open", "merged", true],
    ["draft", "merged", true],
    ["closed", "merged", true],
    [undefined, "merged", false],
    ["merged", "merged", false],
    ["open", "closed", false],
    ["open", undefined, false],
  ])("the merge cow comes from %p to %p: %p, only for a merge the viewer watched", (previous, next, due) => {
    expect(cowDue(previous, next)).toBe(due);
  });
});
