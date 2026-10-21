import { describe, expect, test } from "bun:test";
import { type CommentPlace, commentJump } from "./comment-jump";
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
    expect(jump?.current).toBeNull();
  });

  test("a comment on the current head has nothing since, and its lines in the current diff", () => {
    const jump = commentJump(VERSIONS, comment({ originalCommit: "v3", originalLine: 107, line: 107 }), NOW);
    expect(jump?.since).toBeNull();
    expect(jump?.at.range).toEqual({ from: "base", to: "v3", toCurrent: true, at: NOW });
    expect(jump?.current).toEqual({ path: "src/a.ts", line: 107, side: "RIGHT" });
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
