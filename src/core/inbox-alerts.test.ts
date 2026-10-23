import { describe, expect, test } from "bun:test";
import type { Inbox, InboxGroup, InboxPull } from "./inbox";
import { inboxAlerts, MAX_ALERTS, reasonTitle } from "./inbox-alerts";
import { type InboxMarks, NO_MARKS } from "./inbox-marks";
import type { Turn, TurnReason } from "./turn";

const NOW = Date.parse("2026-10-23T12:00:00Z");
const VIEWER = "octocat";

type Pull = InboxPull & { turn?: Turn };

function buildPull(number: number, overrides: Partial<Pull> = {}): Pull {
  return {
    number,
    title: `feat: layer ${number}`,
    url: `https://github.com/octo-org/api/pull/${number}`,
    tone: "attention",
    label: "Review required",
    author: "alice",
    avatarUrl: null,
    position: null,
    lastActivity: "2026-10-23T10:00:00Z",
    resolvedThreads: 0,
    totalThreads: 0,
    rerequested: false,
    turn: { whose: "them", reasons: [] },
    ...overrides,
  };
}

function yours(...reasons: TurnReason[]): Turn {
  return { whose: "you", reasons };
}

function group(pull: Pull): InboxGroup {
  return { key: pull.url, repo: "octo-org/api", stackNumber: null, stackSize: 1, pulls: [pull] };
}

/** An inbox with the given pull requests under review, and the viewer's own ones under mine. */
function inbox(...pulls: Pull[]): Inbox {
  return {
    viewer: VIEWER,
    fetchedAt: NOW,
    review: pulls.filter((pull) => pull.author !== VIEWER).map((pull) => group(pull)),
    mine: pulls.filter((pull) => pull.author === VIEWER).map((pull) => group(pull)),
    waiting: [],
    reviewCount: 0,
  };
}

function alertsFor(previous: Inbox | undefined, next: Inbox, marks: InboxMarks = NO_MARKS) {
  return inboxAlerts(previous, next, marks, NOW);
}

/** An unrelated pull request with a turn, so the previous inbox counts as one stored after turns existed. */
const OTHER = buildPull(99);

describe("inboxAlerts", () => {
  test("the first inbox alerts nothing", () => {
    expect(alertsFor(undefined, inbox(buildPull(1, { turn: yours({ code: "requested" }) })))).toEqual([]);
  });

  test("an inbox stored before turns existed alerts nothing, though everything looks new", () => {
    const { turn: _turn, ...withoutTurn } = buildPull(1);
    const next = inbox(buildPull(1, { turn: yours({ code: "requested" }) }), buildPull(2, { turn: yours({ code: "replies", count: 2 }) }));
    expect(alertsFor(inbox(withoutTurn), next)).toEqual([]);
  });

  test("an empty inbox before compares fine, so the first request after inbox zero alerts", () => {
    expect(alertsFor(inbox(), inbox(buildPull(1, { turn: yours({ code: "requested" }) })))).toHaveLength(1);
  });

  test("a pull request that newly appears as your turn alerts with its most pressing reason", () => {
    const pull = buildPull(1, { turn: yours({ code: "rerequested" }, { code: "replies", count: 2 }) });
    expect(alertsFor(inbox(OTHER), inbox(OTHER, pull))).toEqual([
      {
        id: "https://github.com/octo-org/api/pull/1#rerequested",
        title: "Re-requested",
        message: "octo-org/api#1 feat: layer 1",
        url: "https://github.com/octo-org/api/pull/1",
      },
    ]);
  });

  test("a pull request that turns from theirs to yours alerts", () => {
    const before = buildPull(1, { turn: { whose: "them", reasons: [{ code: "waiting-on-author" }] } });
    const after = buildPull(1, { turn: yours({ code: "pushed-since-review" }) });
    expect(alertsFor(inbox(before), inbox(after)).map((alert) => alert.title)).toEqual(["New commits since your review"]);
  });

  test("staying your turn for the same reasons doesn't alert again, even as the count grows", () => {
    const before = buildPull(1, { turn: yours({ code: "replies", count: 1 }) });
    const after = buildPull(1, { turn: yours({ code: "replies", count: 3 }) });
    expect(alertsFor(inbox(before), inbox(after))).toEqual([]);
  });

  test("staying your turn with a new reason alerts with that reason", () => {
    const before = buildPull(1, { author: VIEWER, turn: yours({ code: "replies", count: 2 }) });
    const after = buildPull(1, { author: VIEWER, turn: yours({ code: "checks-failed" }, { code: "replies", count: 2 }) });
    expect(alertsFor(inbox(before), inbox(after)).map((alert) => alert.id)).toEqual(["https://github.com/octo-org/api/pull/1#checks-failed"]);
  });

  test("a new reason that only describes a wait doesn't alert", () => {
    const before = buildPull(1, { author: VIEWER, turn: yours({ code: "conflict" }) });
    const after = buildPull(1, { author: VIEWER, turn: yours({ code: "conflict" }, { code: "waiting-on-reviewers", who: ["alice"] }) });
    expect(alertsFor(inbox(before), inbox(after))).toEqual([]);
  });

  test("a pull request that stops being your turn alerts nothing", () => {
    const before = buildPull(1, { turn: yours({ code: "requested" }) });
    expect(alertsFor(inbox(before), inbox(buildPull(1)))).toEqual([]);
  });

  test("your pull request turning ready to merge alerts, even while it isn't your turn", () => {
    const before = buildPull(1, { author: VIEWER, turn: { whose: "them", reasons: [{ code: "waiting-on-reviewers" }] } });
    const after = buildPull(1, { author: VIEWER, turn: { whose: "none", reasons: [{ code: "ready-to-merge" }] } });
    expect(alertsFor(inbox(before), inbox(after)).map((alert) => alert.title)).toEqual(["Ready to merge"]);
  });

  test("someone else's pull request turning ready to merge alerts nothing", () => {
    const after = buildPull(1, { turn: { whose: "them", reasons: [{ code: "ready-to-merge" }] } });
    expect(alertsFor(inbox(buildPull(1)), inbox(after))).toEqual([]);
  });

  test.each([
    ["ready to merge", { tone: "success", label: "Ready to merge" }, "Ready to merge"],
    ["checks failed", { tone: "danger", label: "Checks failed" }, "Checks failed"],
  ] as const)("without a reason in the turn, the status label says %s", (_case, status, title) => {
    const before = buildPull(1, { author: VIEWER, turn: { whose: "them", reasons: [] } });
    const after = buildPull(1, { author: VIEWER, turn: { whose: "them", reasons: [] }, ...status });
    expect(alertsFor(inbox(before), inbox(after)).map((alert) => alert.title)).toEqual([title]);
  });

  test("a label that was already there doesn't alert again", () => {
    const pull = buildPull(1, { author: VIEWER, tone: "danger", label: "Checks failed" });
    expect(alertsFor(inbox(pull), inbox(pull))).toEqual([]);
  });

  test("the label and the turn saying the same thing alert once", () => {
    const before = buildPull(1, { author: VIEWER, turn: yours({ code: "replies", count: 1 }) });
    const after = buildPull(1, { author: VIEWER, tone: "danger", label: "Checks failed", turn: yours({ code: "checks-failed" }, { code: "replies", count: 1 }) });
    expect(alertsFor(inbox(before), inbox(after))).toHaveLength(1);
  });

  test("a pull request in the waiting section alerts too", () => {
    const before = buildPull(1, { turn: { whose: "them", reasons: [{ code: "waiting-on-author" }] } });
    const after = buildPull(1, { turn: yours({ code: "requested" }) });
    const next: Inbox = { ...inbox(), waiting: [group(after)] };
    expect(alertsFor({ ...inbox(), waiting: [group(before)] }, next)).toHaveLength(1);
  });

  test("a snoozed pull request is skipped", () => {
    const pull = buildPull(1, { turn: yours({ code: "requested" }) });
    const marks: InboxMarks = { snoozed: { [pull.url]: { until: NOW + 1 } }, pinned: [] };
    expect(alertsFor(inbox(OTHER), inbox(OTHER, pull), marks)).toEqual([]);
    expect(alertsFor(inbox(OTHER), inbox(OTHER, pull), { snoozed: { [pull.url]: { until: NOW } }, pinned: [] })).toHaveLength(1);
  });

  test(`past ${MAX_ALERTS} alerts, the last sums up the rest`, () => {
    const pulls = Array.from({ length: MAX_ALERTS + 2 }, (_, index) => buildPull(index + 1, { turn: yours({ code: "requested" }) }));
    const alerts = alertsFor(inbox(OTHER), inbox(OTHER, ...pulls));
    expect(alerts).toHaveLength(MAX_ALERTS);
    expect(alerts.slice(0, -1).map((alert) => alert.url)).toEqual(pulls.slice(0, MAX_ALERTS - 1).map((pull) => pull.url));
    expect(alerts.at(-1)).toEqual({
      id: "inbox-alerts-more",
      title: "And 3 more",
      message: "Review requested, Review requested, Review requested",
      url: "https://github.com/pulls",
    });
  });

  test(`exactly ${MAX_ALERTS} alerts need no summary`, () => {
    const pulls = Array.from({ length: MAX_ALERTS }, (_, index) => buildPull(index + 1, { turn: yours({ code: "requested" }) }));
    expect(alertsFor(inbox(OTHER), inbox(OTHER, ...pulls)).map((alert) => alert.title)).not.toContain("And 1 more");
  });
});

describe("reasonTitle", () => {
  test.each<[TurnReason, string]>([
    [{ code: "requested" }, "Review requested"],
    [{ code: "rerequested" }, "Re-requested"],
    [{ code: "replies", count: 1 }, "1 new reply"],
    [{ code: "replies", count: 2 }, "2 new replies"],
    [{ code: "replies" }, "1 new reply"],
    [{ code: "pushed-since-review" }, "New commits since your review"],
    [{ code: "changes-requested", who: ["alice"] }, "Changes requested by alice"],
    [{ code: "changes-requested", who: ["alice", "bob"] }, "Changes requested by alice and bob"],
    [{ code: "changes-requested", who: ["alice", "bob", "carol"] }, "Changes requested by alice and 2 others"],
    [{ code: "changes-requested" }, "Changes requested"],
    [{ code: "ask-again", who: ["alice"] }, "Ask again for a review from alice"],
    [{ code: "checks-failed" }, "Checks failed"],
    [{ code: "conflict" }, "Merge conflict"],
    [{ code: "ready-to-merge" }, "Ready to merge"],
    [{ code: "ask-for-review" }, "Ask for a review"],
    [{ code: "waiting-on-reviewers", who: ["alice"] }, "Waiting for alice"],
    [{ code: "waiting-on-reviewers" }, "Waiting for reviewers"],
    [{ code: "waiting-on-author" }, "Waiting for the author"],
    [{ code: "draft" }, "Draft"],
  ])("%o → %s", (reason, title) => {
    expect(reasonTitle(reason)).toBe(title);
  });
});
