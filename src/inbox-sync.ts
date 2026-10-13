import { fetchInbox, GitHubError, readToken } from "./github";
import { buildInbox, type Inbox } from "./inbox";

const STORAGE_KEY = "inbox";
export const INBOX_ALARM = "inbox";
export const INBOX_PERIOD_MINUTES = 5;

let running: Promise<Inbox> | null = null;

/**
 * Fetches the inbox, stores it for the popup and shows the review count on the toolbar icon.
 * Calls that arrive while a fetch runs share it.
 * @returns The fresh inbox.
 */
export function refreshInbox(): Promise<Inbox> {
  running ??= fetchAndStore().finally(() => {
    running = null;
  });
  return running;
}

async function fetchAndStore(): Promise<Inbox> {
  const token = await readToken();
  if (!token) {
    await clearInbox();
    throw new GitHubError("no-token", "Add a GitHub token to see your inbox.");
  }
  const raw = await fetchInbox().catch(async (error: unknown) => {
    // A count the token can no longer refresh would sit on the toolbar icon for good.
    if (error instanceof GitHubError && error.code !== "failed") await clearInbox();
    throw error;
  });
  const inbox = buildInbox(raw, Date.now());
  if ((await readToken()) !== token) throw new GitHubError("failed", "The token changed. Try again.");
  await chrome.storage.local.set({ [STORAGE_KEY]: inbox });
  await showBadge(inbox.reviewCount);
  return inbox;
}

/** @returns The last stored inbox, or null. */
export async function readStoredInbox(): Promise<Inbox | null> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return (stored[STORAGE_KEY] as Inbox | undefined) ?? null;
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
