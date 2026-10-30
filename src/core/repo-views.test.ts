import { describe, expect, test } from "bun:test";
import type { Inbox, InboxGroup, InboxPull } from "./inbox";
import { NO_MARKS } from "./inbox-marks";
import { hashFor, isSidebarList, REPO_VIEWS_IN_ORDER, repoInbox, repoViewCounts, viewFromHash } from "./repo-views";

const REF = { owner: "octo-org", repo: "api" };
const NOW = Date.parse("2026-10-30T12:00:00Z");

function group(repo: string, number: number, code: string, whose: "you" | "them" = "you"): InboxGroup {
  const pull = {
    number,
    url: `https://github.com/${repo}/pull/${number}`,
    lastActivity: "2026-10-30T10:00:00Z",
    rerequested: code === "rerequested",
    turn: { whose, reasons: [{ code }] },
  } as unknown as InboxPull;
  return { key: `${repo}#${number}`, repo, stackNumber: null, stackSize: 1, pulls: [pull] };
}

function inbox(groups: Partial<Pick<Inbox, "review" | "mine" | "waiting" | "other">>): Inbox {
  const review = groups.review ?? [];
  return { viewer: "mona", fetchedAt: 0, review, mine: [], waiting: [], other: [], ...groups, reviewCount: review.length };
}

describe("viewFromHash", () => {
  test.each(REPO_VIEWS_IN_ORDER)("reads back the hash for %s", (view) => {
    expect(viewFromHash(hashFor(view))).toBe(view);
  });

  test.each(["", "#", "#flohub=", "#flohub=nope", "#flohub=toString", "#issuecomment-1"])("ignores %p", (hash) => {
    expect(viewFromHash(hash)).toBeNull();
  });
});

describe("repoInbox", () => {
  test("keeps only the repository's pull requests, in any letter case, and counts the review requests again", () => {
    const whole = inbox({
      review: [group("Octo-Org/API", 1, "requested"), group("octo-org/web", 2, "requested")],
      mine: [group("octo-org/api", 3, "checks-failed"), group("mona/api", 4, "checks-failed")],
      waiting: [group("octo-org/web", 5, "waiting-on-author", "them")],
      other: [group("octo-org/api", 6, "other", "them")],
    });
    const shown = repoInbox(whole, REF);
    expect(shown.review.map((entry) => entry.pulls[0]?.number)).toEqual([1]);
    expect(shown.mine.map((entry) => entry.pulls[0]?.number)).toEqual([3]);
    expect(shown.waiting).toEqual([]);
    expect(shown.other?.map((entry) => entry.pulls[0]?.number)).toEqual([6]);
    expect(shown.reviewCount).toBe(1);
  });

  test("leaves out the sections an inbox stored before them never had", () => {
    const { waiting: _waiting, other: _other, ...old } = inbox({ review: [group("octo-org/api", 1, "requested")] });
    const shown = repoInbox(old, REF);
    expect("waiting" in shown).toBe(false);
    expect("other" in shown).toBe(false);
  });
});

describe("repoViewCounts", () => {
  test("counts a re-request under Your turn and Re-requested both", () => {
    const counts = repoViewCounts(
      inbox({
        review: [group("octo-org/api", 1, "rerequested"), group("octo-org/api", 2, "requested")],
        mine: [group("octo-org/api", 3, "waiting-on-reviewers", "them")],
        waiting: [group("octo-org/api", 4, "changes-by-other", "them")],
      }),
      NO_MARKS,
      NOW,
    );
    expect(counts).toEqual({ "your-turn": 2, rerequested: 1, "their-turn": 1, reviewed: 1 });
  });

  test("leaves out a snoozed pull request", () => {
    const counts = repoViewCounts(
      inbox({ review: [group("octo-org/api", 1, "rerequested")] }),
      { pinned: [], snoozed: { "https://github.com/octo-org/api/pull/1": { until: NOW + 1000 } } },
      NOW,
    );
    expect(counts.rerequested).toBe(0);
    expect(counts["your-turn"]).toBe(0);
  });

  test("counts nothing in an empty inbox", () => {
    expect(repoViewCounts(inbox({}), NO_MARKS, NOW)).toEqual({ "your-turn": 0, rerequested: 0, "their-turn": 0, reviewed: 0 });
  });
});

describe("isSidebarList", () => {
  test.each([
    ["/octo-org/api/pulls/authored/mona", true],
    ["/Octo-Org/API/pulls/review-requested/mona", true],
    ["/octo-org/api/pulls/assigned/mona", true],
    ["/octo-org/api/pulls/involves/mona", true],
    ["/octo-org/api/pulls", false],
    ["/octo-org/api/pulls/review-requested", false],
    ["/octo-org/api/pulls/mentioned/mona", false],
    ["/octo-org/web/pulls/authored/mona", false],
    ["/octo-org/api/pulls/authored/mona/extra", false],
  ])("%s: %p", (pathname, expected) => {
    expect(isSidebarList(pathname, REF)).toBe(expected);
  });
});
