import { describe, expect, test } from "bun:test";
import type { VersionPatch } from "./github";
import { keepRecentHistories, type PatchIndex, patchesToEvict, patchKey, samePatch } from "./version-cache";

const NOW = Date.parse("2026-10-21T12:00:00Z");
const DAY = 86_400_000;
const REF = { owner: "octo-org", repo: "octo-repo", number: 7238 };

describe("patchKey", () => {
  test("names a patch by its commit and every base it was compared with", () => {
    expect(patchKey(REF, "head", ["main", "old-parent"])).toBe("octo-org/octo-repo:head:main,old-parent");
    expect(patchKey(REF, "head", ["main"])).not.toBe(patchKey(REF, "head", ["main", "old-parent"]));
  });
});

describe("patchesToEvict", () => {
  test("drops patches unused for more than three days", () => {
    const index: PatchIndex = { fresh: NOW - DAY, stale: NOW - 4 * DAY };
    expect(patchesToEvict(index, NOW)).toEqual(["stale"]);
  });

  test("keeps only the sixteen most recently used", () => {
    const index: PatchIndex = Object.fromEntries(Array.from({ length: 20 }, (_, position) => [`p${position}`, NOW - position * 1000]));
    expect(patchesToEvict(index, NOW)).toEqual(["p16", "p17", "p18", "p19"]);
  });

  test("an empty cache drops nothing", () => {
    expect(patchesToEvict({}, NOW)).toEqual([]);
  });
});

describe("keepRecentHistories", () => {
  const history = { baseRefOid: "base", versions: [], baseHeads: [] };

  test("keeps the thirty most recently fetched histories younger than three days", () => {
    const histories = Object.fromEntries(
      Array.from({ length: 32 }, (_, position) => [`o/r#${position}`, { savedAt: NOW - position * 1000, history }]),
    );
    histories["o/r#old"] = { savedAt: NOW - 4 * DAY, history };
    const kept = keepRecentHistories(histories, NOW);
    expect(Object.keys(kept)).toHaveLength(30);
    expect(kept["o/r#30"]).toBeUndefined();
    expect(kept["o/r#old"]).toBeUndefined();
  });
});

/** @returns A version's patch, one changed file against the merge base. */
function patch(overrides: Partial<VersionPatch> = {}): VersionPatch {
  return {
    mergeBase: "base",
    onBase: true,
    truncated: false,
    files: [{ filename: "a.ts", status: "modified", sha: "a1", patch: "@@ -1 +1 @@\n-a\n+b" }],
    ...overrides,
  };
}

describe("samePatch", () => {
  test("a version diffed against a base that moved on, but from the same merge base, is the same patch", () => {
    expect(samePatch(patch(), patch())).toBe(true);
  });

  test("another merge base, or a file that differs, makes another patch", () => {
    expect(samePatch(patch(), patch({ mergeBase: "newer-base" }))).toBe(false);
    expect(samePatch(patch(), patch({ files: [{ filename: "a.ts", status: "modified", sha: "a2", patch: "@@ -1 +1 @@\n-a\n+c" }] }))).toBe(false);
    expect(samePatch(patch(), patch({ files: [] }))).toBe(false);
  });
});
