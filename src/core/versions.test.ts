import { describe, expect, test } from "bun:test";
import {
  BASE,
  baseBranches,
  baseCandidates,
  carryRange,
  commentVersion,
  defaultRange,
  deriveVersions,
  formatRangeParam,
  keepRecentRanges,
  lastReviewedVersion,
  parseRangeParam,
  pickBase,
  pickOnTimeline,
  rangeParam,
  rangeToSave,
  type RawVersionPull,
  restoreRange,
  type SavedRange,
  shortVersion,
  type Version,
} from "./versions";

const commit = (oid: string, committedDate: string) => ({ oid, committedDate });

const pull = (overrides: Partial<RawVersionPull> = {}): RawVersionPull => ({
  baseRefName: "main",
  baseRefOid: "base",
  headRefOid: "v3",
  createdAt: "2026-10-01T00:00:00Z",
  commits: { nodes: [{ commit: commit("v3", "2026-10-03T09:00:00Z") }] },
  timelineItems: {
    nodes: [
      {
        __typename: "HeadRefForcePushedEvent",
        createdAt: "2026-10-02T10:00:00Z",
        actor: { login: "ana" },
        beforeCommit: commit("v1", "2026-10-01T08:00:00Z"),
        afterCommit: commit("v2", "2026-10-02T09:55:00Z"),
      },
      {
        __typename: "HeadRefForcePushedEvent",
        createdAt: "2026-10-03T10:00:00Z",
        actor: { login: "ben" },
        beforeCommit: commit("v2", "2026-10-02T09:55:00Z"),
        afterCommit: commit("v3", "2026-10-03T09:00:00Z"),
      },
    ],
  },
  reviews: { nodes: [] },
  ...overrides,
});

describe("deriveVersions", () => {
  test("orders both sides of every force push, current head last", () => {
    const { versions } = deriveVersions(pull(), [], "me");
    expect(versions.map((version) => [version.number, version.oid, version.pushedBy, version.current])).toEqual([
      [1, "v1", null, false],
      [2, "v2", "ana", false],
      [3, "v3", "ben", true],
    ]);
  });

  test("adds reviewed commits from plain pushes and marks the viewer's latest review", () => {
    const { versions } = deriveVersions(
      pull({
        reviews: {
          nodes: [
            { author: { login: "me" }, submittedAt: null, commit: commit("v1", "2026-10-01T08:00:00Z") },
            { author: { login: "cleo" }, submittedAt: null, commit: commit("v1b", "2026-10-01T12:00:00Z") },
            { author: { login: "me" }, submittedAt: null, commit: commit("v1b", "2026-10-01T12:00:00Z") },
          ],
        },
      }),
      [],
      "me",
    );
    expect(versions.map((version) => version.oid)).toEqual(["v1", "v1b", "v2", "v3"]);
    expect(versions[1]).toMatchObject({ reviewedBy: ["cleo", "me"], viewerLatestReview: true });
    expect(versions[0]?.viewerLatestReview).toBe(false);
  });

  test("skips events whose commits GitHub no longer has", () => {
    const { versions } = deriveVersions(
      pull({ timelineItems: { nodes: [null, { __typename: "HeadRefForcePushedEvent", beforeCommit: null, afterCommit: null }] } }),
      [],
      "me",
    );
    expect(versions.map((version) => version.oid)).toEqual(["v3"]);
  });

  test("collects the base branch's heads", () => {
    const { baseHeads } = deriveVersions(pull(), [
      {
        headRefOid: "p2",
        commits: { nodes: [{ commit: commit("p2", "2026-10-03T08:00:00Z") }] },
        timelineItems: {
          nodes: [
            {
              __typename: "HeadRefForcePushedEvent",
              createdAt: "2026-10-03T08:30:00Z",
              beforeCommit: commit("p1", "2026-10-01T07:00:00Z"),
              afterCommit: commit("p2", "2026-10-03T08:00:00Z"),
            },
          ],
        },
      },
    ], "me");
    expect(baseHeads).toEqual([
      { oid: "p1", at: "2026-10-01T07:00:00Z" },
      { oid: "p2", at: "2026-10-03T08:00:00Z" },
    ]);
  });
});

describe("baseBranches", () => {
  test("lists the current base and every earlier one", () => {
    const raw = pull({
      timelineItems: {
        nodes: [
          { __typename: "BaseRefChangedEvent", previousRefName: "feature-a" },
          { __typename: "BaseRefChangedEvent", previousRefName: "feature-b" },
          { __typename: "AutomaticBaseChangeSucceededEvent", oldBase: "feature-c" },
        ],
      },
    });
    expect(baseBranches(raw)).toEqual(["main", "feature-c", "feature-b", "feature-a"]);
  });
});

describe("baseCandidates", () => {
  test("tries the current base, then the base's heads from before the version, newest first", () => {
    const history = {
      baseRefOid: "p3",
      versions: [],
      baseHeads: [
        { oid: "p1", at: "2026-10-01T00:00:00Z" },
        { oid: "p2", at: "2026-10-02T00:00:00Z" },
        { oid: "p3", at: "2026-10-04T00:00:00Z" },
        { oid: "p4", at: "2026-10-05T00:00:00Z" },
      ],
    };
    const version = { oid: "v", number: 1, at: "2026-10-03T00:00:00Z", pushedBy: null, reviewedBy: [], viewerLatestReview: false, current: false };
    expect(baseCandidates(history, version)).toEqual(["p3", "p2", "p1", "p4"]);
  });
});

describe("defaultRange", () => {
  test("compares the viewer's last reviewed version with the current one", () => {
    const { versions } = deriveVersions(
      pull({ reviews: { nodes: [{ author: { login: "me" }, submittedAt: null, commit: commit("v1", "2026-10-01T08:00:00Z") }] } }),
      [],
      "me",
    );
    expect(defaultRange(versions)).toEqual({ from: 1, to: 3 });
  });

  test("falls back to the previous version", () => {
    expect(defaultRange(deriveVersions(pull(), [], "me").versions)).toEqual({ from: 2, to: 3 });
  });

  test("needs two versions", () => {
    expect(defaultRange(deriveVersions(pull({ timelineItems: { nodes: [] } }), [], "me").versions)).toBeNull();
  });
});

describe("version order", () => {
  test("follows when each version was the head, not its commit date", () => {
    // A date-preserving rebase: v2's commit is dated before v1's.
    const { versions } = deriveVersions(
      pull({
        headRefOid: "v2",
        commits: { nodes: [{ commit: commit("v2", "2026-09-01T00:00:00Z") }] },
        timelineItems: {
          nodes: [
            {
              __typename: "HeadRefForcePushedEvent",
              createdAt: "2026-10-02T10:00:00Z",
              actor: { login: "ana" },
              beforeCommit: commit("v1", "2026-10-01T08:00:00Z"),
              afterCommit: commit("v2", "2026-09-01T00:00:00Z"),
            },
          ],
        },
        reviews: {
          nodes: [
            // Reviewed between the two pushes, on a cherry-pick dated long before.
            { author: { login: "me" }, submittedAt: "2026-10-01T12:00:00Z", commit: commit("v1b", "2026-08-01T00:00:00Z") },
          ],
        },
      }),
      [],
      "me",
    );
    expect(versions.map((version) => version.oid)).toEqual(["v1b", "v1", "v2"]);
  });

  test("ignores fork pull requests that share the base branch's name", () => {
    const fork = {
      headRefOid: "fork-head",
      isCrossRepository: true,
      commits: { nodes: [{ commit: commit("fork-head", "2026-10-01T00:00:00Z") }] },
      timelineItems: { nodes: [] },
    };
    expect(deriveVersions(pull(), [fork], "me").baseHeads).toEqual([]);
  });
});

describe("pickBase", () => {
  test("prefers a stale ancestor's closer rival: the current base's merge base", () => {
    // git-flow: an old develop→main release head is an ancestor, 40 commits back; the merge base with develop is 3 back.
    expect(pickBase([{ onBase: false, aheadBy: 3 }, { onBase: true, aheadBy: 40 }])).toBe(0);
  });

  test("takes the base branch's earlier head an old stacked version was made on", () => {
    // The parent was restacked since, so the merge base with its current head lies far back on main.
    expect(pickBase([{ onBase: false, aheadBy: 14 }, { onBase: true, aheadBy: 30 }, { onBase: true, aheadBy: 7 }])).toBe(2);
  });

  test("never takes a candidate the version doesn't descend from", () => {
    expect(pickBase([{ onBase: false, aheadBy: 9 }, { onBase: false, aheadBy: 2 }])).toBe(0);
  });
});

describe("lastReviewedVersion", () => {
  test("is the viewer's last reviewed version, unless that is the current one", () => {
    const reviewed = (oid: string, submittedAt: string) =>
      deriveVersions(pull({ reviews: { nodes: [{ author: { login: "me" }, submittedAt, commit: commit(oid, "2026-10-01T08:00:00Z") }] } }), [], "me").versions;
    expect(lastReviewedVersion(reviewed("v2", "2026-10-02T12:00:00Z"))?.number).toBe(2);
    expect(lastReviewedVersion(reviewed("v3", "2026-10-03T12:00:00Z"))).toBeNull();
    expect(lastReviewedVersion(deriveVersions(pull(), [], "me").versions)).toBeNull();
  });
});

describe("remembered ranges", () => {
  const NOW = Date.parse("2026-10-21T12:00:00Z");
  const DAY = 86_400_000;
  const { versions } = deriveVersions(pull(), [], "me");
  /** The same pull request after another force push, v3 → v4. */
  const pushed = deriveVersions(
    pull({
      headRefOid: "v4",
      commits: { nodes: [{ commit: commit("v4", "2026-10-04T09:00:00Z") }] },
      timelineItems: {
        nodes: [
          ...pull().timelineItems.nodes,
          {
            __typename: "HeadRefForcePushedEvent",
            createdAt: "2026-10-04T10:00:00Z",
            actor: { login: "ana" },
            beforeCommit: commit("v3", "2026-10-03T09:00:00Z"),
            afterCommit: commit("v4", "2026-10-04T09:00:00Z"),
          },
        ],
      },
    }),
    [],
    "me",
  ).versions;
  const saved = (overrides: Partial<SavedRange> = {}): SavedRange => ({ from: "v1", to: "v2", toCurrent: false, at: NOW, ...overrides });

  test("a saved range is kept by commit, with a flag for a newer side that was the head", () => {
    expect(rangeToSave(versions, 1, 3, NOW)).toEqual({ from: "v1", to: "v3", toCurrent: true, at: NOW });
    expect(rangeToSave(versions, 1, 2, NOW)).toEqual({ from: "v1", to: "v2", toCurrent: false, at: NOW });
  });

  test("a version compared with itself isn't worth restoring", () => {
    expect(rangeToSave(versions, 2, 2, NOW)).toBeNull();
  });

  test("the dialog opens on the saved range", () => {
    expect(restoreRange(versions, saved())).toEqual({ from: 1, to: 2 });
  });

  test("a saved newer side that was the head follows the head to later pushes", () => {
    expect(restoreRange(pushed, saved({ to: "v3", toCurrent: true }))).toEqual({ from: 1, to: 4 });
    expect(restoreRange(pushed, saved({ to: "v3", toCurrent: false }))).toEqual({ from: 1, to: 3 });
  });

  test("without a saved range, or with one whose commits are gone, the dialog opens on the default range", () => {
    expect(restoreRange(versions, null)).toEqual(defaultRange(versions));
    expect(restoreRange(versions, saved({ from: "gone" }))).toEqual(defaultRange(versions));
  });

  test("a saved range never narrows a pull request with one version", () => {
    expect(restoreRange(versions.slice(-1), saved())).toBeNull();
  });

  test("a refresh keeps the range on screen by commit, and moves a newer side that was the head", () => {
    expect(carryRange(versions, pushed, 1, 2)).toEqual({ from: 1, to: 2 });
    expect(carryRange(versions, pushed, 1, 3)).toEqual({ from: 1, to: 4 });
    expect(carryRange(versions, pushed.slice(1), 1, 2)).toBeNull();
  });

  test("only the month's most recently picked ranges are kept", () => {
    const ranges = Object.fromEntries(Array.from({ length: 120 }, (_, index) => [`o/r#${index}`, saved({ at: NOW - index * 60_000 })]));
    ranges["o/r#old"] = saved({ at: NOW - 31 * DAY });
    const kept = keepRecentRanges(ranges, NOW);
    expect(Object.keys(kept)).toHaveLength(100);
    expect(kept["o/r#0"]).toBeDefined();
    expect(kept["o/r#99"]).toBeDefined();
    expect(kept["o/r#100"]).toBeUndefined();
    expect(kept["o/r#old"]).toBeUndefined();
  });
});

describe("the range in the URL", () => {
  const NOW = Date.parse("2026-10-21T12:00:00Z");
  const { versions } = deriveVersions(pull({ headRefOid: "c3c3c3c3c3", commits: { nodes: [{ commit: commit("c3c3c3c3c3", "2026-10-03T09:00:00Z") }] }, timelineItems: { nodes: [] }, reviews: { nodes: [{ author: { login: "me" }, submittedAt: "2026-10-02T12:00:00Z", commit: commit("a1a1a1a1a1", "2026-10-01T08:00:00Z") }] } }), [], "me");

  test("names both sides by their short commit, and leaves a newer side that is the head empty", () => {
    expect(formatRangeParam(versions[0]!, versions[1]!)).toBe("a1a1a1a..");
    expect(formatRangeParam(versions[1]!, versions[0]!)).toBe("c3c3c3c..a1a1a1a");
  });

  test("a link opens on the range it names, its empty newer side on the current head", () => {
    expect(restoreRange(versions, parseRangeParam("a1a1a1a..", NOW))).toEqual({ from: 1, to: 2 });
    expect(restoreRange(versions, parseRangeParam("c3c3c3c..a1a1a1a", NOW))).toEqual({ from: 2, to: 1 });
  });

  test.each(["", "..", "main..HEAD", "a1a1..", "a1a1a1a"])("%p opens on the remembered range instead", (value) => {
    expect(parseRangeParam(value, NOW)).toBeNull();
  });
});

describe("the base branch as the older side", () => {
  const NOW = Date.parse("2026-10-21T12:00:00Z");
  const { versions } = deriveVersions(pull(), [], "me");

  test("is saved, linked and restored as base, so the view shows a version's own changes", () => {
    const saved = rangeToSave(versions, 0, 2, NOW);
    expect(saved).toEqual({ from: BASE, to: "v2", toCurrent: false, at: NOW });
    expect(restoreRange(versions, saved)).toEqual({ from: 0, to: 2 });
    expect(formatRangeParam(null, versions[2]!)).toBe("base..");
    expect(restoreRange(versions, parseRangeParam("base..", NOW))).toEqual({ from: 0, to: 3 });
  });

  test("stays the base through a refresh", () => {
    expect(carryRange(versions, versions, 0, 3)).toEqual({ from: 0, to: 3 });
  });
});

describe("commentVersion", () => {
  const { versions } = deriveVersions(pull(), [], "me");

  test("is the version the comment was written on", () => {
    expect(commentVersion(versions, "v2", "2026-10-02T12:00:00Z")).toEqual({ version: versions[1]!, exact: true });
  });

  test("for a commit no version lists, is the head when the comment was written", () => {
    expect(commentVersion(versions, "gone", "2026-10-02T12:00:00Z")).toEqual({ version: versions[1]!, exact: false });
    expect(commentVersion(versions, "gone", "2026-09-01T00:00:00Z")).toEqual({ version: versions[0]!, exact: false });
  });

  test("finds nothing without versions", () => {
    expect(commentVersion([], "v1", "2026-10-02T12:00:00Z")).toBeNull();
  });
});

describe("rangeParam", () => {
  test("writes a saved range as the URL keeps it", () => {
    expect(rangeParam({ from: "a1a1a1a1a1", to: "", toCurrent: true, at: 0 })).toBe("a1a1a1a..");
    expect(rangeParam({ from: BASE, to: "c3c3c3c3c3", toCurrent: false, at: 0 })).toBe("base..c3c3c3c");
  });
});

describe("picking on the timeline", () => {
  test.each([
    ["an older version moves the older side", { from: 2, to: 4 }, 1, false, { from: 1, to: 4 }],
    ["the base branch moves the older side", { from: 2, to: 4 }, 0, false, { from: 0, to: 4 }],
    ["a version inside the range narrows it from the older side", { from: 1, to: 4 }, 3, false, { from: 3, to: 4 }],
    ["a later version moves the newer side", { from: 1, to: 3 }, 5, false, { from: 1, to: 5 }],
    ["Shift picks the newer side inside the range", { from: 1, to: 4 }, 3, true, { from: 1, to: 3 }],
    ["Shift on an older version still moves the older side", { from: 2, to: 4 }, 1, true, { from: 1, to: 4 }],
  ])("%s", (_rule, range, picked, newer, expected) => {
    expect(pickOnTimeline(range, picked, newer)).toEqual(expected);
  });

  test("picking either end changes nothing", () => {
    expect(pickOnTimeline({ from: 1, to: 3 }, 1)).toBeNull();
    expect(pickOnTimeline({ from: 1, to: 3 }, 3, true)).toBeNull();
  });
});

function aVersion(overrides: Partial<Version>): Version {
  return {
    oid: "aaaaaaa1",
    number: 2,
    at: "2026-10-23T09:00:00Z",
    pushedBy: null,
    reviewedBy: [],
    viewerLatestReview: false,
    current: false,
    ...overrides,
  };
}

describe("a version in a few words", () => {
  const now = Date.parse("2026-10-23T12:00:00Z");

  test.each([
    ["the base branch", undefined, { name: "Base", tag: null, review: false }],
    ["the viewer's review first", aVersion({ viewerLatestReview: true, current: true }), { name: "v2", tag: "your review", review: true }],
    ["then the current head", aVersion({ current: true }), { name: "v2", tag: "current", review: false }],
    ["else its age", aVersion({}), { name: "v2", tag: "3h", review: false }],
  ])("%s", (_case, given, expected) => {
    expect(shortVersion(given, now)).toEqual(expected);
  });
});
