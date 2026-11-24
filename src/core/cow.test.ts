import { describe, expect, test } from "bun:test";
import { type CowCue, type CowSetting, type CowTrick, cowCue, type CowWatch, lineFor, pickTrick, TRICK_NAMES, trickSettingFrom, TRICKS } from "./cow";

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

  const open = { state: "open", inMergeQueue: false } as const;
  const queued = { state: "open", inMergeQueue: true } as const;
  const merged = { state: "merged", inMergeQueue: false } as const;

  test.each<[string, CowWatch | undefined, CowWatch | undefined, CowCue | null]>([
    ["an open one gets merged", open, merged, "merged"],
    ["a draft gets merged", { state: "draft", inMergeQueue: false }, merged, "merged"],
    ["a closed one gets merged", { state: "closed", inMergeQueue: false }, merged, "merged"],
    ["a queued one gets merged", queued, merged, "merged"],
    ["an open one joins the merge queue", open, queued, "queued"],
    ["a merged one is opened", undefined, merged, null],
    ["a queued one is opened", undefined, queued, null],
    ["a merged one stays merged", merged, merged, null],
    ["a queued one stays queued", queued, queued, null],
    ["a queued one leaves the queue", queued, open, null],
    ["an open one gets closed", open, { state: "closed", inMergeQueue: false }, null],
    ["the pull request goes away", open, undefined, null],
  ])("she comes when %s: %p → %p is %p, only for news the viewer watched", (_, previous, next, cue) => {
    expect(cowCue(previous, next)).toBe(cue);
  });
});
