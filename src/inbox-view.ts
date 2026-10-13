import { formatAge } from "./age";
import type { FailureCode } from "./github";
import type { Inbox } from "./inbox";

/** What the popup shows instead of the inbox, or over it. */
export interface Problem {
  kind: "no-token" | "unauthorized" | "scopes" | "error";
  message: string;
}

/**
 * @param code Why the refresh failed.
 * @param message The service worker's explanation.
 * @returns The problem to show.
 */
export function problemFor(code: FailureCode, message: string): Problem {
  return { kind: code === "failed" ? "error" : code, message };
}

/**
 * @param problem The problem.
 * @returns Whether it hides the inbox, since a refresh cannot fix it without a new token.
 */
export function blocksInbox(problem: Problem | null): boolean {
  return problem !== null && problem.kind !== "error";
}

/**
 * @param inbox The inbox.
 * @returns Whether nothing waits for review and the viewer has no open pull requests.
 */
export function isEmptyInbox(inbox: Pick<Inbox, "review" | "mine">): boolean {
  return inbox.review.length === 0 && inbox.mine.length === 0;
}

/**
 * @param fetchedAt When the inbox was fetched, in epoch milliseconds.
 * @param now The current time in epoch milliseconds.
 * @returns A line like "Updated 5 minutes ago".
 */
export function updatedLabel(fetchedAt: number, now: number): string {
  return `Updated ${formatAge(new Date(fetchedAt).toISOString(), now).spoken}`;
}

/**
 * Moves the selection in the popup's list of rows.
 * @param key The pressed key.
 * @param index The focused row, or -1 when focus is outside the list.
 * @param count How many rows there are.
 * @returns The row to focus, or null when the key does not move the selection.
 */
export function moveSelection(key: string, index: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case "ArrowDown":
    case "j":
      return index < 0 ? 0 : Math.min(index + 1, count - 1);
    case "ArrowUp":
    case "k":
      return index < 0 ? 0 : Math.max(index - 1, 0);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/**
 * @param tabUrl The address a tab shows.
 * @param pullUrl A pull request's address.
 * @returns Whether the tab shows that pull request, on any of its subpages.
 */
export function showsPull(tabUrl: string, pullUrl: string): boolean {
  try {
    const tab = new URL(tabUrl);
    const pull = new URL(pullUrl);
    if (tab.origin !== pull.origin) return false;
    const path = tab.pathname.toLowerCase();
    const base = pull.pathname.toLowerCase().replace(/\/$/, "");
    return path === base || path.startsWith(`${base}/`);
  } catch {
    return false;
  }
}
