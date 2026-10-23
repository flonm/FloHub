import type { InboxPull } from "./inbox";
import { type InboxMarks, isSnoozed } from "./inbox-marks";
import type { Turn, TurnCode, TurnReason } from "./turn";

/** A desktop notification to show after the inbox refreshed. */
export interface InboxAlert {
  /** Stable for the same pull request and reason, so `chrome.notifications` replaces an alert instead of stacking it. */
  id: string;
  title: string;
  message: string;
  /** The page a click opens. */
  url: string;
}

/** The most alerts one refresh shows, the last of them summing up the rest when there are more. */
export const MAX_ALERTS = 5;

/** The id and link of the alert that sums up the ones past {@link MAX_ALERTS}. */
const MORE_ID = "inbox-alerts-more";
const MORE_URL = "https://github.com/pulls";

/** The pull request fields the alerts read; `turn` is missing from an inbox stored before turns existed. */
type AlertPull = Pick<InboxPull, "url" | "number" | "title" | "tone" | "label" | "author" | "lastActivity"> & { turn?: Turn };

interface AlertGroup {
  repo: string;
  pulls: AlertPull[];
}

/** The parts of an `Inbox` the alerts read. */
interface AlertInbox {
  viewer: string;
  review: AlertGroup[];
  mine: AlertGroup[];
  waiting?: AlertGroup[];
}

/** Reasons that describe a wait rather than ask for anything, so their showing up alone is no news. */
const QUIET = new Set<TurnCode>(["waiting-on-reviewers", "waiting-on-author", "draft"]);

/** Reasons worth an alert on the viewer's own pull request even while it isn't their turn. */
const OWN_NEWS = new Set<TurnCode>(["ready-to-merge", "checks-failed"]);

/**
 * The desktop notifications for what changed between two refreshes of the inbox:
 * - a pull request that became the viewer's turn, titled with its most pressing reason;
 * - one that stayed their turn but gained a reason it didn't have, such as failed checks on top of replies;
 * - the viewer's own pull request turning ready to merge, or its checks failing.
 *
 * The first inbox has nothing to compare with, and neither has one stored before turns existed, so both alert nothing.
 * Snoozed pull requests are skipped. Past {@link MAX_ALERTS}, the last alert sums up the rest.
 * @param previous The inbox before the refresh, undefined on the first one.
 * @param next The inbox the refresh fetched.
 * @param marks The viewer's marks, for the snoozes.
 * @param now The current time in epoch milliseconds.
 * @returns The alerts to show, in the inbox's order.
 */
export function inboxAlerts(previous: AlertInbox | undefined, next: AlertInbox, marks: InboxMarks, now: number): InboxAlert[] {
  if (!previous || !hasTurns(previous)) return [];
  const before = new Map(entriesOf(previous).map((entry) => [entry.pull.url, entry.pull]));
  const alerts: InboxAlert[] = [];
  const seen = new Set<string>();
  for (const { pull, repo } of entriesOf(next)) {
    // A pull request shows in one section only, but skip a repeat in case two searches found it.
    if (seen.has(pull.url) || isSnoozed(marks, pull, now)) continue;
    seen.add(pull.url);
    const reason = newsOf(before.get(pull.url), pull, next.viewer);
    if (reason) {
      alerts.push({ id: `${pull.url}#${reason.code}`, title: reasonTitle(reason), message: `${repo}#${pull.number} ${pull.title}`, url: pull.url });
    }
  }
  if (alerts.length <= MAX_ALERTS) return alerts;
  const rest = alerts.slice(MAX_ALERTS - 1);
  return [
    ...alerts.slice(0, MAX_ALERTS - 1),
    { id: MORE_ID, title: `And ${rest.length} more`, message: rest.map((alert) => alert.title).join(", "), url: MORE_URL },
  ];
}

function entriesOf(inbox: AlertInbox): { pull: AlertPull; repo: string }[] {
  return [...inbox.review, ...inbox.mine, ...(inbox.waiting ?? [])].flatMap((group) =>
    group.pulls.map((pull) => ({ pull, repo: group.repo })),
  );
}

/** An empty inbox compares fine; one with pull requests but no turns on any was stored before turns existed. */
function hasTurns(inbox: AlertInbox): boolean {
  const entries = entriesOf(inbox);
  return entries.length === 0 || entries.some((entry) => entry.pull.turn !== undefined);
}

/**
 * @param before The pull request in the previous inbox, undefined when it wasn't there.
 * @param after The pull request now.
 * @param viewer The viewer's login, to tell their own pull requests.
 * @returns The reason to alert with, or null when nothing new happened.
 */
function newsOf(before: AlertPull | undefined, after: AlertPull, viewer: string): TurnReason | null {
  const reasons = reasonsOf(after, viewer);
  const had = new Set(before ? reasonsOf(before, viewer).map((reason) => reason.code) : []);
  const fresh = reasons.filter((reason) => !had.has(reason.code));
  if (after.turn?.whose === "you") {
    if (before?.turn?.whose !== "you") return reasons[0] ?? null;
    return fresh.find((reason) => !QUIET.has(reason.code)) ?? null;
  }
  if (after.author !== viewer) return null;
  return fresh.find((reason) => OWN_NEWS.has(reason.code)) ?? null;
}

/**
 * The turn's reasons, most pressing first, and on the viewer's own pull request the status label's
 * "Ready to merge" or "Checks failed" when the turn doesn't say it, for a pull request whose turn is missing.
 */
function reasonsOf(pull: AlertPull, viewer: string): TurnReason[] {
  const reasons = [...(pull.turn?.reasons ?? [])];
  if (pull.author !== viewer) return reasons;
  const codes = new Set(reasons.map((reason) => reason.code));
  if (pull.tone === "success" && pull.label === "Ready to merge" && !codes.has("ready-to-merge")) reasons.push({ code: "ready-to-merge" });
  if (pull.label === "Checks failed" && !codes.has("checks-failed")) reasons.push({ code: "checks-failed" });
  return reasons;
}

/**
 * @param reason Why a pull request waits.
 * @returns A short title for it, like "Review requested", "2 new replies" or "Changes requested by alice".
 */
export function reasonTitle(reason: TurnReason): string {
  switch (reason.code) {
    case "requested": {
      return "Review requested";
    }
    case "rerequested": {
      return "Re-requested";
    }
    case "replies": {
      const count = reason.count ?? 1;
      return count === 1 ? "1 new reply" : `${count} new replies`;
    }
    case "pushed-since-review": {
      return "New commits since your review";
    }
    case "changes-requested": {
      return withWho("Changes requested by", reason.who, "Changes requested");
    }
    case "ask-again": {
      return withWho("Ask again for a review from", reason.who, "Ask again for a review");
    }
    case "checks-failed": {
      return "Checks failed";
    }
    case "conflict": {
      return "Merge conflict";
    }
    case "ready-to-merge": {
      return "Ready to merge";
    }
    case "ask-for-review": {
      return "Ask for a review";
    }
    case "waiting-on-reviewers": {
      return withWho("Waiting for", reason.who, "Waiting for reviewers");
    }
    case "waiting-on-author": {
      return "Waiting for the author";
    }
    case "draft": {
      return "Draft";
    }
  }
}

/**
 * @param lead The title before the names, like "Changes requested by".
 * @param who The logins, if the reason names any.
 * @param bare The title when it names nobody.
 * @returns The title with up to two names, and a count for the rest.
 */
function withWho(lead: string, who: string[] | undefined, bare: string): string {
  if (!who || who.length === 0) return bare;
  const names = who.length <= 2 ? who.join(" and ") : `${who[0]} and ${who.length - 1} others`;
  return `${lead} ${names}`;
}
