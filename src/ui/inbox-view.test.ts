import { describe, expect, test } from "bun:test";
import { missingScopes } from "../api/github";
import { blocksInbox, isEmptyInbox, moveSelection, problemFor, showsPull, updatedLabel } from "./inbox-view";

describe("problemFor", () => {
  test("only a failed request leaves the stored inbox visible", () => {
    expect(problemFor("failed", "GitHub answered 502: Bad Gateway")).toEqual({ kind: "error", message: "GitHub answered 502: Bad Gateway" });
    expect(blocksInbox(problemFor("failed", ""))).toBe(false);
    expect(blocksInbox(problemFor("no-token", ""))).toBe(true);
    expect(blocksInbox(problemFor("unauthorized", ""))).toBe(true);
    expect(blocksInbox(problemFor("scopes", ""))).toBe(true);
    expect(blocksInbox(null)).toBe(false);
  });
});

describe("isEmptyInbox", () => {
  const group = { key: "a#1", repo: "a/b", stackNumber: null, stackSize: 1, pulls: [] };
  test("is empty only when every search is", () => {
    expect(isEmptyInbox({ review: [], mine: [] })).toBe(true);
    expect(isEmptyInbox({ review: [group], mine: [] })).toBe(false);
    expect(isEmptyInbox({ review: [], mine: [group] })).toBe(false);
    expect(isEmptyInbox({ review: [], mine: [], waiting: [], other: [group] })).toBe(false);
  });
});

describe("updatedLabel", () => {
  const now = Date.parse("2026-10-13T12:00:00Z");
  test.each([
    [now - 10_000, "Updated just now"],
    [now - 5 * 60_000, "Updated 5 minutes ago"],
    [now - 3 * 3_600_000, "Updated 3 hours ago"],
  ])("%d → %s", (fetchedAt, label) => {
    expect(updatedLabel(fetchedAt, now)).toBe(label);
  });
});

describe("moveSelection", () => {
  test.each([
    ["ArrowDown", 0, 1],
    ["j", 1, 2],
    ["j", 4, 4],
    ["ArrowUp", 2, 1],
    ["k", 0, 0],
    ["Home", 3, 0],
    ["End", 1, 4],
    ["ArrowDown", -1, 0],
    ["k", -1, 0],
  ])("%s from %d → %d", (key, index, next) => {
    expect(moveSelection(key, index, 5)).toBe(next);
  });

  test("ignores other keys and an empty list", () => {
    expect(moveSelection("x", 1, 5)).toBeNull();
    expect(moveSelection("ArrowDown", -1, 0)).toBeNull();
  });
});

describe("showsPull", () => {
  const pull = "https://github.com/octo-org/api/pull/77";
  test.each([
    ["https://github.com/octo-org/api/pull/77", true],
    ["https://github.com/octo-org/api/pull/77/files?w=1", true],
    ["https://github.com/Octo-Org/API/pull/77#discussion_r1", true],
    ["https://github.com/octo-org/api/pull/770", false],
    ["https://github.com/octo-org/api/issues/77", false],
    ["https://gist.github.com/octo-org/api/pull/77", false],
    ["not a url", false],
  ])("%s → %p", (tab, expected) => {
    expect(showsPull(tab, pull)).toBe(expected);
  });
});

describe("missingScopes", () => {
  test("names the scope GitHub asks for", () => {
    const message =
      "Your token has not been granted the required scopes to execute this query. The 'login' field requires one of the following scopes: ['read:org'], but your token has only been granted the: ['repo'] scopes.";
    expect(missingScopes([{ type: "INSUFFICIENT_SCOPES", message }])).toBe("The token lacks the read:org scope.");
    expect(missingScopes([{ type: "INSUFFICIENT_SCOPES", message: "Nope" }])).toBe("The token lacks a scope FloHub needs.");
    expect(missingScopes([{ message: "Something else" }])).toBeNull();
  });
});
