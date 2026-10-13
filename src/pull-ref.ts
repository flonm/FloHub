export interface PullRef {
  owner: string;
  repo: string;
  number: number;
}

const PULL_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/;
const PULL_TAB = /^\/[^/]+\/[^/]+\/pull\/\d+\/([^/]+)/;
const TABS = new Set(["files", "changes", "commits", "checks"]);

/**
 * Reads the pull request a github.com URL points at, on any of its tabs.
 * @param href The page URL.
 * @returns The pull request, or null for any other page.
 */
export function parsePullRef(href: string): PullRef | null {
  const url = new URL(href);
  if (url.hostname !== "github.com") return null;
  const match = PULL_PATH.exec(url.pathname);
  if (!match) return null;
  const [, owner, repo, number] = match as unknown as [string, string, string, string];
  return { owner, repo, number: Number(number) };
}

/**
 * @param ref The pull request.
 * @returns A stable key for comparing two references.
 */
export function pullKey(ref: PullRef): string {
  return `${ref.owner}/${ref.repo}#${ref.number}`;
}

/**
 * @param pathname A pull request page's path.
 * @returns The tab segment to carry over to another pull request, like "/files", or "" for the Conversation tab.
 */
export function pullTab(pathname: string): string {
  const tab = PULL_TAB.exec(pathname)?.[1];
  return tab && TABS.has(tab) ? `/${tab}` : "";
}
