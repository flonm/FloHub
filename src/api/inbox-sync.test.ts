import { beforeEach, describe, expect, test } from "bun:test";
import type { Inbox } from "../core/inbox";
import { ensureInboxAlarm, INBOX_ALARM, INBOX_PERIOD_MINUTES, isFresh } from "./inbox-sync";

interface Alarm {
  name: string;
  scheduledTime: number;
  periodInMinutes?: number;
}

let alarms: Map<string, Alarm>;
let creates: number;

beforeEach(() => {
  alarms = new Map();
  creates = 0;
  (globalThis as { chrome?: unknown }).chrome = {
    // Stand-ins for chrome's promise API, which settle without awaiting anything.
    /* oxlint-disable typescript/require-await */
    alarms: {
      get: async (name: string) => alarms.get(name),
      create: async (name: string, info: { periodInMinutes: number }) => {
        creates++;
        alarms.set(name, { name, scheduledTime: Date.now() + info.periodInMinutes * 60_000, periodInMinutes: info.periodInMinutes });
      },
    },
    /* oxlint-enable typescript/require-await */
  };
});

describe("ensureInboxAlarm", () => {
  test("schedules the refresh when no alarm exists", async () => {
    await ensureInboxAlarm();

    expect(alarms.get(INBOX_ALARM)?.periodInMinutes).toBe(INBOX_PERIOD_MINUTES);
  });

  test("keeps a running countdown when the service worker starts again", async () => {
    alarms.set(INBOX_ALARM, { name: INBOX_ALARM, scheduledTime: 42, periodInMinutes: INBOX_PERIOD_MINUTES });

    await ensureInboxAlarm();
    await ensureInboxAlarm();

    expect(creates).toBe(0);
    expect(alarms.get(INBOX_ALARM)?.scheduledTime).toBe(42);
  });

  test("replaces an alarm left over with another period", async () => {
    alarms.set(INBOX_ALARM, { name: INBOX_ALARM, scheduledTime: 42, periodInMinutes: INBOX_PERIOD_MINUTES + 10 });

    await ensureInboxAlarm();

    expect(alarms.get(INBOX_ALARM)?.periodInMinutes).toBe(INBOX_PERIOD_MINUTES);
  });
});

describe("isFresh", () => {
  const inbox: Inbox = { viewer: "octocat", fetchedAt: 1_000_000, review: [], mine: [], waiting: [], reviewCount: 0 };

  test.each([
    { age: 59_999, fresh: true },
    { age: 60_000, fresh: false },
    { age: 120_000, fresh: false },
  ])("an inbox fetched $age ms ago is fresh: $fresh", ({ age, fresh }) => {
    expect(isFresh(inbox, inbox.fetchedAt + age, 60_000)).toBe(fresh);
  });

  test("no stored inbox is fresh", () => {
    expect(isFresh(undefined, 0, 60_000)).toBe(false);
  });

  test("without a maximum age, even a brand-new inbox is fetched again", () => {
    expect(isFresh(inbox, inbox.fetchedAt)).toBe(false);
  });
});
