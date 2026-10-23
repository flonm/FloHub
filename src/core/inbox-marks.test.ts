import { describe, expect, test } from "bun:test";
import type { Inbox, InboxGroup, InboxPull } from "./inbox";
import {
  applyMarks,
  badgeCount,
  type InboxMarks,
  isPinned,
  isSnoozed,
  NO_MARKS,
  pruneMarks,
  readMarks,
  setSnooze,
  snoozeFor,
  togglePin,
} from "./inbox-marks";

const NOW = Date.parse("2026-10-23T12:00:00Z");
const URL_1 = "https://github.com/octo-org/api/pull/1";
const URL_2 = "https://github.com/octo-org/api/pull/2";
const URL_3 = "https://github.com/octo-org/api/pull/3";

function buildPull(number: number, overrides: Partial<InboxPull> = {}): InboxPull {
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
    ...overrides,
  };
}

function buildGroup(key: string, pulls: InboxPull[]): InboxGroup {
  return { key, repo: "octo-org/api", stackNumber: null, stackSize: pulls.length, pulls };
}

function buildInbox(groups: InboxGroup[]): Inbox {
  return { viewer: "octocat", fetchedAt: NOW, review: groups, mine: [], waiting: [], reviewCount: 0 };
}

function marksWith(overrides: Partial<InboxMarks>): InboxMarks {
  return { ...NO_MARKS, ...overrides };
}

describe("snoozeFor", () => {
  const pull = buildPull(1);

  test("an hour from now", () => {
    expect(snoozeFor("hour", new Date(NOW), pull)).toEqual({ until: NOW + 3_600_000 });
  });

  // Built from local dates, so the expectations hold in any time zone the tests run in.
  test.each([
    ["the afternoon", new Date(2026, 9, 23, 15, 30), new Date(2026, 9, 24, 9, 0)],
    ["just after midnight, still the next calendar day", new Date(2026, 9, 23, 0, 30), new Date(2026, 9, 24, 9, 0)],
    ["the last day of a month", new Date(2026, 9, 31, 18, 0), new Date(2026, 10, 1, 9, 0)],
    ["new year's eve", new Date(2026, 11, 31, 22, 0), new Date(2027, 0, 1, 9, 0)],
  ])("until tomorrow 9:00 local time from %s", (_case, now, expected) => {
    expect(snoozeFor("tomorrow", now, pull)).toEqual({ until: expected.getTime() });
  });

  test("until next activity remembers the activity it waits past", () => {
    expect(snoozeFor("activity", new Date(NOW), pull)).toEqual({ afterActivity: "2026-10-23T10:00:00Z" });
  });
});

describe("isSnoozed", () => {
  const pull = buildPull(1);

  test("a pull request with no snooze isn't snoozed", () => {
    expect(isSnoozed(NO_MARKS, pull, NOW)).toBe(false);
  });

  test.each([
    [NOW + 1, true],
    [NOW, false],
    [NOW - 1, false],
  ])("a timed snooze until %d holds only before its time", (until, expected) => {
    expect(isSnoozed(marksWith({ snoozed: { [URL_1]: { until } } }), pull, NOW)).toBe(expected);
  });

  test.each([
    ["the same activity", "2026-10-23T10:00:00Z", true],
    ["older activity", "2026-10-23T09:00:00Z", true],
    ["a newer push or review", "2026-10-23T10:00:01Z", false],
  ])("a snooze until next activity holds with %s", (_case, lastActivity, expected) => {
    const marks = marksWith({ snoozed: { [URL_1]: { afterActivity: "2026-10-23T10:00:00Z" } } });
    expect(isSnoozed(marks, buildPull(1, { lastActivity }), NOW)).toBe(expected);
  });
});

describe("setSnooze and togglePin", () => {
  test("snoozing and waking up leaves the other marks alone", () => {
    const start = marksWith({ snoozed: { [URL_2]: { until: NOW } }, pinned: [URL_3] });
    const snoozed = setSnooze(start, URL_1, { until: NOW + 1 });
    expect(snoozed).toEqual({ snoozed: { [URL_2]: { until: NOW }, [URL_1]: { until: NOW + 1 } }, pinned: [URL_3] });
    expect(setSnooze(snoozed, URL_1, null)).toEqual(start);
    expect(start.snoozed[URL_1]).toBeUndefined();
  });

  test("pinning twice unpins", () => {
    const pinned = togglePin(NO_MARKS, URL_1);
    expect(isPinned(pinned, URL_1)).toBe(true);
    expect(isPinned(togglePin(pinned, URL_1), URL_1)).toBe(false);
    expect(NO_MARKS.pinned).toEqual([]);
  });
});

describe("readMarks", () => {
  test.each([undefined, null, "marks", 3])("a missing or foreign value reads as no marks: %p", (stored) => {
    expect(readMarks(stored)).toEqual(NO_MARKS);
  });

  test("keeps the valid marks and drops the rest", () => {
    const stored = {
      snoozed: { [URL_1]: { until: NOW }, [URL_2]: { afterActivity: "2026-10-23T10:00:00Z" }, [URL_3]: { until: "soon" }, x: null },
      pinned: [URL_1, 4],
    };
    expect(readMarks(stored)).toEqual({
      snoozed: { [URL_1]: { until: NOW }, [URL_2]: { afterActivity: "2026-10-23T10:00:00Z" } },
      pinned: [URL_1],
    });
  });
});

describe("pruneMarks", () => {
  const inbox = buildInbox([buildGroup("a", [buildPull(1)]), buildGroup("b", [buildPull(2)])]);

  test("drops an expired snooze and one that saw activity", () => {
    const marks = marksWith({
      snoozed: { [URL_1]: { until: NOW - 1 }, [URL_2]: { afterActivity: "2026-10-23T09:00:00Z" } },
    });
    expect(pruneMarks(marks, inbox, NOW)).toEqual(NO_MARKS);
  });

  test("drops snoozes and pins of pull requests no longer in the inbox", () => {
    const marks = marksWith({ snoozed: { [URL_3]: { until: NOW + 1 } }, pinned: [URL_3, URL_1] });
    expect(pruneMarks(marks, inbox, NOW)).toEqual({ snoozed: {}, pinned: [URL_1] });
  });

  test("finds pull requests in every section", () => {
    const marks = marksWith({ pinned: [URL_3] });
    const everywhere: Inbox = { ...buildInbox([]), mine: [], waiting: [buildGroup("c", [buildPull(3)])] };
    expect(pruneMarks(marks, everywhere, NOW)).toBe(marks);
  });

  test("returns the same marks when nothing changed, so the caller can skip the write", () => {
    const marks = marksWith({ snoozed: { [URL_1]: { until: NOW + 1 } }, pinned: [URL_2] });
    expect(pruneMarks(marks, inbox, NOW)).toBe(marks);
  });
});

function keys(section: { groups: InboxGroup[] }): string[] {
  return section.groups.map((group) => group.key);
}

describe("applyMarks", () => {
  const groups = [
    buildGroup("a", [buildPull(1)]),
    buildGroup("stack", [buildPull(3), buildPull(2)]),
    buildGroup("b", [buildPull(4)]),
    buildGroup("c", [buildPull(5)]),
  ];

  test("no marks keep the section as it is", () => {
    const section = applyMarks(groups, NO_MARKS, NOW);
    expect(section.snoozed).toBe(0);
    expect(section.groups).toEqual(groups);
  });

  test("an empty section stays empty", () => {
    expect(applyMarks([], marksWith({ pinned: [URL_1] }), NOW)).toEqual({ groups: [], snoozed: 0 });
  });

  test("hides snoozed pull requests, drops a group left empty, and counts them", () => {
    const marks = marksWith({ snoozed: { [URL_1]: { until: NOW + 1 }, [URL_2]: { until: NOW + 1 } } });
    const section = applyMarks(groups, marks, NOW);
    expect(section.snoozed).toBe(2);
    expect(keys(section)).toEqual(["stack", "b", "c"]);
    expect(section.groups[0]?.pulls.map((pull) => pull.number)).toEqual([3]);
  });

  test("a snooze that ran out hides nothing", () => {
    expect(applyMarks(groups, marksWith({ snoozed: { [URL_1]: { until: NOW } } }), NOW).snoozed).toBe(0);
  });

  test("shows snoozed pull requests in place on request, still counting them", () => {
    const section = applyMarks(groups, marksWith({ snoozed: { [URL_1]: { until: NOW + 1 } } }), NOW, true);
    expect(section).toEqual({ groups, snoozed: 1 });
  });

  test("pinned groups come first, each part keeping the section's order", () => {
    const section = applyMarks(groups, marksWith({ pinned: ["https://github.com/octo-org/api/pull/5", URL_2] }), NOW);
    expect(keys(section)).toEqual(["stack", "c", "a", "b"]);
  });

  test("a pinned pull request that is snoozed stays hidden", () => {
    const marks = marksWith({ snoozed: { [URL_1]: { until: NOW + 1 } }, pinned: [URL_1] });
    expect(keys(applyMarks(groups, marks, NOW))).toEqual(["stack", "b", "c"]);
  });
});

describe("badgeCount", () => {
  test("counts the pull requests waiting for the viewer's move, without the snoozed ones", () => {
    const yours = { turn: { whose: "you" as const, reasons: [{ code: "requested" as const }] } };
    const inbox = {
      ...buildInbox([buildGroup("a", [buildPull(1, yours), buildPull(2, yours), buildPull(3, { turn: { whose: "them", reasons: [] } })])]),
      turnCount: 2,
    };
    expect(badgeCount(inbox, NO_MARKS, NOW)).toBe(2);
    expect(badgeCount(inbox, marksWith({ snoozed: { [URL_1]: { until: NOW + 1000 } } }), NOW)).toBe(1);
    expect(badgeCount(inbox, marksWith({ snoozed: { [URL_1]: { until: NOW - 1000 } } }), NOW)).toBe(2);
  });

  test("counts the review requests of an inbox stored before turns", () => {
    expect(badgeCount({ ...buildInbox([]), reviewCount: 3 }, NO_MARKS, NOW)).toBe(3);
  });
});
