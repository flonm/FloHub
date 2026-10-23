import { describe, expect, test } from "bun:test";
import {
  deriveReviewers,
  dismissedVerdicts,
  type RawActor,
  type RawPullRequest,
  type RawReviewState,
  type RawTeam,
} from "./reviewers";

function user(login: string): RawActor {
  return { __typename: "User", login, avatarUrl: `https://avatars/${login}`, url: `https://github.com/${login}` };
}

function bot(login: string): RawActor {
  return { __typename: "Bot", login, avatarUrl: `https://avatars/${login}`, url: `https://github.com/apps/${login}` };
}

function team(combinedSlug: string): RawTeam {
  return { __typename: "Team", name: combinedSlug, combinedSlug, avatarUrl: null, url: `https://github.com/orgs/${combinedSlug}` };
}

function buildPullRequest(options: {
  author?: string;
  viewerCanUpdate?: boolean;
  requested?: (RawActor | RawTeam | null)[];
  reviews?: [RawActor, RawReviewState][];
  /** What each dismissed review had been, by its index in reviews. */
  dismissed?: [number, RawReviewState][];
}): RawPullRequest {
  return {
    author: { login: options.author ?? "hubot" },
    viewerCanUpdate: options.viewerCanUpdate ?? true,
    reviewRequests: {
      nodes: (options.requested ?? []).map((requestedReviewer) => ({ requestedReviewer })),
    },
    reviews: {
      nodes: (options.reviews ?? []).map(([author, state], index) => ({
        author,
        state,
        submittedAt: `2026-10-0${index + 1}T00:00:00Z`,
        url: reviewUrl(index),
        id: `PRR_${index}`,
      })),
    },
    ...(options.dismissed && {
      dismissals: {
        nodes: options.dismissed.map(([index, previousReviewState]) => ({ previousReviewState, review: { url: reviewUrl(index) } })),
      },
    }),
  };
}

function reviewUrl(index: number): string {
  return `https://github.com/octo-org/api/pull/1#pullrequestreview-${index}`;
}

function statuses(pullRequest: RawPullRequest, viewer = "octocat") {
  return deriveReviewers(pullRequest, viewer).map(({ name, status, previous }) => ({ name, status, previous }));
}

function dismissals(pullRequest: RawPullRequest) {
  return deriveReviewers(pullRequest, "octocat").map(({ name, status, previous, dismissedFrom }) => ({ name, status, previous, dismissedFrom }));
}

describe("dismissedVerdicts", () => {
  test("keeps what a dismissed approval or change request had been, by review URL", () => {
    const verdicts = dismissedVerdicts({
      nodes: [
        { previousReviewState: "APPROVED", review: { url: "a" } },
        { previousReviewState: "CHANGES_REQUESTED", review: { url: "b" } },
        { previousReviewState: "COMMENTED", review: { url: "c" } },
        { previousReviewState: "APPROVED", review: null },
        null,
        {},
      ],
    });

    expect([...verdicts]).toEqual([
      ["a", "approved"],
      ["b", "changes_requested"],
    ]);
  });

  test("knows nothing in an overview cached before dismissals were fetched", () => {
    expect(dismissedVerdicts().size).toBe(0);
  });
});

describe("deriveReviewers", () => {
  test("says what a dismissed review had been", () => {
    const pullRequest = buildPullRequest({
      reviews: [
        [user("defunkt"), "DISMISSED"],
        [user("mojombo"), "DISMISSED"],
        [user("wycats"), "DISMISSED"],
      ],
      dismissed: [
        [0, "APPROVED"],
        [1, "CHANGES_REQUESTED"],
      ],
    });

    expect(dismissals(pullRequest)).toEqual([
      { name: "defunkt", status: "dismissed", previous: null, dismissedFrom: "approved" },
      { name: "mojombo", status: "dismissed", previous: null, dismissedFrom: "changes_requested" },
      { name: "wycats", status: "dismissed", previous: null, dismissedFrom: null },
    ]);
  });

  test("keeps what a dismissed review had been when its reviewer is requested again", () => {
    const pullRequest = buildPullRequest({
      requested: [user("mojombo")],
      reviews: [[user("mojombo"), "DISMISSED"]],
      dismissed: [[0, "APPROVED"]],
    });

    expect(dismissals(pullRequest)).toEqual([
      { name: "mojombo", status: "rerequested", previous: "dismissed", dismissedFrom: "approved" },
    ]);
  });

  test("lets a viewer who can update the pull request dismiss anyone else's standing verdict, a bot's included", () => {
    const pullRequest = buildPullRequest({
      requested: [user("wycats")],
      reviews: [
        [user("defunkt"), "APPROVED"],
        [bot("coderabbitai"), "CHANGES_REQUESTED"],
        [user("wycats"), "APPROVED"],
        [user("mojombo"), "APPROVED"],
        [user("mojombo"), "COMMENTED"],
        [user("pjhyett"), "COMMENTED"],
        [user("octocat"), "APPROVED"],
        [user("hubot"), "APPROVED"],
      ],
    });

    expect(Object.fromEntries(deriveReviewers(pullRequest, "octocat").map(({ name, dismissId }) => [name, dismissId]))).toEqual({
      coderabbitai: "PRR_1",
      wycats: "PRR_2",
      pjhyett: null,
      mojombo: "PRR_3",
      octocat: null,
      defunkt: "PRR_0",
    });
  });

  test("offers no dismissal without write access, for a dismissed review, or without the review's id", () => {
    const readOnly = buildPullRequest({ viewerCanUpdate: false, reviews: [[user("defunkt"), "APPROVED"]] });
    const dismissed = buildPullRequest({ reviews: [[user("defunkt"), "DISMISSED"]] });
    const cached = buildPullRequest({ reviews: [[user("defunkt"), "APPROVED"]] });
    delete cached.reviews.nodes[0]?.id;

    for (const pullRequest of [readOnly, dismissed, cached]) {
      expect(deriveReviewers(pullRequest, "octocat").map(({ dismissId }) => dismissId)).toEqual([null]);
    }
  });

  test("forgets a dismissal once the reviewer gives a new verdict", () => {
    const pullRequest = buildPullRequest({
      reviews: [
        [user("mojombo"), "DISMISSED"],
        [user("mojombo"), "COMMENTED"],
        [user("mojombo"), "CHANGES_REQUESTED"],
      ],
      dismissed: [[0, "APPROVED"]],
    });

    expect(dismissals(pullRequest)).toEqual([
      { name: "mojombo", status: "changes_requested", previous: null, dismissedFrom: null },
    ]);
  });

  test("keeps a dismissed review and the latest verdict after change requests", () => {
    const pullRequest = buildPullRequest({
      reviews: [
        [user("defunkt"), "CHANGES_REQUESTED"],
        [bot("coderabbitai"), "COMMENTED"],
        [user("defunkt"), "CHANGES_REQUESTED"],
        [user("mojombo"), "DISMISSED"],
        [user("defunkt"), "APPROVED"],
      ],
    });

    expect(statuses(pullRequest)).toEqual([
      { name: "mojombo", status: "dismissed", previous: null },
      { name: "defunkt", status: "approved", previous: null },
    ]);
  });

  test("does not let a later comment override an approval", () => {
    const pullRequest = buildPullRequest({
      author: "mojombo",
      reviews: [
        [user("octocat"), "APPROVED"],
        [user("octocat"), "COMMENTED"],
      ],
    });

    expect(statuses(pullRequest, "someone")).toEqual([{ name: "octocat", status: "approved", previous: null }]);
  });

  test("marks a requested reviewer who already reviewed as re-requested", () => {
    const pullRequest = buildPullRequest({
      requested: [user("mojombo")],
      reviews: [
        [user("mojombo"), "DISMISSED"],
        [user("mojombo"), "CHANGES_REQUESTED"],
      ],
    });

    expect(statuses(pullRequest)).toEqual([
      { name: "mojombo", status: "rerequested", previous: "changes_requested" },
    ]);
  });

  test("lists requested users and teams without reviews as pending", () => {
    const pullRequest = buildPullRequest({
      requested: [team("octo-org/reviewers"), user("wycats")],
      reviews: [[user("defunkt"), "APPROVED"]],
    });

    expect(deriveReviewers(pullRequest, "octocat").map(({ name, kind, status }) => ({ name, kind, status }))).toEqual([
      { name: "octo-org/reviewers", kind: "team", status: "pending" },
      { name: "wycats", kind: "user", status: "pending" },
      { name: "defunkt", kind: "user", status: "approved" },
    ]);
  });

  test("drops the author's own reviews, pending drafts and comment-only bots", () => {
    const pullRequest = buildPullRequest({
      author: "hubot",
      reviews: [
        [user("hubot"), "COMMENTED"],
        [bot("coderabbitai"), "COMMENTED"],
        [user("octocat"), "PENDING"],
        [user("mojombo"), "COMMENTED"],
      ],
    });

    expect(statuses(pullRequest)).toEqual([{ name: "mojombo", status: "commented", previous: null }]);
  });

  test("keeps a bot that requested changes or is requested", () => {
    const pullRequest = buildPullRequest({
      requested: [bot("copilot-pull-request-reviewer")],
      reviews: [[bot("coderabbitai"), "CHANGES_REQUESTED"]],
    });

    expect(statuses(pullRequest)).toEqual([
      { name: "coderabbitai", status: "changes_requested", previous: null },
      { name: "copilot-pull-request-reviewer", status: "pending", previous: null },
    ]);
  });

  test("skips a team request the token cannot read", () => {
    const pullRequest = buildPullRequest({ requested: [null], reviews: [[user("defunkt"), "APPROVED"]] });

    expect(statuses(pullRequest)).toEqual([{ name: "defunkt", status: "approved", previous: null }]);
  });

  test("offers a re-request only for reviewed, unrequested users other than the viewer", () => {
    const pullRequest = buildPullRequest({
      requested: [user("mojombo")],
      reviews: [
        [user("mojombo"), "APPROVED"],
        [user("defunkt"), "CHANGES_REQUESTED"],
        [user("octocat"), "APPROVED"],
        [bot("coderabbitai"), "CHANGES_REQUESTED"],
      ],
    });

    const rerequestable = deriveReviewers(pullRequest, "octocat")
      .filter((reviewer) => reviewer.canRerequest)
      .map((reviewer) => reviewer.name);

    expect(rerequestable).toEqual(["defunkt"]);
  });

  test("offers no re-request when the viewer cannot update the pull request", () => {
    const pullRequest = buildPullRequest({ viewerCanUpdate: false, reviews: [[user("defunkt"), "APPROVED"]] });

    expect(deriveReviewers(pullRequest, "octocat").some((reviewer) => reviewer.canRerequest)).toBe(false);
  });
  test("offers a poke for every currently requested user and team, but not bots or the viewer", () => {
    const pullRequest = buildPullRequest({
      requested: [user("mojombo"), user("wycats"), team("octo-org/reviewers"), bot("copilot-pull-request-reviewer"), user("octocat")],
      reviews: [
        [user("mojombo"), "CHANGES_REQUESTED"],
        [user("defunkt"), "APPROVED"],
      ],
    });

    const pokeable = deriveReviewers(pullRequest, "octocat")
      .filter((reviewer) => reviewer.canPoke)
      .map((reviewer) => reviewer.name);

    expect(pokeable).toEqual(["mojombo", "octo-org/reviewers", "wycats"]);
  });

  test("offers no poke to a requested reviewer whose latest verdict is an approval", () => {
    const pullRequest = buildPullRequest({
      requested: [user("mojombo"), user("defunkt"), user("wycats")],
      reviews: [
        [user("mojombo"), "APPROVED"],
        [user("mojombo"), "COMMENTED"],
        [user("defunkt"), "APPROVED"],
        [user("defunkt"), "CHANGES_REQUESTED"],
        [user("wycats"), "COMMENTED"],
      ],
    });

    const pokeable = deriveReviewers(pullRequest, "octocat")
      .filter((reviewer) => reviewer.canPoke)
      .map((reviewer) => reviewer.name);

    expect(pokeable).toEqual(["defunkt", "wycats"]);
  });

  test("offers no poke when the viewer cannot update the pull request", () => {
    const pullRequest = buildPullRequest({ viewerCanUpdate: false, requested: [user("mojombo")] });

    expect(deriveReviewers(pullRequest, "octocat").some((reviewer) => reviewer.canPoke)).toBe(false);
  });
});
