import { describe, expect, test } from "bun:test";
import { type DockItem, magnify, quietRuns, runWidth } from "./timeline-dock";

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

describe("magnify", () => {
  // Ten tiny versions of 2px, then a reviewed one that never grows.
  const items: DockItem[] = [
    ...Array.from({ length: 10 }, (_, index) => ({ left: index * 2, width: 2, zoom: 12 })),
    { left: 20, width: 30, zoom: 30 },
  ];

  test("grows the versions under the pointer to their zoom, those further off less, and a reviewed one not at all", () => {
    const { widths } = magnify(items, 9);
    expect(widths[4]).toBeGreaterThan(11.9);
    expect(widths[0]).toBeLessThan(widths[3]!);
    expect(widths[0]).toBeGreaterThan(2);
    expect(widths[10]).toBe(30);
  });

  test("moves the strip back by what grew left of the pointer, so the version under it stays there", () => {
    const x = 9;
    const { widths, shift } = magnify(items, x);
    let left = -shift;
    const under = widths.findIndex((width) => {
      const hit = x >= left && x < left + width;
      left += width;
      return hit;
    });
    expect(under).toBe(4);
  });

  test("leaves the strip as it is with the pointer far away", () => {
    const { widths, shift } = magnify(items, 400);
    expect(widths.map((width) => Math.round(width))).toEqual(items.map((item) => item.width));
    expect(shift).toBeLessThan(0.001);
  });
});
