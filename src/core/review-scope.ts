/**
 * Which review requests count in a repository: any that reach the viewer through a team, only those naming them,
 * or none at all.
 */
export type ReviewScope = "teams" | "direct" | "none";

/** Repositories that count only direct requests, by lowercase `owner/name`. */
export const REVIEW_SCOPES_KEY = "directReviewRepos";

/** Repositories that count no review requests, by lowercase `owner/name`; one in neither list counts team requests too. */
export const IGNORED_REPOS_KEY = "ignoredReviewRepos";

const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/u;

/**
 * @param input What the user typed, an `owner/name` or a GitHub link to the repository.
 * @returns The repository as `owner/name`, or null when the input names none.
 */
export function parseRepo(input: string): string | null {
  const trimmed = input
    .trim()
    .replace(/^(https?:\/\/)?github\.com\//iu, "")
    .replace(/(\.git)?\/?$/iu, "");
  const repo = trimmed.split("/").slice(0, 2).join("/");
  return REPO_PATTERN.test(repo) ? repo : null;
}

/**
 * @param stored What sync storage holds under the two keys.
 * @returns Each repository's scope, by lowercase `owner/name`; one left out counts team requests too.
 * A repository in both lists, from two browsers writing at once, counts none.
 */
export function scopesFrom(stored: Record<string, unknown>): Map<string, ReviewScope> {
  const direct = repoList(stored[REVIEW_SCOPES_KEY]).map((repo): [string, ReviewScope] => [repo, "direct"]);
  const ignored = repoList(stored[IGNORED_REPOS_KEY]).map((repo): [string, ReviewScope] => [repo, "none"]);
  return new Map([...direct, ...ignored]);
}

/** @returns Each repository's scope that isn't the default, by lowercase `owner/name`. */
export async function readReviewScopes(): Promise<Map<string, ReviewScope>> {
  return scopesFrom(await chrome.storage.sync.get([REVIEW_SCOPES_KEY, IGNORED_REPOS_KEY]));
}

/**
 * @param repo The repository as `owner/name`.
 * @param scope Which review requests count in it.
 */
export async function writeReviewScope(repo: string, scope: ReviewScope): Promise<void> {
  const scopes = await readReviewScopes();
  if (scope === "teams") scopes.delete(repo.toLowerCase());
  else scopes.set(repo.toLowerCase(), scope);
  const reposWith = (wanted: ReviewScope): string[] =>
    [...scopes].filter(([, value]) => value === wanted).map(([name]) => name).toSorted((a, b) => a.localeCompare(b));
  await chrome.storage.sync.set({ [REVIEW_SCOPES_KEY]: reposWith("direct"), [IGNORED_REPOS_KEY]: reposWith("none") });
}

function repoList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((repo): repo is string => typeof repo === "string") : [];
}
