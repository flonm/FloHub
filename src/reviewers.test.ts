import { describe, expect, test } from "bun:test";
import {
  deriveReviewers,
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
      })),
    },
  };
}

function statuses(pullRequest: RawPullRequest, viewer = "octocat") {
  return deriveReviewers(pullRequest, viewer).map(({ name, status, previous }) => ({ name, status, previous }));
}

describe("deriveReviewers", () => {
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

  test("offers no poke when the viewer cannot update the pull request", () => {
    const pullRequest = buildPullRequest({ viewerCanUpdate: false, requested: [user("mojombo")] });

    expect(deriveReviewers(pullRequest, "octocat").some((reviewer) => reviewer.canPoke)).toBe(false);
  });
});
