/** Which review requests count in a repository: any that reach the viewer through a team, or only those naming them. */
export type ReviewScope = "teams" | "direct";

/** Repositories that count only direct requests, by lowercase `owner/name`; every other one counts team requests too. */
export const REVIEW_SCOPES_KEY = "directReviewRepos";

const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;

/**
 * @param input What the user typed, an `owner/name` or a GitHub link to the repository.
 * @returns The repository as `owner/name`, or null when the input names none.
 */
export function parseRepo(input: string): string | null {
  const trimmed = input
    .trim()
    .replace(/^(https?:\/\/)?github\.com\//i, "")
    .replace(/(\.git)?\/?$/i, "");
  const repo = trimmed.split("/").slice(0, 2).join("/");
  return REPO_PATTERN.test(repo) ? repo : null;
}

/** @returns The repositories that count only direct requests, lowercase. */
export async function readDirectRepos(): Promise<Set<string>> {
  const stored = await chrome.storage.sync.get(REVIEW_SCOPES_KEY);
  const repos = stored[REVIEW_SCOPES_KEY];
  return new Set(Array.isArray(repos) ? repos.filter((repo): repo is string => typeof repo === "string") : []);
}

/**
 * @param repo The repository as `owner/name`.
 * @param scope Which review requests count in it.
 */
export async function writeReviewScope(repo: string, scope: ReviewScope): Promise<void> {
  const repos = await readDirectRepos();
  if (scope === "direct") repos.add(repo.toLowerCase());
  else repos.delete(repo.toLowerCase());
  await chrome.storage.sync.set({ [REVIEW_SCOPES_KEY]: [...repos].sort() });
}
