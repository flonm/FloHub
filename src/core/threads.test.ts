import { describe, expect, test } from "bun:test";
import { interdiff, versionDiff } from "./interdiff";
import { type Compared, placeThreads, type ReviewThread } from "./threads";

// v1 adds a line after line 10; v2 adds another line above it, so the kept lines are renumbered, and drops one.
const V1 = { filename: "a.ts", status: "modified", sha: "a1", patch: "@@ -10,3 +10,4 @@\n keep\n+added\n-gone\n tail" };
const V2 = { filename: "a.ts", status: "modified", sha: "a2", patch: "@@ -20,2 +20,4 @@\n+first\n keep\n+added\n tail" };
const SINCE: Compared = { older: "v1", newer: "v2", newerIsHead: true };
const [FILE] = interdiff([V1], [V2]);

const thread = (overrides: Partial<ReviewThread> & { on?: string }): ReviewThread => {
  const { on = "v1", ...rest } = overrides;
  return {
    id: "PRRT_1",
    path: "a.ts",
    resolved: false,
    outdated: false,
    line: null,
    startLine: null,
    originalLine: null,
    originalStartLine: null,
    side: "RIGHT",
    comments: [{ id: 1, author: "ana", avatarUrl: null, html: "<p>Why?</p>", createdAt: "2026-10-01T00:00:00Z", url: "", pending: false, originalCommit: on }],
    ...rest,
  };
};

/** @returns Each placed thread's lines, as the rows show them. */
function rows(placed: ReturnType<typeof placeThreads>["placed"]): string[] {
  return placed.map(({ first, last }) => FILE!.lines.slice(first, last + 1).map((line) => line.display).join(" | "));
}

describe("placeThreads", () => {
  test("a thread on the older version sits on its line by the older version's numbers", () => {
    const { placed } = placeThreads(FILE!, [thread({ originalLine: 11, outdated: true })], SINCE);
    expect(rows(placed)).toEqual(["+added"]);
  });

  test("a thread on a line the newer version removed sits on the removed row", () => {
    const { placed } = placeThreads(FILE!, [thread({ originalLine: 11, side: "LEFT", outdated: true })], SINCE);
    expect(rows(placed)).toEqual(["-gone"]);
  });

  test("a thread on the newer version sits on its line by the newer version's numbers", () => {
    const { placed } = placeThreads(FILE!, [thread({ on: "v2", originalLine: 20 })], SINCE);
    expect(rows(placed)).toEqual(["+first"]);
  });

  test("a current thread from another version sits at its current lines while the newer version is the head", () => {
    const current = thread({ on: "v0", line: 22, originalLine: 5 });
    expect(rows(placeThreads(FILE!, [current], SINCE).placed)).toEqual(["+added"]);
    expect(placeThreads(FILE!, [current], { ...SINCE, newerIsHead: false })).toEqual({ placed: [], elsewhere: [current] });
  });

  test("a thread on several lines covers them, and is placed once though more than one rule fits", () => {
    const { placed } = placeThreads(FILE!, [thread({ on: "v2", originalLine: 22, originalStartLine: 21, line: 22, startLine: 21 })], SINCE);
    expect(rows(placed)).toEqual([" keep | +added"]);
  });

  test("an outdated thread from another version has nowhere to go, and counts for its file", () => {
    const old = thread({ on: "v0", originalLine: 3, outdated: true });
    expect(placeThreads(FILE!, [old, thread({ path: "b.ts", originalLine: 11 })], SINCE)).toEqual({ placed: [], elsewhere: [old] });
  });

  test("in a version against the base branch, a thread on that version sits on any of its rows", () => {
    const [plain] = versionDiff([V1]);
    const { placed } = placeThreads(plain!, [thread({ originalLine: 11, side: "LEFT" })], { older: null, newer: "v1", newerIsHead: false });
    expect(placed.map(({ last }) => plain!.lines[last]?.display)).toEqual(["-gone"]);
  });
});
