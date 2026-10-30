import { fetchInbox, fetchOpenPulls, GitHubError, OPEN_PULLS_SEARCH, readToken } from "./github";
import { buildInbox, groupOthers, type Inbox, type InboxGroup, type RawInbox } from "../core/inbox";
import { readDirectRepos } from "../core/review-scope";
import { badgeCount, MARKS_KEY, pruneMarks, readMarks } from "../core/inbox-marks";
import { loadProfiles, profileInbox } from "../core/profiles";


const STORAGE_KEY = "inbox";
/** Where the pull requests loaded for "Everything else" are kept, apart from the inbox the alarm refreshes. */
export const EVERYTHING_KEY = "inboxEverything";
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
 * @returns The fresh inbox.
 */
export async function refreshInbox(maxAgeMs?: number): Promise<Inbox> {
  if (maxAgeMs !== undefined && !running) {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const inbox = stored[STORAGE_KEY] as Inbox | undefined;
    if (isFresh(inbox, Date.now(), maxAgeMs)) return inbox;
  }
  running ??= (async () => {
    try {
      return await fetchAndStore();
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

async function fetchAndStore(): Promise<Inbox> {
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
  const stored = await chrome.storage.local.get(MARKS_KEY);
  const marks = readMarks(stored[MARKS_KEY]);
  // A pull request that left the inbox was merged, closed or stopped waiting: its marks go with it.
  const kept = pruneMarks(marks, inbox, now);
  await chrome.storage.local.set({ [STORAGE_KEY]: inbox, ...(kept !== marks && { [MARKS_KEY]: kept }) });
  const shown = profileInbox(inbox, await loadProfiles());
  await showBadge(badgeCount(shown, kept, now));
  return inbox;
}

/** Counts the stored inbox on the badge again, for when the viewer pinned or snoozed something, or switched profiles. */
export async function refreshBadge(): Promise<void> {
  const stored = await chrome.storage.local.get([STORAGE_KEY, MARKS_KEY]);
  const inbox = stored[STORAGE_KEY] as Inbox | undefined;
  if (!inbox) return;
  const shown = profileInbox(inbox, await loadProfiles());
  await showBadge(badgeCount(shown, readMarks(stored[MARKS_KEY]), Date.now()));
}

/** Drops the stored inbox and the badge, for when the token changes. */
export async function clearInbox(): Promise<void> {
  await chrome.storage.local.remove([STORAGE_KEY, EVERYTHING_KEY]);
  await showBadge(0);
}

async function showBadge(count: number): Promise<void> {
  await chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#0969da" });
}

/**
 * @param scope An owner, or a repository as `owner/name`.
 * @returns The search qualifier that finds its pull requests.
 */
export function scopeQualifier(scope: string): string {
  return scope.includes("/") ? `repo:${scope}` : `user:${scope}`;
}

/** Every open pull request of some owners and repositories, loaded only when the viewer asks, since a busy organization has many. */
export interface Everything {
  /** Owners, and repositories as `owner/name`. */
  scopes: string[];
  fetchedAt: number;
  groups: InboxGroup[];
  /** Whether some owner had more than one search returns. */
  capped: boolean;
  /** The same search on GitHub. */
  searchUrl: string;
}

/**
 * @param scopes Owners, and repositories as `owner/name`.
 * @returns The address of GitHub's own list of their open pull requests.
 */
export function everythingSearchUrl(scopes: string[]): string {
  const query = [OPEN_PULLS_SEARCH, ...scopes.map((scope) => scopeQualifier(scope))].join(" ");
  return `https://github.com/pulls?q=${encodeURIComponent(query)}`;
}

/**
 * Loads every open pull request of the owners and repositories and keeps them for the popup.
 * @param scopes Owners, and repositories as `owner/name`.
 * @returns What was loaded.
 */
export async function loadEverything(scopes: string[]): Promise<Everything> {
  if (scopes.length === 0) throw new GitHubError("failed", "No repository owner to search yet.");
  const { viewer, pulls, capped } = await fetchOpenPulls(scopes.map((scope) => scopeQualifier(scope)));
  const everything: Everything = { scopes, fetchedAt: Date.now(), groups: groupOthers(pulls, viewer), capped, searchUrl: everythingSearchUrl(scopes) };
  await chrome.storage.local.set({ [EVERYTHING_KEY]: everything });
  return everything;
}
