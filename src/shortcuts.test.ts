import { describe, expect, test } from "bun:test";
import { CHORD_TIMEOUT_MS, createShortcutMatcher, type KeyInput } from "./shortcuts";

function press(key: string, time: number, overrides: Partial<KeyInput> = {}): KeyInput {
  return { key, time, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, repeat: false, editable: false, ...overrides };
}

function claims(inputs: KeyInput[]) {
  const match = createShortcutMatcher();
  return inputs.map((input) => match(input).claim);
}

function run(inputs: KeyInput[]) {
  const match = createShortcutMatcher();
  return inputs.map((input) => match(input).action);
}

describe("createShortcutMatcher", () => {
  test.each([
    ["y", { type: "review", event: "APPROVE", withComment: false }],
    ["a", { type: "review", event: "APPROVE", withComment: true }],
    ["n", { type: "review", event: "REQUEST_CHANGES", withComment: true }],
  ] as const)("R then %s reviews", (second, action) => {
    expect(run([press("r", 0), press(second, 300)])).toEqual([null, action]);
  });

  test("accepts a capital R from caps lock", () => {
    expect(run([press("R", 0), press("Y", 100)])[1]).toMatchObject({ event: "APPROVE" });
  });

  test("a chord expires after the timeout", () => {
    expect(run([press("r", 0), press("y", CHORD_TIMEOUT_MS + 1)])).toEqual([null, null]);
  });

  test("the second key alone does nothing", () => {
    expect(run([press("y", 0), press("a", 10), press("n", 20)])).toEqual([null, null, null]);
  });

  test("another key in between cancels the chord", () => {
    expect(run([press("r", 0), press("x", 10), press("y", 20)])).toEqual([null, null, null]);
  });

  test("pressing R again restarts the chord", () => {
    expect(run([press("r", 0), press("r", 1400), press("y", 2800)])[2]).toMatchObject({ event: "APPROVE" });
  });

  test("keys typed into a text field never fire", () => {
    expect(run([press("r", 0, { editable: true }), press("y", 10, { editable: true })])).toEqual([null, null]);
    expect(run([press("r", 0), press("y", 10, { editable: true })])).toEqual([null, null]);
    expect(run([press("ArrowUp", 0, { metaKey: true, shiftKey: true, editable: true })])).toEqual([null]);
  });

  test("modified letters and held-down repeats do not count", () => {
    expect(run([press("r", 0), press("y", 10, { metaKey: true })])).toEqual([null, null]);
    expect(run([press("r", 0, { shiftKey: true }), press("y", 10)])).toEqual([null, null]);
    expect(run([press("r", 0), press("y", 10, { repeat: true })])).toEqual([null, null]);
  });

  test("a lone modifier keydown keeps the chord open", () => {
    expect(run([press("r", 0), press("Shift", 5, { shiftKey: true }), press("y", 10)])[2]).toMatchObject({
      event: "APPROVE",
    });
  });

  test.each([
    [{ metaKey: true }, "ArrowUp", 1],
    [{ metaKey: true }, "ArrowDown", -1],
    [{ ctrlKey: true }, "ArrowUp", 1],
  ] as const)("%o + shift + %s navigates the stack", (modifier, key, direction) => {
    expect(run([press(key, 0, { ...modifier, shiftKey: true })])).toEqual([{ type: "navigate", direction }]);
  });

  test("arrows without both modifiers do nothing", () => {
    expect(run([press("ArrowUp", 0, { metaKey: true }), press("ArrowUp", 10, { shiftKey: true })])).toEqual([null, null]);
    expect(run([press("ArrowUp", 0, { metaKey: true, shiftKey: true, altKey: true })])).toEqual([null]);
  });

  test("C then C copies the checkout command, C then G the link", () => {
    expect(run([press("c", 0), press("c", 200)])).toEqual([null, { type: "copy", what: "checkout" }]);
    expect(run([press("c", 0), press("c", CHORD_TIMEOUT_MS + 1)])).toEqual([null, null]);
    expect(run([press("c", 0), press("y", 10)])).toEqual([null, null]);
    expect(run([press("c", 0), press("g", 10)])).toEqual([null, { type: "copy", what: "link" }]);
    expect(run([press("r", 0), press("c", 10), press("c", 20)])[2]).toEqual({ type: "copy", what: "checkout" });
  });

  test("claims the C that starts a chord from GitHub, but leaves R and unrelated keys to the page", () => {
    expect(claims([press("c", 0), press("c", 10)])).toEqual([true, true]);
    expect(claims([press("r", 0), press("y", 10)])).toEqual([false, true]);
    expect(claims([press("x", 0), press("j", 10)])).toEqual([false, false]);
    expect(claims([press("c", 0, { editable: true })])).toEqual([false]);
    expect(claims([press("ArrowUp", 0, { metaKey: true, shiftKey: true }), press("ArrowLeft", 10, { metaKey: true, shiftKey: true })])).toEqual([true, false]);
  });
});
