import { describe, expect, test } from "bun:test";
import { foldedRuns, runPitch, runWidth } from "./timeline-runs";

describe("foldedRuns", () => {
  test("folds runs of three or more versions without a verdict, and leaves shorter ones on their own", () => {
    expect(foldedRuns([true, false, false, false, true, false, false, true])).toEqual([null, 3, 3, 3, null, null, null, null]);
    expect(foldedRuns([false, false, false, false])).toEqual([4, 4, 4, 4]);
    expect(foldedRuns([])).toEqual([]);
  });
});

describe("runWidth", () => {
  test("grows with the logarithm of the run's length, so a long run stays small but wider than a short one", () => {
    expect([3, 7, 15, 31, 63].map((length) => runWidth(length))).toEqual([14, 20, 26, 31, 36]);
  });
});

describe("runPitch", () => {
  test("draws a hairline per version while they fit, then packs them two pixels apart", () => {
    expect(runPitch(3)).toBeCloseTo(14 / 3);
    expect(runPitch(7)).toBeCloseTo(20 / 7);
    expect(runPitch(40)).toBe(2);
  });
});
