import { describe, expect, test } from "bun:test";
import { interdiff, versionDiff } from "./interdiff";
import { commentableLine, commentRange, type Compared, placeThreads, postingMode, type ReviewThread } from "./threads";

// v1 adds two lines after line 10 and removes one; v2 adds another line above them, so the kept lines are
// renumbered, and no longer adds only1.
const V1 = { filename: "a.ts", status: "modified", sha: "a1", patch: "@@ -10,3 +10,4 @@\n keep\n+added\n+only1\n-gone\n tail" };
const V2 = { filename: "a.ts", status: "modified", sha: "a2", patch: "@@ -20,3 +20,4 @@\n+first\n keep\n+added\n-gone\n tail" };
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
    resolvedBy: null,
    comments: [{ id: 1, author: "ana", avatarUrl: null, html: "<p>Why?</p>", createdAt: "2026-10-01T00:00:00Z", url: "", pending: false, association: null, originalCommit: on }],
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

/** @returns The column each of the threads sits in, between v1 and v2. */
function columns(threads: ReviewThread[]): string[] {
  return placeThreads(FILE!, threads, SINCE).placed.map(({ column }) => column);
}

describe("the column a thread sits in, side by side", () => {
  test("a thread on the older version sits on the left, one on the newer version or at its current lines on the right", () => {
    expect(columns([thread({ originalLine: 11, outdated: true })])).toEqual(["older"]);
    expect(columns([thread({ on: "v2", originalLine: 20 })])).toEqual(["newer"]);
    expect(columns([thread({ on: "v0", line: 22, originalLine: 5 })])).toEqual(["newer"]);
  });

  test("in a version against the base branch, GitHub's own side decides: L on the left, R on the right", () => {
    const [plain] = versionDiff([V1]);
    const compared = { older: null, newer: "v1", newerIsHead: false };
    const column = (side: "LEFT" | "RIGHT", line: number) => placeThreads(plain!, [thread({ originalLine: line, side })], compared).placed[0]?.column;
    expect(column("LEFT", 11)).toBe("older");
    expect(column("RIGHT", 11)).toBe("newer");
  });
});

describe("commenting", () => {
  const plain = versionDiff([V1])[0]!;
  const at = (lines: typeof plain.lines, display: string) => lines.findIndex((line) => line.display === display);

  test("a row takes a comment on the side and number GitHub's diff gives it", () => {
    expect(commentableLine(plain.lines[at(plain.lines, "+added")]!, true)).toEqual({ side: "RIGHT", line: 11 });
    expect(commentableLine(plain.lines[at(plain.lines, "-gone")]!, true)).toEqual({ side: "LEFT", line: 11 });
    expect(commentableLine(plain.lines[at(plain.lines, " keep")]!, true)).toEqual({ side: "RIGHT", line: 10 });
  });

  test("a hunk header, and a row only the older version has, take none", () => {
    expect(commentableLine(plain.lines[0]!, true)).toBeNull();
    expect(commentableLine(FILE!.lines[at(FILE!.lines, "+only1")]!, false)).toBeNull();
    expect(commentableLine(FILE!.lines[at(FILE!.lines, "+first")]!, false)).toEqual({ side: "RIGHT", line: 20 });
  });

  test("a comment on several rows names its first and last line, in either order", () => {
    const keep = at(plain.lines, " keep");
    const tail = at(plain.lines, " tail");
    expect(commentRange(plain.lines, tail, keep, true)).toEqual({ side: "RIGHT", line: 13, startSide: "RIGHT", startLine: 10 });
    expect(commentRange(plain.lines, keep, keep, true)).toEqual({ side: "RIGHT", line: 10 });
  });

  test("a range across hunks, or with an end that takes no comment, is refused", () => {
    const two = versionDiff([{ ...V1, patch: `${V1.patch}\n@@ -40,1 +41,1 @@\n more` }])[0]!;
    expect(commentRange(two.lines, at(two.lines, " keep"), at(two.lines, " more"), true)).toBeNull();
    expect(commentRange(plain.lines, 0, at(plain.lines, " keep"), true)).toBeNull();
  });

  test.each([
    [null, "fresh"],
    [{ commit: "head" }, "review"],
    [{ commit: "older" }, "blocked"],
  ] as const)("with pending review %p a comment is posted %p", (pending, mode) => {
    expect(postingMode(pending, "head")).toBe(mode);
  });
});
