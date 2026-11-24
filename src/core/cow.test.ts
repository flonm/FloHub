import { describe, expect, test } from "bun:test";
import { type CowSetting, type CowTrick, cowDue, lineFor, pickTrick, TRICK_NAMES, trickSettingFrom, TRICKS } from "./cow";
import type { PullState } from "./pull-state";

const tricks = TRICK_NAMES;

describe("the merge cow", () => {
  test.each(tricks)("the roll picks what she says doing %p, from her own lines", (trick) => {
    const lines: readonly string[] = TRICKS[trick].lines;
    expect(lineFor(trick, 0)).toBe(lines[0]!);
    expect(lineFor(trick, 0.999)).toBe(lines.at(-1)!);
  });

  test.each<[unknown, CowSetting]>([
    [undefined, "random"],
    ["random", "random"],
    ["backwards", "backwards"],
    ["moonwalk", "random"],
    ["toString", "random"],
    [3, "random"],
    [null, "random"],
  ])("a stored %p means %p: anything but a trick she knows lets her pick at random", (stored, setting) => {
    expect(trickSettingFrom(stored)).toBe(setting);
  });

  test("a trick the viewer picked is what she performs, every time, even the one she did last", () => {
    expect(pickTrick("fence", "fence", 0)).toBe("fence");
    expect(pickTrick("fence", undefined, 0.99)).toBe("fence");
  });

  test("a random pick can land on every trick", () => {
    const picked = new Set(Array.from({ length: 1000 }, (_, index) => pickTrick("random", undefined, index / 1000)));
    expect(new Set(tricks)).toEqual(picked);
  });

  test.each(tricks)("a random pick never repeats %p, whatever the roll", (previous) => {
    for (let roll = 0; roll < 1; roll += 0.01) expect(pickTrick("random", previous, roll)).not.toBe(previous);
  });

  test("the UFO comes for her about a third as often as any other trick", () => {
    const picks = Array.from({ length: 10_000 }, (_, index) => pickTrick("random", undefined, index / 10_000));
    const count = (trick: CowTrick): number => picks.filter((picked) => picked === trick).length;
    expect(count("abduction") / count("walk")).toBeCloseTo(0.35, 2);
  });

  test("a roll outside [0, 1) still picks a trick", () => {
    expect(tricks).toContain(pickTrick("random", "walk", 1));
    expect(tricks).toContain(pickTrick("random", "walk", -1));
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
