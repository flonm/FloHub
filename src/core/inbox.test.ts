import { describe, expect, test } from "bun:test";
import {
  assembleRawInbox,
  buildInbox,
  chunk,
  inboxIds,
  isStale,
  othersReviews,
  type RawInbox,
  type RawInboxIds,
  type RawInboxPull,
  STALE_AFTER_MS,
} from "./inbox";

function buildPull(number: number, overrides: Partial<RawInboxPull> = {}): RawInboxPull {
  return {
    id: `PR_${number}`,
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

function requestedAt(createdAt: string): Partial<RawInboxPull> {
  return { reviewRequestedEvents: { nodes: [{ createdAt, requestedReviewer: { combinedSlug: "octo-org/core" } }] } };
}

function buildRaw(review: RawInboxPull[], mine: RawInboxPull[] = [], waiting: RawInboxPull[] = []): RawInbox {
  return { viewer: { login: "octocat" }, review: { nodes: review }, mine: { nodes: mine }, waiting: { nodes: waiting } };
}

function reviewedBy(login: string, state: string, opinion: string | null, submittedAt = "2026-10-11T09:00:00Z"): Partial<RawInboxPull> {
  return {
    reviewRequests: { nodes: [] },
    latestReviews: { nodes: [{ state, author: { login }, submittedAt }] },
    latestOpinionatedReviews: { nodes: opinion ? [{ state: opinion, author: { login } }] : [] },
  };
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
      "Ready to merge",
      "Draft",
    ]);
  });

  test("marks a review request the viewer already answered once as re-requested", () => {
    const inbox = buildInbox(
      buildRaw([buildPull(1, { latestReviews: { nodes: [{ author: { login: "octocat" }, submittedAt: "2026-10-10T10:00:00Z" }] } }), buildPull(2)]),
      0,
    );
    const rerequested = inbox.review.flatMap((entry) => entry.pulls.map((pull) => [pull.number, pull.rerequested] as const));
    expect(rerequested.toSorted(([a], [b]) => a - b)).toEqual([
      [1, true],
      [2, false],
    ]);
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
    const reviewed = { latestReviews: { nodes: [{ author: { login: "octocat" }, submittedAt: "2026-10-11T09:00:00Z" }] } };
    const inbox = buildInbox(
      buildRaw([
        buildPull(1, { ...team, ...requestedAt("2026-10-10T09:00:00Z") }),
        buildPull(2, { ...team, ...requestedAt("2026-10-10T09:00:00Z"), ...reviewed }),
        buildPull(3, { ...team, ...requestedAt("2026-10-12T09:00:00Z"), ...reviewed }),
      ]),
      0,
    );
    expect(inbox.review.flatMap((entry) => entry.pulls.map((pull) => pull.number)).toSorted((a, b) => a - b)).toEqual([1, 3]);
  });

  test("in a repository set to direct requests only, drops team requests from the list and the badge", () => {
    const team = { reviewRequests: { nodes: [{ requestedReviewer: { combinedSlug: "octo-org/core" } }] } };
    const elsewhere = { repository: { nameWithOwner: "octo-org/other" } };
    const inbox = buildInbox(
      buildRaw([buildPull(1, team), buildPull(2), buildPull(3, { ...team, ...elsewhere })]),
      0,
      new Set(["octo-org/octo-repo"]),
    );
    const entries = inbox.review.map((entry) => [entry.repo, entry.pulls[0]?.number, entry.pulls[0]?.viaTeam] as const);
    expect(entries.toSorted(([a], [b]) => a.localeCompare(b))).toEqual([
      ["octo-org/octo-repo", 2, false],
      ["octo-org/other", 3, true],
    ]);
    expect(inbox.reviewCount).toBe(2);
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

function waitingNumbers(pulls: RawInboxPull[]): number[] {
  return (buildInbox(buildRaw([], [], pulls), 0).waiting ?? []).flatMap((entry) => entry.pulls.map((pull) => pull.number));
}

describe("buildInbox waiting for author", () => {
  test("keeps pull requests the viewer requested changes on or only commented on", () => {
    const inbox = buildInbox(
      buildRaw([], [], [buildPull(1, reviewedBy("octocat", "CHANGES_REQUESTED", "CHANGES_REQUESTED")), buildPull(2, reviewedBy("octocat", "COMMENTED", null))]),
      0,
    );
    expect(inbox.waiting?.flatMap((entry) => entry.pulls.map((pull) => [pull.number, pull.yourVerdict]))).toEqual([
      [1, "changes_requested"],
      [2, "commented"],
    ]);
  });

  test("keeps a change request the viewer followed with a comment", () => {
    expect(waitingNumbers([buildPull(1, reviewedBy("octocat", "COMMENTED", "CHANGES_REQUESTED"))])).toEqual([1]);
  });

  test("leaves out approved and dismissed reviews, even when a comment followed", () => {
    expect(
      waitingNumbers([buildPull(1, reviewedBy("octocat", "COMMENTED", "APPROVED")), buildPull(2, reviewedBy("octocat", "DISMISSED", "DISMISSED"))]),
    ).toEqual([]);
  });

  test("leaves out pull requests that ask the viewer to review again", () => {
    expect(waitingNumbers([buildPull(1, { ...reviewedBy("octocat", "CHANGES_REQUESTED", "CHANGES_REQUESTED"), reviewRequests: { nodes: [{ requestedReviewer: { login: "octocat" } }] } })])).toEqual([]);
  });

  test("leaves out the viewer's own pull requests and those only others reviewed", () => {
    expect(
      waitingNumbers([
        buildPull(1, { ...reviewedBy("octocat", "COMMENTED", null), author: { login: "octocat", avatarUrl: "https://avatars.githubusercontent.com/octocat" } }),
        buildPull(2, reviewedBy("mojombo", "CHANGES_REQUESTED", "CHANGES_REQUESTED")),
      ]),
    ).toEqual([]);
  });

  test("falls back to the latest review when the viewer has no verdict as a writer", () => {
    expect(waitingNumbers([buildPull(1, reviewedBy("octocat", "CHANGES_REQUESTED", null))])).toEqual([1]);
  });

  test("marks pull requests the author pushed to after the viewer's review", () => {
    const review = reviewedBy("octocat", "CHANGES_REQUESTED", "CHANGES_REQUESTED", "2026-10-11T09:00:00Z");
    const inbox = buildInbox(
      buildRaw(
        [],
        [],
        [
          buildPull(1, { ...review, timelineItems: { nodes: [{ __typename: "PullRequestCommit", commit: { committedDate: "2026-10-12T09:00:00Z" } }] } }),
          buildPull(2, { ...review, timelineItems: { nodes: [{ __typename: "HeadRefForcePushedEvent", createdAt: "2026-10-10T09:00:00Z" }] } }),
        ],
      ),
      0,
    );
    expect(inbox.waiting?.flatMap((entry) => entry.pulls.map((pull) => [pull.number, pull.pushedSinceReview]))).toEqual([
      [1, true],
      [2, false],
    ]);
  });

  test("leaves the badge to review requests", () => {
    const inbox = buildInbox(buildRaw([], [], [buildPull(1, reviewedBy("octocat", "COMMENTED", null))]), 0);
    expect(inbox.reviewCount).toBe(0);
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

/** An issue the searches found, which comes back as an empty object. */
const ISSUE: Record<string, never> = {};

function idNodes(numbers: (number | null)[] = []): RawInboxIds["review"] {
  return { nodes: numbers.map((number) => (number === null ? ISSUE : { id: `PR_${number}` })) };
}

function idsOf(sections: Partial<Record<"review" | "mine" | "waiting", (number | null)[]>>): RawInboxIds {
  return { viewer: { login: "octocat" }, review: idNodes(sections.review), mine: idNodes(sections.mine), waiting: idNodes(sections.waiting) };
}

function numbersOf(section: RawInbox["review"] | undefined): (number | undefined)[] | undefined {
  return section?.nodes.map((node) => node.number);
}

describe("inboxIds", () => {
  test("lists a pull request two searches found once, and skips issues", () => {
    expect(inboxIds(idsOf({ review: [1, null, 2], mine: [3], waiting: [2] }))).toEqual(["PR_1", "PR_2", "PR_3"]);
  });

  test("is empty when every search is", () => {
    expect(inboxIds(idsOf({}))).toEqual([]);
  });
});

describe("chunk", () => {
  test.each<{ items: number[]; chunks: number[][] }>([
    { items: [], chunks: [] },
    { items: [1, 2, 3, 4], chunks: [[1, 2], [3, 4]] },
    { items: [1, 2, 3], chunks: [[1, 2], [3]] },
  ])("cuts $items into $chunks", ({ items, chunks }) => {
    expect(chunk(items, 2)).toEqual(chunks);
  });
});

describe("assembleRawInbox", () => {
  const details = new Map([1, 2, 3].map((number) => [`PR_${number}`, buildPull(number)]));

  test("keeps each search's order and puts a pull request into every search that found it", () => {
    const raw = assembleRawInbox(idsOf({ review: [3, 1], mine: [2], waiting: [1] }), details);

    expect(raw.viewer.login).toBe("octocat");
    expect(numbersOf(raw.review)).toEqual([3, 1]);
    expect(numbersOf(raw.mine)).toEqual([2]);
    expect(numbersOf(raw.waiting)).toEqual([1]);
  });

  test("leaves out issues and pull requests whose details didn't come back", () => {
    const raw = assembleRawInbox(idsOf({ review: [1, null, 4] }), details);

    expect(numbersOf(raw.review)).toEqual([1]);
    expect(raw.mine.nodes).toEqual([]);
  });
});

function latest(login: string, state: string, avatarUrl?: string) {
  return { state, author: { login, ...(avatarUrl && { avatarUrl }) }, submittedAt: "2026-10-20T10:00:00Z" };
}

describe("othersReviews", () => {
  test("lists everyone else's latest verdict, change requests first, without the viewer's or the author's own", () => {
    const pull = {
      author: { login: "hubot", avatarUrl: "https://avatars/hubot" },
      latestReviews: {
        nodes: [
          latest("mona", "APPROVED", "https://avatars/mona"),
          latest("octocat", "COMMENTED"),
          latest("me", "CHANGES_REQUESTED"),
          latest("hubot", "COMMENTED"),
          latest("wycats", "CHANGES_REQUESTED"),
          latest("pending", "PENDING"),
          { state: "APPROVED", author: null, submittedAt: null },
        ],
      },
    };
    expect(othersReviews(pull, "me")).toEqual([
      { login: "wycats", avatarUrl: null, verdict: "changes_requested" },
      { login: "mona", avatarUrl: "https://avatars/mona", verdict: "approved" },
      { login: "octocat", avatarUrl: null, verdict: "commented" },
    ]);
  });
});
