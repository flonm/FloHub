import { describe, expect, test } from "bun:test";
import { type ProgressBasis, progressCounts, progressLabel, roughProgress, type ThreadProgress, threadProgress } from "./addressed";
import { interdiff, type VersionFile } from "./interdiff";
import type { ReviewThread, ThreadComment } from "./threads";
import type { TurnThread } from "./turn";

const AUTHOR = "octocat";
const V1 = "c1";
const HEAD = "c9";

// v1 adds `two` and removes `four`. By v1's numbers: one R10, two R11, three R12, five R13, six R14; four L12.
const BEFORE: VersionFile = { filename: "a.ts", status: "modified", sha: "a1", patch: "@@ -10,5 +10,6 @@\n one\n+two\n three\n-four\n five\n six" };
// The head keeps `two` and `four`, and rewrites `five`.
const REWRITTEN: VersionFile = { filename: "a.ts", status: "modified", sha: "a2", patch: "@@ -10,5 +10,6 @@\n one\n+two\n three\n four\n-five\n+FIVE\n six" };
// The head adds a line between `two` and `three`, and still removes `four`.
const INSERTED: VersionFile = { filename: "a.ts", status: "modified", sha: "a3", patch: "@@ -10,5 +10,7 @@\n one\n+two\n+inserted\n three\n-four\n five\n six" };

const since = (after: VersionFile, sameBase = false): ProgressBasis => ({
  head: HEAD,
  sinceVersion: new Map([[V1, interdiff([BEFORE], [after], { sameBase })]]),
});

const comment = (author: string, overrides: Partial<ThreadComment> = {}): ThreadComment => ({
  id: 1,
  author,
  avatarUrl: null,
  html: "<p>Why?</p>",
  createdAt: "2026-10-01T00:00:00Z",
  url: "",
  pending: false,
  association: null,
  originalCommit: V1,
  ...overrides,
});

const thread = (overrides: Partial<ReviewThread> = {}): ReviewThread => ({
  id: "PRRT_1",
  path: "a.ts",
  resolved: false,
  outdated: false,
  line: null,
  startLine: null,
  originalLine: 10,
  originalStartLine: null,
  side: "RIGHT",
  resolvedBy: null,
  comments: [comment("alice")],
  ...overrides,
});

describe("threadProgress from the diff to the head", () => {
  test.each<[string, Partial<ReviewThread>, VersionFile, ThreadProgress]>([
    ["a line both versions keep as it was", { originalLine: 10 }, REWRITTEN, "untouched"],
    ["a line both versions add alike", { originalLine: 11 }, REWRITTEN, "untouched"],
    ["a line the head rewrote", { originalLine: 13 }, REWRITTEN, "changed"],
    ["a range with a rewritten line in it", { originalStartLine: 12, originalLine: 14 }, REWRITTEN, "changed"],
    ["a range both versions leave as it was", { originalStartLine: 10, originalLine: 12 }, REWRITTEN, "untouched"],
    ["a range the head put a line inside", { originalStartLine: 10, originalLine: 12 }, INSERTED, "changed"],
    ["a single line next to the inserted one", { originalLine: 12 }, INSERTED, "untouched"],
    ["a removed base line the head keeps after all", { side: "LEFT", originalLine: 12 }, REWRITTEN, "changed"],
    ["a removed base line the head still removes", { side: "LEFT", originalLine: 12 }, INSERTED, "untouched"],
  ])("%s", (_, overrides, after, expected) => {
    expect(threadProgress(thread(overrides), AUTHOR, since(after))).toBe(expected);
  });

  test("on the same base, the rebuilt code decides alike", () => {
    expect(threadProgress(thread({ originalLine: 11 }), AUTHOR, since(REWRITTEN, true))).toBe("untouched");
    expect(threadProgress(thread({ originalLine: 13 }), AUTHOR, since(REWRITTEN, true))).toBe("changed");
    expect(threadProgress(thread({ side: "LEFT", originalLine: 12 }), AUTHOR, since(REWRITTEN, true))).toBe("changed");
    expect(threadProgress(thread({ side: "LEFT", originalLine: 12 }), AUTHOR, since(INSERTED, true))).toBe("untouched");
  });

  test("the diff wins over GitHub's outdated flag, either way", () => {
    expect(threadProgress(thread({ originalLine: 10, outdated: true }), AUTHOR, since(REWRITTEN))).toBe("untouched");
    expect(threadProgress(thread({ originalLine: 13, outdated: false }), AUTHOR, since(REWRITTEN))).toBe("changed");
  });

  test("a thread on a renamed file is found by the path it had when it was written", () => {
    const renamed: VersionFile = { ...REWRITTEN, filename: "b.ts", previousFilename: "a.ts", status: "renamed" };
    const [file] = interdiff([BEFORE], [renamed]);
    expect(file?.oldPath).toBe("a.ts");
    const basis = { head: HEAD, sinceVersion: new Map([[V1, [file!]]]) };
    expect(threadProgress(thread({ originalLine: 13 }), AUTHOR, basis)).toBe("changed");
    expect(threadProgress(thread({ originalLine: 10, outdated: true }), AUTHOR, basis)).toBe("untouched");
  });
});

describe("threadProgress without a diff that shows the lines", () => {
  const noDiff: ProgressBasis = { head: HEAD };

  test.each([
    ["no diff for any version", noDiff],
    ["no diff for the comment's version", { head: HEAD, sinceVersion: new Map([["c5", interdiff([BEFORE], [REWRITTEN])]]) }],
    ["a diff that lacks the file", { head: HEAD, sinceVersion: new Map([[V1, interdiff([], [{ ...REWRITTEN, filename: "other.ts" }])]]) }],
    ["a file GitHub shows no diff of", { head: HEAD, sinceVersion: new Map([[V1, interdiff([{ ...BEFORE, patch: undefined }], [REWRITTEN])]]) }],
    ["a line the diff doesn't show", { head: HEAD, sinceVersion: new Map([[V1, interdiff([BEFORE], [REWRITTEN])]]) }],
  ])("%s falls back on GitHub's outdated flag", (_, basis) => {
    expect(threadProgress(thread({ originalLine: 40, outdated: true }), AUTHOR, basis)).toBe("changed");
    expect(threadProgress(thread({ originalLine: 40, outdated: false }), AUTHOR, basis)).toBe("untouched");
  });

  test("a comment without its commit falls back on the outdated flag", () => {
    const unknown = { comments: [comment("alice", { originalCommit: null })] };
    expect(threadProgress(thread({ ...unknown, outdated: true }), AUTHOR, since(REWRITTEN))).toBe("changed");
    expect(threadProgress(thread(unknown), AUTHOR, since(REWRITTEN))).toBe("untouched");
  });

  test("a comment written on the head can't have seen a change since, whatever the flag says", () => {
    const onHead = [comment("alice", { originalCommit: HEAD })];
    expect(threadProgress(thread({ comments: onHead, outdated: true }), AUTHOR, noDiff)).toBe("untouched");
    expect(threadProgress(thread({ comments: [...onHead, comment(AUTHOR)] }), AUTHOR, noDiff)).toBe("replied");
  });
});

describe("threadProgress and the author's answers", () => {
  const basis = since(REWRITTEN);
  const untouchedOn = { originalLine: 10 };

  test.each<[string, ThreadComment[], ThreadProgress]>([
    ["the author answered", [comment("alice"), comment(AUTHOR)], "replied"],
    ["only another reviewer followed up", [comment("alice"), comment("bob")], "untouched"],
    ["the author answered, then a reviewer followed up", [comment("alice"), comment(AUTHOR), comment("alice")], "replied"],
    ["the author's answer is still a draft", [comment("alice"), comment(AUTHOR, { pending: true })], "untouched"],
    ["the comment has no author left", [comment("alice"), comment("ghost", { author: null })], "untouched"],
  ])("%s", (_, comments, expected) => {
    expect(threadProgress(thread({ ...untouchedOn, comments }), AUTHOR, basis)).toBe(expected);
  });

  test("changed code reads as changed, answered or not", () => {
    expect(threadProgress(thread({ originalLine: 13, comments: [comment("alice"), comment(AUTHOR)] }), AUTHOR, basis)).toBe("changed");
  });

  test("an unknown author never counts as having answered", () => {
    expect(threadProgress(thread({ ...untouchedOn, comments: [comment("alice"), comment(AUTHOR)] }), null, basis)).toBe("untouched");
  });
});

describe("threadProgress on threads with nothing to address", () => {
  test.each([
    ["a resolved thread", thread({ resolved: true })],
    ["a thread of drafts only", thread({ comments: [comment("alice", { pending: true })] })],
    ["a thread without comments", thread({ comments: [] })],
    ["a thread the author started", thread({ comments: [comment(AUTHOR), comment("alice")] })],
  ])("%s has no progress", (_, each) => {
    expect(threadProgress(each, AUTHOR, since(REWRITTEN))).toBeNull();
  });

  test("a draft opening a thread leaves the published comments after it to decide", () => {
    const comments = [comment("alice", { pending: true }), comment("bob"), comment(AUTHOR)];
    expect(threadProgress(thread({ comments }), AUTHOR, since(REWRITTEN))).toBe("replied");
  });
});

describe("progressCounts", () => {
  test("counts each open thread once, by its progress, and leaves out resolved ones", () => {
    const threads = [
      thread({ id: "a", originalLine: 13 }),
      thread({ id: "b", originalLine: 10 }),
      thread({ id: "c", originalLine: 11 }),
      thread({ id: "d", originalLine: 10, comments: [comment("bob"), comment(AUTHOR)] }),
      thread({ id: "e", originalLine: 13, resolved: true }),
      thread({ id: "f", comments: [comment(AUTHOR)] }),
    ];
    expect(progressCounts(threads, AUTHOR, since(REWRITTEN))).toEqual({ changed: 1, untouched: 2, replied: 1 });
  });

  test("no threads count nothing", () => {
    expect(progressCounts([], AUTHOR, { head: HEAD })).toEqual({ changed: 0, untouched: 0, replied: 0 });
  });
});

test.each([
  ["changed", "Code changed since your comment", "Code changed since the comment"],
  ["untouched", "Untouched since your comment", "Untouched since the comment"],
  ["replied", "Replied, code untouched", "Replied, code untouched"],
] as const)("a %s thread reads %p, or %p on someone else's", (progress, yours, theirs) => {
  expect(progressLabel(progress, true)).toBe(yours);
  expect(progressLabel(progress, false)).toBe(theirs);
});

function rough(overrides: Partial<TurnThread> = {}): TurnThread {
  return { resolved: false, outdated: false, starter: "alice", lastSpeaker: "alice", recentSpeakers: ["alice"], ...overrides };
}

describe("roughProgress", () => {
  test("reads GitHub's outdated flag and whether the author spoke lately", () => {
    expect(roughProgress(rough({ outdated: true, recentSpeakers: [AUTHOR] }), AUTHOR)).toBe("changed");
    expect(roughProgress(rough({ recentSpeakers: ["alice", AUTHOR, "alice"] }), AUTHOR)).toBe("replied");
    expect(roughProgress(rough(), AUTHOR)).toBe("untouched");
  });

  test("leaves out resolved threads, the author's own and a bot's, and reads an old cache by its last speaker", () => {
    expect(roughProgress(rough({ resolved: true }), AUTHOR)).toBeNull();
    expect(roughProgress(rough({ starter: AUTHOR }), AUTHOR)).toBeNull();
    expect(roughProgress(rough({ starter: null }), AUTHOR)).toBeNull();
    expect(roughProgress({ resolved: false, starter: "alice", lastSpeaker: AUTHOR }, AUTHOR)).toBe("replied");
  });
});
