import { describe, expect, test } from "bun:test";
import { overviewTurnInput, repliesAwaiting, toTurnThread, type TurnInput, type TurnThread, whoseTurn } from "./turn";

const REVIEWED = "2026-10-11T09:00:00Z";
const BEFORE = "2026-10-10T09:00:00Z";
const AFTER = "2026-10-12T09:00:00Z";

function input(overrides: Partial<TurnInput> = {}): TurnInput {
  return {
    viewer: "octocat",
    author: "hubot",
    draft: false,
    conflict: false,
    checksFailed: false,
    readyToMerge: false,
    needsReview: true,
    asked: null,
    viewerVerdict: null,
    viewerReviewedAt: null,
    pushes: [],
    changeRequests: [],
    requested: [],
    threads: [],
    ...overrides,
  };
}

function thread(starter: string | null, lastSpeaker: string | null, resolved = false): TurnThread {
  return { resolved, starter, lastSpeaker };
}

describe("whoseTurn on someone else's pull request", () => {
  test("is the viewer's while they are asked to review, the first time or again", () => {
    expect(whoseTurn(input({ asked: "requested" }))).toEqual({ whose: "you", reasons: [{ code: "requested" }] });
    expect(whoseTurn(input({ asked: "rerequested" })).reasons).toEqual([{ code: "rerequested" }]);
  });

  test("is the viewer's when someone answered last in threads they started", () => {
    const threads = [thread("octocat", "hubot"), thread("octocat", "octocat"), thread("octocat", "hubot", true), thread("alice", "hubot")];
    expect(whoseTurn(input({ viewerVerdict: "commented", threads }))).toEqual({ whose: "you", reasons: [{ code: "replies", count: 1 }] });
  });

  test("is the viewer's when the author pushed since their change request, not since a comment", () => {
    const pushedSince = { viewerReviewedAt: REVIEWED, pushes: [BEFORE, AFTER] };
    expect(whoseTurn(input({ viewerVerdict: "changes_requested", ...pushedSince })).reasons).toEqual([{ code: "pushed-since-review" }]);
    expect(whoseTurn(input({ viewerVerdict: "commented", ...pushedSince }))).toEqual({ whose: "them", reasons: [{ code: "waiting-on-author" }] });
  });

  test("waits for the author after a change request with no push since", () => {
    const turn = whoseTurn(input({ viewerVerdict: "changes_requested", viewerReviewedAt: REVIEWED, pushes: [BEFORE] }));
    expect(turn).toEqual({ whose: "them", reasons: [{ code: "waiting-on-author" }] });
  });

  test("waits for nobody in particular after an approval", () => {
    expect(whoseTurn(input({ viewerVerdict: "approved" }))).toEqual({ whose: "them", reasons: [] });
  });

  test("leaves a draft to nobody unless the viewer is asked to review it", () => {
    expect(whoseTurn(input({ draft: true, threads: [thread("octocat", "hubot")] }))).toEqual({ whose: "none", reasons: [{ code: "draft" }] });
    expect(whoseTurn(input({ draft: true, asked: "requested" })).whose).toBe("you");
  });
});

function own(overrides: Partial<TurnInput> = {}): TurnInput {
  return input({ author: "octocat", requested: ["alice"], ...overrides });
}

function user(login: string) {
  return { __typename: "User" as const, login, avatarUrl: "", url: "" };
}

function review(login: string, state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED", submittedAt: string) {
  return { state, submittedAt, author: user(login) };
}

describe("whoseTurn on the viewer's own pull request", () => {
  test("waits for the reviewers it asks", () => {
    expect(whoseTurn(own())).toEqual({ whose: "them", reasons: [{ code: "waiting-on-reviewers", who: ["alice"] }] });
  });

  test("asks the viewer to request a review nobody is asked for", () => {
    expect(whoseTurn(own({ requested: [] }))).toEqual({ whose: "you", reasons: [{ code: "ask-for-review" }] });
    expect(whoseTurn(own({ requested: [], needsReview: false }))).toEqual({ whose: "them", reasons: [] });
  });

  test("puts a conflict and failing checks first", () => {
    const turn = whoseTurn(own({ conflict: true, checksFailed: true, readyToMerge: true }));
    expect(turn.reasons.map((reason) => reason.code)).toEqual(["conflict", "checks-failed", "ready-to-merge"]);
  });

  test("tells a change request without a push since from one to ask again about", () => {
    const changeRequests = [
      { login: "alice", at: REVIEWED, requested: false },
      { login: "bob", at: BEFORE, requested: false },
      { login: "carol", at: BEFORE, requested: true },
    ];
    const turn = whoseTurn(own({ changeRequests, pushes: ["2026-10-10T12:00:00Z"], needsReview: false }));
    expect(turn).toEqual({
      whose: "you",
      reasons: [
        { code: "changes-requested", who: ["alice"] },
        { code: "ask-again", who: ["bob"] },
      ],
    });
  });

  test("counts unresolved threads where anyone but the viewer spoke last", () => {
    const threads = [thread("alice", "alice"), thread("alice", "octocat"), thread("bob", "bob", true), thread("alice", null)];
    expect(whoseTurn(own({ threads })).reasons).toEqual([{ code: "replies", count: 1 }]);
  });

  test("leaves a draft to nobody", () => {
    expect(whoseTurn(own({ draft: true, checksFailed: true }))).toEqual({ whose: "none", reasons: [{ code: "draft" }] });
  });
});

describe("toTurnThread", () => {
  test("names the starter and the last person to speak, passing over bots", () => {
    const raw = {
      isResolved: false,
      first: { nodes: [{ author: { __typename: "User", login: "alice" } }] },
      recent: {
        nodes: [
          { author: { __typename: "User", login: "hubot" } },
          { author: { __typename: "Bot", login: "reviewer" } },
          { author: { login: "linter[bot]" } },
        ],
      },
    };
    expect(toTurnThread(raw)).toEqual({ resolved: false, starter: "alice", lastSpeaker: "hubot" });
  });

  test("leaves a bot's thread, or a deleted user's, to nobody", () => {
    const raw = { isResolved: true, first: { nodes: [{ author: null }] }, recent: { nodes: [{ author: { __typename: "Bot", login: "ai" } }] } };
    expect(toTurnThread(raw)).toEqual({ resolved: true, starter: null, lastSpeaker: null });
  });
});

describe("repliesAwaiting", () => {
  test("counts, per reviewer, the open threads they started that the author answered last", () => {
    const threads = [thread("alice", "hubot"), thread("alice", "hubot"), thread("alice", "alice"), thread("bob", "hubot", true), thread("hubot", "hubot")];
    expect(repliesAwaiting(threads, "hubot")).toEqual(new Map([["alice", 2]]));
  });
});

describe("overviewTurnInput", () => {

  test("reads requests, standing verdicts, pushes and threads from the overview", () => {
    const pull = {
      author: { login: "octocat" },
      viewerCanUpdate: true,
      reviewRequests: { nodes: [{ requestedReviewer: user("carol") }, { requestedReviewer: { __typename: "Team" as const, name: "Core", combinedSlug: "octo-org/core", avatarUrl: null, url: "" } }] },
      reviews: {
        nodes: [
          review("alice", "CHANGES_REQUESTED", BEFORE),
          review("alice", "COMMENTED", REVIEWED),
          review("bob", "APPROVED", BEFORE),
          { state: "CHANGES_REQUESTED" as const, submittedAt: BEFORE, author: { ...user("ai"), __typename: "Bot" as const } },
        ],
      },
      number: 1,
      title: "",
      url: "",
      state: "OPEN" as const,
      isDraft: false,
      mergeable: "MERGEABLE" as const,
      reviewDecision: "CHANGES_REQUESTED" as const,
      createdAt: BEFORE,
      lastEditedAt: null,
      mergedAt: null,
      statusCheckRollup: { state: "FAILURE" as const },
      latestOpinionatedReviews: { nodes: [] },
      reviewThreads: { totalCount: 0, nodes: [] },
      timelineItems: { nodes: [{ __typename: "HeadRefForcePushedEvent", createdAt: AFTER }, { __typename: "PullRequestCommit", commit: { committedDate: BEFORE } }] },
      turnThreads: { nodes: [{ isResolved: false, first: { nodes: [{ author: { login: "alice" } }] }, recent: { nodes: [{ author: { login: "octocat" } }] } }] },
    };
    expect(overviewTurnInput(pull, "octocat")).toMatchObject({
      author: "octocat",
      checksFailed: true,
      asked: null,
      requested: ["carol", "octo-org/core"],
      pushes: [AFTER, BEFORE],
      changeRequests: [{ login: "alice", at: REVIEWED, requested: false }],
      threads: [{ resolved: false, starter: "alice", lastSpeaker: "octocat" }],
    });
    expect(overviewTurnInput(pull, "carol")).toMatchObject({ asked: "requested", viewerVerdict: null });
    expect(overviewTurnInput(pull, "alice")).toMatchObject({ viewerVerdict: "changes_requested", viewerReviewedAt: REVIEWED });
  });
});
