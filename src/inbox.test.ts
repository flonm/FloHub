import { describe, expect, test } from "bun:test";
import { buildInbox, isStale, type RawInbox, type RawInboxPull, STALE_AFTER_MS } from "./inbox";

function buildPull(number: number, overrides: Partial<RawInboxPull> = {}): RawInboxPull {
  return {
    number,
    title: `feat: layer ${number}`,
    url: `https://github.com/octo-org/octo-repo/pull/${number}`,
    state: "OPEN",
    isDraft: false,
    mergeable: "MERGEABLE",
    reviewDecision: "REVIEW_REQUIRED",
    createdAt: "2026-10-10T09:00:00Z",
    lastEditedAt: null,
    mergedAt: null,
    statusCheckRollup: { state: "SUCCESS" },
    latestOpinionatedReviews: { nodes: [] },
    reviewThreads: { totalCount: 0, nodes: [] },
    timelineItems: { nodes: [] },
    additions: 0,
    deletions: 0,
    repository: { nameWithOwner: "octo-org/octo-repo" },
    author: { login: "hubot", avatarUrl: "https://avatars.githubusercontent.com/hubot" },
    latestReviews: { nodes: [] },
    reviewRequests: { nodes: [{ requestedReviewer: { login: "octocat" } }] },
    reviewRequestedEvents: { nodes: [] },
    stack: null,
    ...overrides,
  };
}

function stackOf(number: number, members: number[]): RawInboxPull["stack"] {
  return {
    number,
    size: members.length,
    entries: { nodes: members.map((member, index) => ({ position: index + 1, pullRequest: { number: member } })) },
  };
}

function buildRaw(review: RawInboxPull[], mine: RawInboxPull[] = []): RawInbox {
  return { viewer: { login: "octocat" }, review: { nodes: review }, mine: { nodes: mine } };
}

describe("buildInbox", () => {
  test("groups the layers of one stack, top first", () => {
    const stack = stackOf(10, [10, 11, 12]);
    const inbox = buildInbox(buildRaw([buildPull(10, { stack }), buildPull(12, { stack })]), 0);
    expect(inbox.review.map((entry) => entry.pulls.map((pull) => [pull.number, pull.position]))).toEqual([
      [
        [12, 3],
        [10, 1],
      ],
    ]);
    expect(inbox.review[0]).toMatchObject({ stackNumber: 10, stackSize: 3 });
  });

  test("orders review requests by their latest activity", () => {
    const inbox = buildInbox(
      buildRaw([buildPull(1, { createdAt: "2026-10-01T09:00:00Z" }), buildPull(2, { createdAt: "2026-10-12T09:00:00Z" })]),
      0,
    );
    expect(inbox.review.map((entry) => entry.pulls[0]?.number)).toEqual([2, 1]);
  });

  test("orders the viewer's own pull requests by what needs them first", () => {
    const inbox = buildInbox(
      buildRaw(
        [],
        [
          buildPull(1, { reviewDecision: "APPROVED" }),
          buildPull(2, { isDraft: true }),
          buildPull(3, { statusCheckRollup: { state: "FAILURE" } }),
          buildPull(4, { reviewDecision: "CHANGES_REQUESTED" }),
        ],
      ),
      0,
    );
    expect(inbox.mine.map((entry) => entry.pulls[0]?.label)).toEqual([
      "Checks failed",
      "Changes requested",
      "Approved",
      "Draft",
    ]);
  });

  test("marks a review request the viewer already answered once as re-requested", () => {
    const inbox = buildInbox(
      buildRaw([buildPull(1, { latestReviews: { nodes: [{ author: { login: "octocat" }, submittedAt: "2026-10-10T10:00:00Z" }] } }), buildPull(2)]),
      0,
    );
    expect(inbox.review.flatMap((entry) => entry.pulls.map((pull) => [pull.number, pull.rerequested]))).toEqual(
      expect.arrayContaining([
        [1, true],
        [2, false],
      ]),
    );
  });

  test("leaves out drafts and pull requests that no longer ask the viewer", () => {
    const inbox = buildInbox(
      buildRaw([
        buildPull(1),
        buildPull(2, { isDraft: true }),
        buildPull(3, { reviewRequests: { nodes: [] } }),
        buildPull(4, { reviewRequests: { nodes: [{ requestedReviewer: { login: "hubot" } }] } }),
      ]),
      0,
    );
    expect(inbox.review.flatMap((entry) => entry.pulls.map((pull) => pull.number))).toEqual([1]);
    expect(inbox.reviewCount).toBe(1);
  });

  test("keeps a team request until the viewer reviews, and again once the team is re-requested", () => {
    const team = { reviewRequests: { nodes: [{ requestedReviewer: { combinedSlug: "octo-org/core" } }] } };
    const requestedAt = (createdAt: string) => ({
      reviewRequestedEvents: { nodes: [{ createdAt, requestedReviewer: { combinedSlug: "octo-org/core" } }] },
    });
    const reviewed = { latestReviews: { nodes: [{ author: { login: "octocat" }, submittedAt: "2026-10-11T09:00:00Z" }] } };
    const inbox = buildInbox(
      buildRaw([
        buildPull(1, { ...team, ...requestedAt("2026-10-10T09:00:00Z") }),
        buildPull(2, { ...team, ...requestedAt("2026-10-10T09:00:00Z"), ...reviewed }),
        buildPull(3, { ...team, ...requestedAt("2026-10-12T09:00:00Z"), ...reviewed }),
      ]),
      0,
    );
    expect(inbox.review.flatMap((entry) => entry.pulls.map((pull) => pull.number)).sort()).toEqual([1, 3]);
  });

  test("carries each pull request's added and deleted lines", () => {
    const raw: RawInbox = { viewer: { login: "octocat" }, review: { nodes: [buildPull(7, { additions: 120, deletions: 34 })] }, mine: { nodes: [] } };

    expect(buildInbox(raw, 0).review[0]?.pulls[0]).toMatchObject({ additions: 120, deletions: 34 });
  });

  test("counts review requests for the badge and skips search hits that are not pull requests", () => {
    const inbox = buildInbox({ ...buildRaw([buildPull(1), buildPull(2)]), mine: { nodes: [{}] } }, 0);
    expect(inbox.reviewCount).toBe(2);
    expect(inbox.mine).toEqual([]);
  });
});

describe("isStale", () => {
  const lastActivity = "2026-10-10T09:00:00Z";
  const then = Date.parse(lastActivity);

  test("flags a pull request without activity for two days", () => {
    expect(isStale({ lastActivity }, then + STALE_AFTER_MS)).toBe(true);
  });

  test("leaves a recently active pull request alone", () => {
    expect(isStale({ lastActivity }, then + STALE_AFTER_MS - 1)).toBe(false);
  });
});
