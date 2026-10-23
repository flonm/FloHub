import { fetchInbox, GitHubError, readToken } from "./github";
import { buildInbox, type Inbox, type RawInbox } from "../core/inbox";
import { readDirectRepos } from "../core/review-scope";
import { type InboxAlert, inboxAlerts } from "../core/inbox-alerts";
import { MARKS_KEY, pruneMarks, readMarks } from "../core/inbox-marks";

/** Whether the viewer wants desktop notifications, in storage.local; on unless turned off. */
export const NOTIFY_KEY = "inboxNotify";
/** The notification that sums up the rest, which opens GitHub's list of pull requests. */
const MORE_URL = "https://github.com/pulls";

const STORAGE_KEY = "inbox";
export const INBOX_ALARM = "inbox";
export const INBOX_PERIOD_MINUTES = 5;

let running: Promise<Inbox> | null = null;

/**
 * Schedules the periodic inbox refresh unless it is already scheduled.
 * The service worker starts again whenever a GitHub page wakes it, and creating an alarm
 * that exists replaces it, which would restart the countdown so it never fires while you browse.
 */
export async function ensureInboxAlarm(): Promise<void> {
  const alarm = await chrome.alarms.get(INBOX_ALARM);
  if (alarm?.periodInMinutes === INBOX_PERIOD_MINUTES) return;
  await chrome.alarms.create(INBOX_ALARM, { periodInMinutes: INBOX_PERIOD_MINUTES });
}

/**
 * @param inbox The stored inbox, if any.
 * @param now The current time.
 * @param maxAgeMs How old the inbox may be; without it, no inbox is fresh enough.
 * @returns Whether the inbox can be shown without fetching it again.
 */
export function isFresh(inbox: Inbox | undefined, now: number, maxAgeMs?: number): inbox is Inbox {
  return inbox !== undefined && maxAgeMs !== undefined && now - inbox.fetchedAt < maxAgeMs;
}

/**
 * Fetches the inbox, stores it for the popup and shows the review count on the toolbar icon.
 * Calls that arrive while a fetch runs share it.
 * @param maxAgeMs How old a stored inbox may be to be returned instead of fetching; omit it to always fetch.
 * @param notify Whether to tell the viewer, with desktop notifications, what became theirs to do since the last
 *   refresh. The scheduled refresh does; one the popup asks for doesn't, since the viewer is looking at it.
 * @returns The fresh inbox.
 */
export async function refreshInbox(maxAgeMs?: number, notify = false): Promise<Inbox> {
  if (maxAgeMs !== undefined && !running) {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const inbox = stored[STORAGE_KEY] as Inbox | undefined;
    if (isFresh(inbox, Date.now(), maxAgeMs)) return inbox;
  }
  running ??= (async () => {
    try {
      return await fetchAndStore(notify);
    } finally {
      running = null;
    }
  })();
  return running;
}

/**
 * Fetches the inbox again once any running fetch is done, for when a setting it was built with changed.
 * @returns The fresh inbox.
 */
export async function refreshInboxAgain(): Promise<Inbox> {
  try {
    await running;
  } catch {
    // The fetch below reports its own failure.
  }
  return refreshInbox();
}

async function fetchAndStore(notify: boolean): Promise<Inbox> {
  const token = await readToken();
  if (!token) {
    await clearInbox();
    throw new GitHubError("no-token", "Add a GitHub token to see your inbox.");
  }
  let raw: RawInbox;
  try {
    raw = await fetchInbox();
  } catch (error) {
    // A count the token can no longer refresh would sit on the toolbar icon for good.
    if (error instanceof GitHubError && error.code !== "failed") await clearInbox();
    throw error;
  }
  const now = Date.now();
  const inbox = buildInbox(raw, now, await readDirectRepos());
  if ((await readToken()) !== token) throw new GitHubError("failed", "The token changed. Try again.");
  const stored = await chrome.storage.local.get([STORAGE_KEY, MARKS_KEY, NOTIFY_KEY]);
  const previous = stored[STORAGE_KEY] as Inbox | undefined;
  const marks = readMarks(stored[MARKS_KEY]);
  // A pull request that left the inbox was merged, closed or stopped waiting: its marks go with it.
  const kept = pruneMarks(marks, inbox, now);
  await chrome.storage.local.set({ [STORAGE_KEY]: inbox, ...(kept !== marks && { [MARKS_KEY]: kept }) });
  if (notify && stored[NOTIFY_KEY] !== false && previous?.viewer === inbox.viewer) await showAlerts(inboxAlerts(previous, inbox, kept, now));
  await showBadge(inbox.turnCount ?? inbox.reviewCount);
  return inbox;
}

/** @param alerts What became the viewer's to do, each shown as a desktop notification. */
async function showAlerts(alerts: InboxAlert[]): Promise<void> {
  await Promise.all(
    alerts.map(async (alert) =>
      chrome.notifications.create(alert.id, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
        title: alert.title,
        message: alert.message,
      }),
    ),
  );
}

/**
 * The pull request a notification opens is in its id, before the reason, so a click after the service worker slept
 * still knows where to go.
 * @param id A notification's id.
 * @returns The pull request it opens, or GitHub's list for the one that sums up the rest.
 */
export function alertUrl(id: string): string {
  const url = id.split("#", 1)[0] ?? "";
  return url.startsWith("https://github.com/") ? url : MORE_URL;
}

/** Drops the stored inbox and the badge, for when the token changes. */
export async function clearInbox(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
  await showBadge(0);
}

async function showBadge(count: number): Promise<void> {
  await chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#0969da" });
}
