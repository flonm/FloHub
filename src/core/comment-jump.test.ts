import { describe, expect, test } from "bun:test";
import { commentIsCurrent, type CommentPlace, commentJump, currentLines, githubFileAnchor, githubLineSelector, parseCommentLink, storedVersionsWillDo, threadElsewhere, threadNumber } from "./comment-jump";
import type { ReviewThread } from "./threads";
import type { Version } from "./versions";

const NOW = Date.parse("2026-10-21T12:00:00Z");

const version = (number: number, oid: string, at: string, current = false): Version => ({
  oid,
  number,
  at,
  pushedBy: null,
  reviewedBy: [],
  viewerLatestReview: false,
  current,
});
const VERSIONS = [
  version(1, "v1", "2026-10-01T00:00:00Z"),
  version(2, "v2", "2026-10-02T00:00:00Z"),
  version(3, "v3", "2026-10-03T00:00:00Z", true),
];

const comment = (overrides: Partial<CommentPlace> = {}): CommentPlace => ({
  path: "src/a.ts",
  originalCommit: "v1",
  originalLine: 8,
  originalStartLine: null,
  line: null,
  startLine: null,
  side: "RIGHT",
  createdAt: "2026-10-01T12:00:00Z",
  ...overrides,
});

describe("commentJump", () => {
  test("an outdated comment shows how the code changed since its version, and the code as it saw it", () => {
    const jump = commentJump(VERSIONS, comment(), NOW);
    expect(jump?.version.number).toBe(1);
    expect(jump?.since).toEqual({
      range: { from: "v1", to: "", toCurrent: true, at: NOW },
      line: { path: "src/a.ts", line: 8, side: "RIGHT" },
    });
    expect(jump?.at).toEqual({
      range: { from: "base", to: "v1", toCurrent: false, at: NOW },
      line: { path: "src/a.ts", line: 8, side: "RIGHT" },
    });
  });

  test("a comment on the current head has nothing since, and its lines in the current diff", () => {
    const jump = commentJump(VERSIONS, comment({ originalCommit: "v3", originalLine: 107, line: 107 }), NOW);
    expect(jump?.since).toBeNull();
    expect(jump?.at.range).toEqual({ from: "base", to: "v3", toCurrent: true, at: NOW });
  });

  test("a comment on several lines covers them all, on the side it was written on", () => {
    const jump = commentJump(VERSIONS, comment({ originalLine: 243, originalStartLine: 241, side: "LEFT" }), NOW);
    expect(jump?.since?.line).toEqual({ path: "src/a.ts", line: 243, startLine: 241, side: "LEFT" });
  });

  test("a comment on a commit no version lists falls back to the version current then, without its line numbers", () => {
    const jump = commentJump(VERSIONS, comment({ originalCommit: "gone", createdAt: "2026-10-02T12:00:00Z" }), NOW);
    expect([jump?.version.number, jump?.exact]).toEqual([2, false]);
    expect(jump?.since).toEqual({ range: { from: "v2", to: "", toCurrent: true, at: NOW } });
  });

  test("a pull request without versions has nothing to show", () => {
    expect(commentJump([], comment(), NOW)).toBeNull();
  });
});

describe("currentLines", () => {
  test("a current comment's lines are its lines in the current diff, not the ones it was written on", () => {
    expect(currentLines(comment({ originalLine: 8, line: 107, startLine: 105, side: "LEFT" }))).toEqual({
      path: "src/a.ts",
      line: 107,
      startLine: 105,
      side: "LEFT",
    });
  });

  test("an outdated comment has no lines in the current diff", () => {
    expect(currentLines(comment())).toBeNull();
  });
});

describe("commentIsCurrent", () => {
  test.each([
    ["a link to the current diff says the comment is in it", { kind: "comment", id: 1 }, null, true],
    ["a link to its thread in the single-commit view says it is outdated", { kind: "thread", id: 1 }, null, false],
    ["the fetched comment wins over a link a push has since made stale", { kind: "comment", id: 1 }, comment(), false],
    ["the fetched comment wins the other way too", { kind: "thread", id: 1 }, comment({ line: 8 }), true],
  ] as const)("%s", (_rule, link, place, expected) => {
    expect(commentIsCurrent(link, place)).toBe(expected);
  });
});

describe("githubLineSelector", () => {
  test("finds the line's code cell on its side, in its file's table", () => {
    expect(githubLineSelector({ path: "e2e/smoke.ts", line: 809, side: "RIGHT" })).toBe(
      'table[aria-label="Diff for: e2e/smoke.ts"] td.diff-text-cell[data-diff-side="right"][data-line-number="809"]',
    );
  });

  test("picks another of a comment's lines when asked", () => {
    expect(githubLineSelector({ path: "a.ts", line: 9, startLine: 7, side: "LEFT" }, 7)).toBe(
      'table[aria-label="Diff for: a.ts"] td.diff-text-cell[data-diff-side="left"][data-line-number="7"]',
    );
  });

  test("a quote or backslash in the path can't end the attribute early", () => {
    expect(githubLineSelector({ path: String.raw`we"ird\name.ts`, line: 1, side: "RIGHT" })).toStartWith(
      String.raw`table[aria-label="Diff for: we\"ird\\name.ts"]`,
    );
  });
});

describe("githubFileAnchor", () => {
  test("is the SHA-256 of the path, as GitHub's diff ids its files", async () => {
    expect(await githubFileAnchor("e2e/smoke.ts")).toBe("diff-682f6e808601d513437467d8be5e832167c903e94d562dcd37f30f6391c3eade");
  });
});

describe("parseCommentLink", () => {
  const PAGE = "https://github.com/flonm/FloHub/pull/52/changes?panel=comments";

  test.each([
    ["/flonm/FloHub/pull/52/changes#r4337461516", { kind: "comment", id: 4_337_461_516 }],
    [
      "https://github.com/flonm/FloHub/pull/52/changes/d11f0f7c560795b3bbb91c5852935caf9a3c9279?new_files_changed=true#r2932429879",
      { kind: "thread", id: 2_932_429_879 },
    ],
    ["/flonm/FloHub/pull/52/files#r12", { kind: "comment", id: 12 }],
  ])("%p names a comment or, outdated, its thread", (href, expected) => {
    expect(parseCommentLink(href, PAGE)).toEqual(expected as ReturnType<typeof parseCommentLink>);
  });

  test.each([
    "https://github.com/flonm/FloHub/pull/52/changes#paneldiscussion_r4337462359",
    "/flonm",
    "/flonm/FloHub/pull/52#issuecomment-1",
    "/flonm/FloHub/issues/52#r1",
  ])("leaves %p alone", (href) => {
    expect(parseCommentLink(href, PAGE)).toBeNull();
  });
});

describe("threadNumber", () => {
  test("reads the number GitHub links an outdated comment by out of its thread's id", () => {
    // From flonm/FloHub#52: the thread of the comment its outdated link names #r2932429879.
    expect(threadNumber("PRRT_kwDOVHGhw86uyVQ3")).toBe(2_932_429_879);
    expect(threadNumber("PRRT_kwABzQN4")).toBe(888);
  });

  test.each(["PRRC_kwDOVHGhw86uyVQ3", "PRRT_", "PRRT_!!", "MDE3OlB1bGxSZXF1ZXN0UmV2aWV3VGhyZWFkMQ==", "PRRT_kwDO"])(
    "an id of another shape gives no number: %p",
    (id) => {
      expect(threadNumber(id)).toBeNull();
    },
  );
});

describe("storedVersionsWillDo", () => {
  const stored = { baseRefOid: "base", versions: VERSIONS, baseHeads: [] };

  test("the stored versions answer while they know the comment's commit as an older version", () => {
    expect(storedVersionsWillDo(stored, "v1")).toBe(true);
  });

  test("but not once they call it the head, from before the author pushed again, or don't know it", () => {
    expect(storedVersionsWillDo(stored, "v3")).toBe(false);
    expect(storedVersionsWillDo(stored, "v4")).toBe(false);
    expect(storedVersionsWillDo(null, "v1")).toBe(false);
  });
});

/** @returns A thread started on a version, outdated since. */
const outdatedThread = (on: string, overrides: Partial<ReviewThread> = {}): ReviewThread => ({
  id: "PRRT_1",
  path: "src/a.ts",
  resolved: false,
  outdated: true,
  line: null,
  startLine: null,
  originalLine: 8,
  originalStartLine: null,
  side: "RIGHT",
  resolvedBy: null,
  comments: [{ id: 1, author: "ana", avatarUrl: null, html: "", createdAt: "2026-10-02T12:00:00Z", url: "", pending: false, association: null, originalCommit: on }],
  ...overrides,
});

describe("threadElsewhere", () => {
  const SINCE_V1 = { older: "v1", newer: "v3", newerIsHead: true };

  test("a thread written on a version the diff doesn't show goes to how its code changed since", () => {
    expect(threadElsewhere(VERSIONS, outdatedThread("v2"), SINCE_V1, false, NOW)).toEqual({
      label: "Changes since v2",
      target: { range: { from: "v2", to: "", toCurrent: true, at: NOW }, line: { path: "src/a.ts", line: 8, side: "RIGHT" } },
    });
  });

  test("on a file that makes the same change in both versions, it goes to the code as the thread saw it", () => {
    expect(threadElsewhere(VERSIONS, outdatedThread("v1"), SINCE_V1, true, NOW)?.label).toBe("Code at v1");
  });

  test("it never goes to the range already on screen", () => {
    expect(threadElsewhere(VERSIONS, outdatedThread("v1"), SINCE_V1, false, NOW)?.label).toBe("Code at v1");
  });

  test("a thread on the head goes to the head's code", () => {
    expect(threadElsewhere(VERSIONS, outdatedThread("v3"), SINCE_V1, true, NOW)?.target.range).toEqual({ from: "base", to: "v3", toCurrent: true, at: NOW });
  });
});
