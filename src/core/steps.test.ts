import { describe, expect, test } from "bun:test";
import { nextStop, stopToast } from "./steps";

const STOPS = [
  { id: "a", top: -400 },
  { id: "b", top: 100 },
  { id: "c", top: 600 },
];

describe("nextStop", () => {
  test("without a landed stop, goes to the first below the reading line, or the last above it", () => {
    expect(nextStop(STOPS, 200, 1, null)).toEqual({ index: 2, wrapped: false });
    expect(nextStop(STOPS, 200, -1, null)).toEqual({ index: 1, wrapped: false });
  });

  test("a stop right on the reading line is the one on screen, not the next", () => {
    expect(nextStop(STOPS, 100, 1, null)).toEqual({ index: 2, wrapped: false });
    expect(nextStop(STOPS, 100, -1, null)).toEqual({ index: 0, wrapped: false });
  });

  test("goes on from the landed stop while it is still where the key put it", () => {
    // The last stop can't scroll up to the reading line, so position alone would pick it again.
    const end = [...STOPS.slice(0, 2), { id: "c", top: 900 }];
    expect(nextStop(end, 200, -1, { id: "c", top: 900 })).toEqual({ index: 1, wrapped: false });
    expect(nextStop(end, 200, 1, { id: "c", top: 902 })).toEqual({ index: 0, wrapped: true });
  });

  test("forgets the landed stop once the viewer scrolled away from it", () => {
    expect(nextStop(STOPS, 200, 1, { id: "a", top: 200 })).toEqual({ index: 2, wrapped: false });
  });

  test("starts over past either end", () => {
    expect(nextStop(STOPS, 1000, 1, null)).toEqual({ index: 0, wrapped: true });
    expect(nextStop(STOPS, -1000, -1, null)).toEqual({ index: 2, wrapped: true });
  });

  test("has nowhere to go without stops", () => {
    expect(nextStop([], 0, 1, null)).toBeNull();
  });
});

describe("stopToast", () => {
  test.each([
    [1, 5, false, "Unresolved thread 2 of 5."],
    [0, 5, true, "Back to the first unresolved thread, 1 of 5."],
    [4, 5, true, "Back to the last unresolved thread, 5 of 5."],
    [0, 1, true, "Unresolved thread 1 of 1."],
  ] as const)("stop %i of %i, wrapped %p", (index, total, wrapped, said) => {
    expect(stopToast(index, total, wrapped, "unresolved thread")).toBe(said);
  });
});
