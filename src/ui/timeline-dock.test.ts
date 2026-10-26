import { describe, expect, test } from "bun:test";
import { type DockItem, expand, quietRuns, runWidth } from "./timeline-dock";

describe("quietRuns", () => {
  test("gives every version outside the notable ones the length of its run", () => {
    expect(quietRuns([true, false, false, false, true, false, true])).toEqual([null, 3, 3, 3, null, 1, null]);
    expect(quietRuns([false, false])).toEqual([2, 2]);
    expect(quietRuns([])).toEqual([]);
  });
});

describe("runWidth", () => {
  test("keeps a long run as small as a short one, and grows a little with its length", () => {
    expect([1, 2, 3, 5, 7, 40].map((length) => runWidth(length))).toEqual([6, 10, 20, 24, 28, 28]);
  });
});

describe("expand", () => {
  // The base at 10px, then ten tiny versions of 2px, then a reviewed one of 30px.
  const items: DockItem[] = [
    { left: 0, width: 10, fixed: false },
    ...Array.from({ length: 10 }, (_, index) => ({ left: 10 + index * 2, width: 2, fixed: false })),
    { left: 30, width: 30, fixed: true },
  ];
  const plenty = { before: 500, after: 500 };

  test("gives every version a 14px target at once, and a reviewed slot keeps its width", () => {
    const { widths } = expand(items, 15, plenty);
    expect(widths).toEqual([14, ...Array.from({ length: 10 }, () => 14), 30]);
  });

  test("moves the strip so the version under the pointer, at the same point on it, stays under the pointer", () => {
    // 15 is the middle of the third tiny version (index 3, 14 to 16 at rest).
    const { widths, shift } = expand(items, 15, plenty);
    const left = widths.slice(0, 3).reduce((sum, width) => sum + width, 0) - shift;
    expect(15 - left).toBeCloseTo(7);
  });

  test("stays inside the view: no further left than its start allows, nor further right than its end does", () => {
    expect(expand(items, 59, { before: 20, after: 500 }).shift).toBe(20);
    // Open, the strip is 184px against 60px at rest; with no room after it, it moves left by all it grew.
    expect(expand(items, 1, { before: 500, after: 0 }).shift).toBe(124);
  });

  test("holds still: the same pointer gives the same strip, so nothing moves while aiming", () => {
    expect(expand(items, 15, plenty)).toEqual(expand(items, 15, plenty));
  });
});
