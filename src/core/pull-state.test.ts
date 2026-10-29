import { describe, expect, test } from "bun:test";
import { moveDone, moveFor, moveKeys, noMoveReason, pullMoves, pullStateOf, stateAfter } from "./pull-state";

describe("pull request state", () => {
  test.each([
    [{ state: "OPEN", isDraft: false }, "open"],
    [{ state: "OPEN", isDraft: true }, "draft"],
    [{ state: "CLOSED", isDraft: true }, "closed"],
    [{ state: "MERGED", isDraft: false }, "merged"],
  ] as const)("%o is %s", (pull, state) => {
    expect(pullStateOf(pull)).toBe(state);
  });

  test.each([
    ["open", ["draft", "close"]],
    ["draft", ["ready", "close"]],
    ["closed", ["reopen"]],
    ["merged", []],
  ] as const)("an %s pull request offers %o", (state, moves) => {
    expect(pullMoves(state, true)).toEqual([...moves]);
  });

  test("a viewer who may not change the pull request is offered nothing", () => {
    expect(pullMoves("open", false)).toEqual([]);
    expect(moveFor("close", "open", false)).toBeNull();
  });

  test.each([
    ["close", "open", "close"],
    ["close", "draft", "close"],
    ["close", "closed", null],
    ["reopen", "closed", "reopen"],
    ["reopen", "open", null],
    ["toggle-draft", "open", "draft"],
    ["toggle-draft", "draft", "ready"],
    ["toggle-draft", "closed", null],
    ["close", "merged", null],
  ] as const)("%s on an %s pull request moves to %p", (intent, state, move) => {
    expect(moveFor(intent, state, true)).toBe(move);
  });

  test("says why a shortcut made no move", () => {
    expect(noMoveReason("close", "closed", true)).toBe("The pull request is already closed.");
    expect(noMoveReason("reopen", "draft", true)).toBe("The pull request is already open.");
    expect(noMoveReason("toggle-draft", "closed", true)).toBe("The pull request is closed. Reopen it first.");
    expect(noMoveReason("close", "merged", true)).toBe("The pull request is merged.");
    expect(noMoveReason("close", "open", false)).toBe("You can't change this pull request's state.");
  });
});

describe("after a move", () => {
  test.each([
    ["close", "closed"],
    ["reopen", "open"],
    ["draft", "draft"],
    ["ready", "open"],
  ] as const)("%s leaves the pull request %s", (move, state) => {
    expect(stateAfter(move)).toBe(state);
  });

  test("the menu names each move's keys, closing and reopening only on macOS", () => {
    expect(moveKeys("close", true)).toBe("⌘Esc");
    expect(moveKeys("reopen", false)).toBeNull();
    expect(moveKeys("ready", false)).toBe("D D");
  });

  test("the toast names the key that undoes the move, where there is one", () => {
    expect(moveDone("close", 7, true)).toBe("Closed #7. ⌘⇧Esc reopens it.");
    expect(moveDone("close", 7, false)).toBe("Closed #7.");
    expect(moveDone("draft", 7, false)).toBe("Turned #7 into a draft. D then D marks it ready.");
    expect(moveDone("ready", 7, true)).toBe("Marked #7 ready for review. D then D turns it back into a draft.");
  });
});
