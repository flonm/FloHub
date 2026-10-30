export interface RepoRef {
  owner: string;
  repo: string;
}

export interface PullRef extends RepoRef {
  number: number;
}

const PULL_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/u;
const PULL_TAB = /^\/[^/]+\/[^/]+\/pull\/\d+\/([^/]+)/u;
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

const PULLS_PATH = /^\/([^/]+)\/([^/]+)\/pulls(?:\/|$)/u;

/**
 * Reads the repository whose list of pull requests a github.com URL shows, on any of the sidebar's lists.
 * @param href The page URL.
 * @returns The repository, or null for any other page.
 */
export function parseRepoPullsRef(href: string): RepoRef | null {
  const url = new URL(href);
  if (url.hostname !== "github.com") return null;
  const match = PULLS_PATH.exec(url.pathname);
  if (!match) return null;
  const [, owner, repo] = match as unknown as [string, string, string];
  return { owner, repo };
}

/**
 * @param ref The pull request.
 * @returns A stable key for comparing two references.
 */
export function pullKey(ref: PullRef): string {
  return `${ref.owner}/${ref.repo}#${ref.number}`;
}

const WHOLE_FILES_TAB = /^\/[^/]+\/[^/]+\/pull\/\d+\/(files|changes)\/?$/u;

/**
 * @param pathname A page's path.
 * @returns Whether it's the Files changed tab of the whole pull request, not of one commit or a range of them
 * (`/files/<a>..<b>`, `/changes/<sha>`), which show other lines.
 */
export function isWholeFilesTab(pathname: string): boolean {
  return WHOLE_FILES_TAB.test(pathname);
}

/**
 * @param pathname A pull request page's path.
 * @returns The tab segment to carry over to another pull request, like "/files", or "" for the Conversation tab.
 */
export function pullTab(pathname: string): string {
  const tab = PULL_TAB.exec(pathname)?.[1];
  return tab && TABS.has(tab) ? `/${tab}` : "";
}
