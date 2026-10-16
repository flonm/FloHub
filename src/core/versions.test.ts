import { describe, expect, test } from "bun:test";
import { baseBranches, baseCandidates, defaultRange, deriveVersions, lastReviewedVersion, pickBase, type RawVersionPull } from "./versions";

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
