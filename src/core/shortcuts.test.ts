import { describe, expect, test } from "bun:test";
import { CHORD_TIMEOUT_MS, chordHints, createShortcutMatcher, isMac, type KeyInput, shortcutHelp } from "./shortcuts";

function press(key: string, time: number, overrides: Partial<KeyInput> = {}): KeyInput {
  return { key, time, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, repeat: false, editable: false, ...overrides };
}

function claims(inputs: KeyInput[]) {
  const match = createShortcutMatcher(true);
  return inputs.map((input) => match(input).claim);
}

function run(inputs: KeyInput[]) {
  const match = createShortcutMatcher(true);
  return inputs.map((input) => match(input).action);
}

/** @returns Every key the shortcut list names. */
function keys(mac: boolean): string[] {
  return shortcutHelp(mac).flatMap((row) => row.keys);
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

  test("R then R asks the stale reviewers again, and leaves nothing open for a Y after it", () => {
    expect(run([press("r", 0), press("r", 200), press("y", 400)])).toEqual([null, { type: "ask", who: "stale" }, null]);
    expect(run([press("r", 0), press("r", CHORD_TIMEOUT_MS + 1), press("y", CHORD_TIMEOUT_MS + 100)])[2]).toMatchObject({ event: "APPROVE" });
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

  test("⌘Esc closes the pull request and ⌘⇧Esc reopens it, on macOS only", () => {
    expect(run([press("Escape", 0, { metaKey: true })])).toEqual([{ type: "state", intent: "close" }]);
    expect(run([press("Escape", 0, { metaKey: true, shiftKey: true })])).toEqual([{ type: "state", intent: "reopen" }]);
    expect(claims([press("Escape", 0, { metaKey: true })])).toEqual([true]);
    const elsewhere = createShortcutMatcher(false);
    expect(elsewhere(press("Escape", 0, { ctrlKey: true }))).toEqual({ action: null, claim: false });
    expect(elsewhere(press("Escape", 0, { metaKey: true }))).toEqual({ action: null, claim: false });
  });

  test("a plain Esc, or one typed in a text field, is left to the page", () => {
    expect(claims([press("Escape", 0)])).toEqual([false]);
    expect(run([press("Escape", 0), press("Escape", 10, { metaKey: true, editable: true })])).toEqual([null, null]);
    expect(run([press("Escape", 0, { metaKey: true, altKey: true })])).toEqual([null]);
  });

  test("D then D toggles the draft, claiming both Ds from the page", () => {
    expect(run([press("d", 0), press("d", 200)])).toEqual([null, { type: "state", intent: "toggle-draft" }]);
    expect(claims([press("d", 0), press("d", 200)])).toEqual([true, true]);
    expect(run([press("d", 0), press("d", CHORD_TIMEOUT_MS + 1)])).toEqual([null, null]);
  });

  test("C then C copies the checkout command, C then G the link", () => {
    expect(run([press("c", 0), press("c", 200)])).toEqual([null, { type: "copy", what: "checkout" }]);
    expect(run([press("c", 0), press("c", CHORD_TIMEOUT_MS + 1)])).toEqual([null, null]);
    expect(run([press("c", 0), press("y", 10)])).toEqual([null, null]);
    expect(run([press("c", 0), press("g", 10)])).toEqual([null, { type: "copy", what: "link" }]);
    expect(run([press("r", 0), press("c", 10), press("c", 20)])[2]).toEqual({ type: "copy", what: "checkout" });
  });

  test("C then B copies the branch, and P then P pokes the waiting reviewers, claiming both keys", () => {
    expect(run([press("c", 0), press("b", 200)])).toEqual([null, { type: "copy", what: "branch" }]);
    expect(run([press("p", 0), press("p", 200)])).toEqual([null, { type: "ask", who: "waiting" }]);
    expect(claims([press("p", 0), press("p", 200)])).toEqual([true, true]);
  });

  test.each([
    ["no modifier", {}],
    ["⌥, as a German Mac types them", { altKey: true }],
    ["⇧", { shiftKey: true }],
  ])("] and [ step through the threads with %s", (_, modifiers) => {
    expect(run([press("]", 0, modifiers), press("[", 10, modifiers)])).toEqual([
      { type: "thread", direction: 1 },
      { type: "thread", direction: -1 },
    ]);
    expect(claims([press("]", 0, modifiers)])).toEqual([true]);
  });

  test.each([
    ["US layouts and a German Mac, with ⇧", { shiftKey: true }],
    ["a layout that types it unshifted", {}],
  ])("? shows the shortcut list, on %s, claiming it from GitHub's own", (_, modifiers) => {
    expect(run([press("?", 0, modifiers)])).toEqual([{ type: "help" }]);
    expect(claims([press("?", 0, modifiers), press("?", 10, { ...modifiers, metaKey: true })])).toEqual([true, false]);
  });

  test("] and [ with ⌘ or Ctrl, or in a text field, are left to the page", () => {
    expect(claims([press("]", 0, { metaKey: true }), press("[", 10, { ctrlKey: true }), press("]", 20, { editable: true })])).toEqual([false, false, false]);
  });

  test("V toggles the versions view, F goes to the next unviewed file and ⇧F marks the one in view first", () => {
    expect(run([press("v", 0), press("f", 10), press("F", 20, { shiftKey: true })])).toEqual([
      { type: "versions" },
      { type: "file", markViewed: false },
      { type: "file", markViewed: true },
    ]);
    expect(claims([press("v", 0), press("f", 10)])).toEqual([true, true]);
    expect(run([press("f", 0, { metaKey: true }), press("F", 10, { shiftKey: true, altKey: true })])).toEqual([null, null]);
  });

  test("a single key ends an open chord", () => {
    expect(run([press("c", 0), press("v", 10), press("c", 20)])).toEqual([null, { type: "versions" }, null]);
  });

  test("claims the C that starts a chord from GitHub, but leaves R and unrelated keys to the page", () => {
    expect(claims([press("c", 0), press("c", 10)])).toEqual([true, true]);
    expect(claims([press("r", 0), press("y", 10)])).toEqual([false, true]);
    expect(claims([press("x", 0), press("j", 10)])).toEqual([false, false]);
    expect(claims([press("c", 0, { editable: true })])).toEqual([false]);
    expect(claims([press("ArrowUp", 0, { metaKey: true, shiftKey: true }), press("ArrowLeft", 10, { metaKey: true, shiftKey: true })])).toEqual([true, false]);
  });
});

describe("a waiting chord", () => {
  test("is pending after its first key until it times out, and not after a single key", () => {
    const match = createShortcutMatcher(true);
    match(press("c", 0));
    expect(match.pending(500)).toBe("c");
    expect(match.pending(CHORD_TIMEOUT_MS + 1)).toBeNull();
    match(press("v", 2000));
    expect(match.pending(2100)).toBeNull();
  });

  test("held while its hint shows, it waits for the next key however long that takes", () => {
    const match = createShortcutMatcher(true);
    match(press("r", 0));
    match.hold();
    expect(match.pending(60_000)).toBe("r");
    expect(match(press("y", 60_000)).action).toMatchObject({ event: "APPROVE" });
    expect(match.pending(60_001)).toBeNull();
  });

  test("cancelled, the next key starts afresh", () => {
    const match = createShortcutMatcher(true);
    match(press("c", 0));
    match.cancel();
    expect(match(press("c", 100)).action).toBeNull();
  });
});

describe("chordHints", () => {
  test("lists what may follow a chord's first key, as the shortcut list names it", () => {
    expect(chordHints("c", true)).toEqual([
      { key: "C", action: "Copy gh pr checkout <number>" },
      { key: "G", action: "Copy the pull request's link" },
      { key: "B", action: "Copy the pull request's branch" },
    ]);
    expect(chordHints("r", true).map((hint) => hint.key)).toEqual(["Y", "A", "N", "R"]);
    expect(chordHints("v", true)).toEqual([]);
  });

  test("every key that starts a chord has hints", () => {
    for (const prefix of ["r", "c", "d", "p"]) expect(chordHints(prefix, false).length).toBeGreaterThan(0);
  });
});

describe("the shortcut list", () => {
  test("moves through the stack with ⌘ on macOS and Ctrl elsewhere", () => {
    expect(shortcutHelp(true)[0]?.keys).toEqual(["⌘⇧↑", "⌘⇧↓"]);
    expect(shortcutHelp(false)[0]?.keys).toEqual(["Ctrl+⇧↑", "Ctrl+⇧↓"]);
  });

  test("lists closing and reopening only on macOS, where they have keys", () => {
    expect(keys(true)).toContain("⌘Esc");
    expect(keys(true)).toContain("⌘⇧Esc");
    expect(keys(false).some((key) => key.includes("Esc") && key !== "Esc")).toBe(false);
  });

  test("every chord it lists is one the matcher acts on", () => {
    for (const row of shortcutHelp(true)) {
      if (row.join !== "then") continue;
      const match = createShortcutMatcher(true);
      const [first = "", second = ""] = row.keys.map((key) => key.toLowerCase());
      match(press(first, 0));
      expect(match(press(second, 100)).action).not.toBeNull();
    }
  });

  test.each([
    ["MacIntel", true],
    ["macOS", true],
    ["Win32", false],
    ["Linux x86_64", false],
  ])("%s is macOS: %p", (platform, mac) => {
    expect(isMac(platform)).toBe(mac);
  });
});
