import type { Inbox, InboxGroup, InboxPull } from "./inbox";

/**
 * How long a pull request stays out of the inbox: until a moment, or until it sees activity after the one
 * it had when snoozed.
 */
export type Snooze = { until: number } | { afterActivity: string };

/**
 * The marks the viewer sets on pull requests in the popup, stored as one object in `chrome.storage.local`
 * under {@link MARKS_KEY}. Both are keyed by the pull request's URL.
 */
export interface InboxMarks {
  snoozed: Record<string, Snooze>;
  /** Pinned pull requests, sorted first within their section. */
  pinned: string[];
}

/** The `chrome.storage.local` key that holds the {@link InboxMarks}. */
export const MARKS_KEY = "inboxMarks";

/** No marks: what a viewer starts with, and what a stored value that isn't marks reads as. */
export const NO_MARKS: InboxMarks = { snoozed: {}, pinned: [] };

/** The ways the popup offers to snooze a pull request. */
export type SnoozePreset = "hour" | "tomorrow" | "activity";

const HOUR_MS = 3_600_000;

/** The hour of the next day that "Until tomorrow" snoozes until, in the viewer's time zone. */
const TOMORROW_HOUR = 9;

/**
 * @param stored What `chrome.storage.local` holds under {@link MARKS_KEY}, which may be missing or from an older shape.
 * @returns The marks, with anything that isn't a valid mark left out.
 */
export function readMarks(stored: unknown): InboxMarks {
  if (typeof stored !== "object" || stored === null) return NO_MARKS;
  const { snoozed, pinned } = stored as Partial<Record<keyof InboxMarks, unknown>>;
  const marks: InboxMarks = { snoozed: {}, pinned: [] };
  if (typeof snoozed === "object" && snoozed !== null) {
    for (const [url, snooze] of Object.entries(snoozed)) if (isSnooze(snooze)) marks.snoozed[url] = snooze;
  }
  if (Array.isArray(pinned)) marks.pinned = pinned.filter((url): url is string => typeof url === "string");
  return marks;
}

function isSnooze(value: unknown): value is Snooze {
  if (typeof value !== "object" || value === null) return false;
  const snooze = value as Partial<Record<"until" | "afterActivity", unknown>>;
  return typeof snooze.until === "number" || typeof snooze.afterActivity === "string";
}

/**
 * "Until tomorrow" means the next calendar day at 9:00 in the viewer's time zone, even when it's past midnight already.
 * @param preset The snooze the viewer picked.
 * @param now The current time, as a Date so the time zone it's read in is the viewer's.
 * @param pull The pull request, whose latest activity the "Until next activity" snooze waits to move on.
 * @returns The snooze to store for it.
 */
export function snoozeFor(preset: SnoozePreset, now: Date, pull: Pick<InboxPull, "lastActivity">): Snooze {
  switch (preset) {
    case "hour": {
      return { until: now.getTime() + HOUR_MS };
    }
    case "tomorrow": {
      // setDate rolls over the month and year, and setHours keeps to local time across a daylight saving change.
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(TOMORROW_HOUR, 0, 0, 0);
      return { until: tomorrow.getTime() };
    }
    case "activity": {
      return { afterActivity: pull.lastActivity };
    }
  }
}

/**
 * @param snooze The snooze.
 * @param pull The pull request as the inbox shows it now.
 * @param now The current time in epoch milliseconds.
 * @returns Whether the snooze still holds: its time hasn't come, or the pull request has seen no activity since.
 */
function holds(snooze: Snooze, pull: Pick<InboxPull, "lastActivity">, now: number): boolean {
  if ("until" in snooze) return now < snooze.until;
  return Date.parse(pull.lastActivity) <= Date.parse(snooze.afterActivity);
}

/**
 * @param marks The viewer's marks.
 * @param pull The pull request as the inbox shows it now.
 * @param now The current time in epoch milliseconds.
 * @returns Whether it is snoozed right now.
 */
export function isSnoozed(marks: InboxMarks, pull: Pick<InboxPull, "url" | "lastActivity">, now: number): boolean {
  const snooze = marks.snoozed[pull.url];
  return snooze !== undefined && holds(snooze, pull, now);
}

/**
 * @param marks The viewer's marks.
 * @param url The pull request's URL.
 * @returns Whether it is pinned.
 */
export function isPinned(marks: InboxMarks, url: string): boolean {
  return marks.pinned.includes(url);
}

/**
 * @param marks The viewer's marks.
 * @param url The pull request's URL.
 * @param snooze The snooze from {@link snoozeFor}, or null to wake it up.
 * @returns New marks with the pull request snoozed, or no longer snoozed.
 */
export function setSnooze(marks: InboxMarks, url: string, snooze: Snooze | null): InboxMarks {
  const { [url]: _previous, ...rest } = marks.snoozed;
  return { ...marks, snoozed: snooze ? { ...rest, [url]: snooze } : rest };
}

/**
 * @param marks The viewer's marks.
 * @param url The pull request's URL.
 * @returns New marks with the pull request pinned if it wasn't, and unpinned if it was.
 */
export function togglePin(marks: InboxMarks, url: string): InboxMarks {
  return {
    ...marks,
    pinned: isPinned(marks, url) ? marks.pinned.filter((pinned) => pinned !== url) : [...marks.pinned, url],
  };
}

/**
 * Drops the marks that no longer do anything: a snooze that ran out, and any mark on a pull request the inbox no
 * longer holds. A pull request leaves the inbox once it's merged or closed, or once it stops waiting for the viewer
 * in every section, so a pin there has nothing left to sort; pinning it again is one click if it comes back.
 * Call it only with an inbox that was fetched in full, since a pull request missing from a partial one would lose its marks.
 * @param marks The viewer's marks.
 * @param inbox The inbox just fetched.
 * @param now The current time in epoch milliseconds.
 * @returns The marks still in force, or `marks` itself when nothing was dropped, so the caller can skip the write.
 */
export function pruneMarks(marks: InboxMarks, inbox: Inbox, now: number): InboxMarks {
  const pulls = new Map(allGroups(inbox).flatMap((group) => group.pulls.map((pull) => [pull.url, pull] as const)));
  const snoozed = Object.fromEntries(
    Object.entries(marks.snoozed).filter(([url, snooze]) => {
      const pull = pulls.get(url);
      return pull !== undefined && holds(snooze, pull, now);
    }),
  );
  const pinned = marks.pinned.filter((url) => pulls.has(url));
  const unchanged = pinned.length === marks.pinned.length && Object.keys(snoozed).length === Object.keys(marks.snoozed).length;
  return unchanged ? marks : { snoozed, pinned };
}

function allGroups(inbox: Inbox): InboxGroup[] {
  return [...inbox.review, ...inbox.mine, ...(inbox.waiting ?? [])];
}

/** One section of the inbox with the viewer's marks applied. */
export interface MarkedSection<G extends InboxGroup = InboxGroup> {
  /** The groups to show, pinned ones first. */
  groups: G[];
  /** How many pull requests in the section are snoozed, for a "2 snoozed" line that shows them on request. */
  snoozed: number;
}

/**
 * Takes the snoozed pull requests out of a section and moves the groups holding a pinned one to the top,
 * keeping the section's own order among the pinned groups and among the rest. A group whose pull requests are all
 * snoozed goes; a stack keeps the layers that aren't.
 * @param groups One section's groups, in the order the inbox sorted them.
 * @param marks The viewer's marks.
 * @param now The current time in epoch milliseconds.
 * @param showSnoozed Keep the snoozed pull requests in place, after the viewer asked to see them; they are still counted.
 * @returns The groups to show, and how many pull requests are snoozed.
 */
export function applyMarks<G extends InboxGroup>(groups: G[], marks: InboxMarks, now: number, showSnoozed = false): MarkedSection<G> {
  let snoozed = 0;
  const shown: G[] = [];
  for (const group of groups) {
    const awake = group.pulls.filter((pull) => !isSnoozed(marks, pull, now));
    snoozed += group.pulls.length - awake.length;
    const pulls = showSnoozed ? group.pulls : awake;
    if (pulls.length > 0) shown.push(pulls.length === group.pulls.length ? group : { ...group, pulls });
  }
  const pinned = (group: InboxGroup) => group.pulls.some((pull) => isPinned(marks, pull.url));
  return { groups: [...shown.filter((group) => pinned(group)), ...shown.filter((group) => !pinned(group))], snoozed };
}
