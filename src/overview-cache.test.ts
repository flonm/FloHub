import { describe, expect, test } from "bun:test";
import { type CacheIndex, keysToEvict, pickCacheKey } from "./overview-cache";

const NOW = Date.parse("2026-10-13T12:00:00Z");
const DAY = 24 * 3_600_000;
const REF = { owner: "octo-org", repo: "octo-repo", number: 7238 };

describe("pickCacheKey", () => {
  test("prefers the pull request's own overview", () => {
    const index: CacheIndex = {
      "octo-org/octo-repo#7238": { savedAt: NOW - DAY, repo: "octo-org/octo-repo", members: [7237, 7238] },
      "octo-org/octo-repo#7237": { savedAt: NOW, repo: "octo-org/octo-repo", members: [7237, 7238] },
    };
    expect(pickCacheKey(index, REF, NOW)).toEqual({ key: "octo-org/octo-repo#7238", exact: true });
  });

  test("falls back to the newest overview whose stack contains the pull request", () => {
    const index: CacheIndex = {
      "octo-org/octo-repo#7237": { savedAt: NOW - 2 * DAY, repo: "octo-org/octo-repo", members: [7237, 7238] },
      "octo-org/octo-repo#7239": { savedAt: NOW - DAY, repo: "octo-org/octo-repo", members: [7237, 7238, 7239] },
      "octo-org/octo-repo#7300": { savedAt: NOW, repo: "octo-org/octo-repo", members: [7300] },
    };
    expect(pickCacheKey(index, REF, NOW)).toEqual({ key: "octo-org/octo-repo#7239", exact: false });
  });

  test("ignores the same number in another repository", () => {
    const index: CacheIndex = {
      "octo-org/other#7237": { savedAt: NOW, repo: "octo-org/other", members: [7237, 7238] },
    };
    expect(pickCacheKey(index, REF, NOW)).toBeNull();
  });

  test("ignores entries older than a week", () => {
    const index: CacheIndex = {
      "octo-org/octo-repo#7238": { savedAt: NOW - 8 * DAY, repo: "octo-org/octo-repo", members: [7238] },
    };
    expect(pickCacheKey(index, REF, NOW)).toBeNull();
  });
});

describe("keysToEvict", () => {
  test("drops expired entries and the oldest beyond 50", () => {
    const index: CacheIndex = { expired: { savedAt: NOW - 8 * DAY, repo: "o/r", members: [1] } };
    for (let n = 0; n < 51; n++) index[`o/r#${n}`] = { savedAt: NOW - n * 1000, repo: "o/r", members: [n] };
    expect(keysToEvict(index, NOW).sort()).toEqual(["expired", "o/r#50"]);
  });
});
