import { describe, expect, test } from "bun:test";
import { CHEERS, funFrom, pickByRoll, withCheer } from "./fun";

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

  test.each<[number, string]>([
    [0, "a"],
    [0.5, "b"],
    [0.99, "c"],
    [1, "c"],
    [-0.5, "a"],
  ])("a roll of %p picks %p from three", (roll, picked) => {
    expect(pickByRoll(["a", "b", "c"], roll)).toBe(picked);
  });
});
