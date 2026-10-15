import { describe, expect, test } from "bun:test";
import { deriveDiscussion, isUnread, lastReviewBy, type RawDiscussionSource } from "./discussion";
import type { RawActor, RawReviewState } from "./reviewers";

function user(login: string, typename: RawActor["__typename"] = "User"): RawActor {
  return { __typename: typename, login, avatarUrl: `https://avatars/${login}`, url: `https://github.com/${login}` };
}

function review(author: RawActor, state: RawReviewState, bodyText: string, submittedAt: string) {
  return { state, submittedAt, bodyText, url: `https://github.com/o/r/pull/1#pullrequestreview-${submittedAt}`, author };
}

function comment(author: RawActor, bodyText: string, createdAt: string) {
  return { bodyText, createdAt, url: `https://github.com/o/r/pull/1#issuecomment-${createdAt}`, author };
}

describe("deriveDiscussion", () => {
  test("merges review texts and general comments, newest first, with each review's verdict", () => {
    const source: RawDiscussionSource = {
      reviews: {
        nodes: [
          review(user("mojombo"), "CHANGES_REQUESTED", "Please split the planner out.", "2026-10-10T10:00:00Z"),
          review(user("defunkt"), "APPROVED", "LGTM once CI is green.", "2026-10-12T10:00:00Z"),
        ],
      },
      comments: { nodes: [comment(user("wycats"), "Did we check the migration on staging?", "2026-10-11T10:00:00Z")] },
    };

    expect(deriveDiscussion(source).map(({ author, verdict, text }) => ({ author, verdict, text }))).toEqual([
      { author: "defunkt", verdict: "approved", text: "LGTM once CI is green." },
      { author: "wycats", verdict: null, text: "Did we check the migration on staging?" },
      { author: "mojombo", verdict: "changes_requested", text: "Please split the planner out." },
    ]);
  });

  test("leaves out drafts and reviews without text, including an empty change request's zero-width space", () => {
    const source: RawDiscussionSource = {
      reviews: {
        nodes: [
          review(user("octocat"), "PENDING", "Draft summary", "2026-10-10T10:00:00Z"),
          review(user("mojombo"), "COMMENTED", "", "2026-10-10T11:00:00Z"),
          review(user("defunkt"), "CHANGES_REQUESTED", "\u{200B}", "2026-10-10T12:00:00Z"),
          review(user("pjhyett"), "APPROVED", "  \n ", "2026-10-10T13:00:00Z"),
        ],
      },
    };

    expect(deriveDiscussion(source)).toEqual([]);
  });

  test("flags bots and stack tools' comments posted under a person's account", () => {
    const source: RawDiscussionSource = {
      reviews: { nodes: [review(user("coderabbitai", "Bot"), "COMMENTED", "Actionable comments posted: 1", "2026-10-10T10:00:00Z")] },
      comments: {
        nodes: [
          comment(user("mojombo"), "WarningThis pull request is not mergeable via GitHub because a downstack PR is open.", "2026-10-10T11:00:00Z"),
          comment(user("defunkt"), "Stack created with GitHub Stacks CLI • Give Feedback", "2026-10-10T12:00:00Z"),
          comment(user("renovate[bot]"), "Update dependency", "2026-10-10T13:00:00Z"),
          comment(user("wycats"), "Real question", "2026-10-10T14:00:00Z"),
        ],
      },
    };

    expect(deriveDiscussion(source).map(({ author, bot }) => `${author}:${bot}`)).toEqual([
      "wycats:false",
      "renovate[bot]:true",
      "defunkt:true",
      "mojombo:true",
      "coderabbitai:true",
    ]);
  });

  test("works with an overview cached before review texts and comments were fetched", () => {
    const source = { reviews: { nodes: [{ state: "APPROVED" as const, submittedAt: "2026-10-10T10:00:00Z", author: user("mojombo") }] } };

    expect(deriveDiscussion(source)).toEqual([]);
  });
});

describe("isUnread and lastReviewBy", () => {
  const item = deriveDiscussion({
    reviews: { nodes: [] },
    comments: { nodes: [comment(user("mojombo"), "New info", "2026-10-12T10:00:00Z")] },
  })[0]!;

  test("an item is new after the viewer last looked, unless the viewer wrote it or never looked", () => {
    expect(isUnread(item, "2026-10-11T10:00:00Z", "octocat")).toBe(true);
    expect(isUnread(item, "2026-10-13T10:00:00Z", "octocat")).toBe(false);
    expect(isUnread(item, "2026-10-11T10:00:00Z", "mojombo")).toBe(false);
    expect(isUnread(item, null, "octocat")).toBe(false);
  });

  test("finds the viewer's latest submitted review, ignoring drafts and others", () => {
    const source: RawDiscussionSource = {
      reviews: {
        nodes: [
          review(user("octocat"), "COMMENTED", "", "2026-10-09T10:00:00Z"),
          review(user("octocat"), "APPROVED", "", "2026-10-11T10:00:00Z"),
          review(user("octocat"), "PENDING", "", "2026-10-12T10:00:00Z"),
          review(user("mojombo"), "APPROVED", "", "2026-10-13T10:00:00Z"),
        ],
      },
    };

    expect(lastReviewBy(source, "octocat")).toBe("2026-10-11T10:00:00Z");
    expect(lastReviewBy(source, "wycats")).toBeNull();
  });
});
