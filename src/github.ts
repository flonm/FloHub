import type { PullRef } from "./pull-ref";
import type { ReviewEvent } from "./shortcuts";
import type { RawPullRequest } from "./reviewers";
import type { RawStack, RawStackPull } from "./stack";
import type { ViewedFile, ViewedFiles } from "./viewed";

const API = "https://api.github.com";

const STACK_PULL_FRAGMENT = `
fragment StackPull on PullRequest {
  number
  title
  url
  state
  isDraft
  mergeable
  reviewDecision
  createdAt
  lastEditedAt
  mergedAt
  statusCheckRollup { state }
  latestOpinionatedReviews(first: 20, writersOnly: true) { nodes { state } }
  reviewThreads(first: 100) { totalCount nodes { isResolved } }
  timelineItems(last: 20, itemTypes: [HEAD_REF_FORCE_PUSHED_EVENT, PULL_REQUEST_COMMIT, PULL_REQUEST_REVIEW, RENAMED_TITLE_EVENT]) {
    nodes {
      __typename
      ... on HeadRefForcePushedEvent { createdAt }
      ... on RenamedTitleEvent { createdAt }
      ... on PullRequestReview { submittedAt }
      ... on PullRequestCommit { commit { committedDate } }
    }
  }
}`;

const OVERVIEW_QUERY = `
${STACK_PULL_FRAGMENT}
query ($owner: String!, $name: String!, $number: Int!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      ...StackPull
      baseRefName
      author { login }
      viewerCanUpdate
      reviewRequests(first: 50) {
        nodes {
          requestedReviewer {
            __typename
            ... on User { login avatarUrl url }
            ... on Bot { login avatarUrl url }
            ... on Mannequin { login avatarUrl url }
            ... on Team { name combinedSlug avatarUrl url }
          }
        }
      }
      reviews(last: 100) {
        nodes {
          state
          submittedAt
          author { __typename login avatarUrl url }
        }
      }
      stack {
        number
        size
        baseRefName
        entries(first: 50) { nodes { position pullRequest { ...StackPull } } }
      }
    }
  }
}`;

const VIEWED_FILES_QUERY = `
query ($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id
      files(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { path viewerViewedState additions deletions }
      }
    }
  }
}`;

const MAX_FILE_PAGES = 30;

interface RawViewedFiles {
  repository: {
    pullRequest: {
      id: string;
      files: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ViewedFile[] } | null;
    } | null;
  } | null;
}

export interface RawOverview {
  viewer: { login: string };
  repository: {
    pullRequest: (RawPullRequest & RawStackPull & { baseRefName: string; stack: RawStack | null }) | null;
  } | null;
}

export type Overview = RawOverview & {
  /** Fields GitHub left out because the token cannot read them. */
  unreadable: string[];
};

export type FailureCode = "no-token" | "unauthorized" | "failed";

export class GitHubError extends Error {
  constructor(
    readonly code: FailureCode,
    message: string,
  ) {
    super(message);
  }
}

/** @returns The stored personal access token, or an empty string. */
export async function readToken(): Promise<string> {
  const { token } = await chrome.storage.local.get("token");
  return typeof token === "string" ? token : "";
}

/** @param token The personal access token to store; an empty string removes it. */
export async function writeToken(token: string): Promise<void> {
  if (token) await chrome.storage.local.set({ token });
  else await chrome.storage.local.remove("token");
}

/**
 * Fetches the viewer, a pull request's review requests and review history, and its stack.
 * @param ref The pull request.
 * @returns The raw query result, with the fields the token could not read.
 */
export async function fetchOverview(ref: PullRef): Promise<Overview> {
  const { data, unreadable } = await graphql<RawOverview>(OVERVIEW_QUERY, {
    owner: ref.owner,
    name: ref.repo,
    number: ref.number,
  });
  if (!data.repository?.pullRequest) {
    const reason = unreadable.length > 0 ? ` (${unreadable.join(", ")})` : "";
    throw new GitHubError("failed", `The token cannot see ${ref.owner}/${ref.repo}#${ref.number}${reason}.`);
  }
  return { ...data, unreadable };
}

/**
 * Asks a reviewer for another review, keeping every other pending request.
 * @param ref The pull request.
 * @param login The reviewer to ask again.
 */
export async function rerequestReview(ref: PullRef, login: string): Promise<void> {
  await request(`${pullPath(ref)}/requested_reviewers`, {
    method: "POST",
    body: JSON.stringify({ reviewers: [login] }),
  });
}

/**
 * Fetches the viewer's Viewed mark on every changed file, 100 per request.
 * @param ref The pull request.
 * @returns The pull request's node id and each file's state.
 */
export async function fetchViewedFiles(ref: PullRef): Promise<ViewedFiles> {
  const files: ViewedFile[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_FILE_PAGES; page++) {
    const variables = { owner: ref.owner, name: ref.repo, number: ref.number, after };
    const result: { data: RawViewedFiles } = await graphql<RawViewedFiles>(VIEWED_FILES_QUERY, variables);
    const pullRequest: NonNullable<RawViewedFiles["repository"]>["pullRequest"] = result.data.repository?.pullRequest ?? null;
    if (!pullRequest?.files) throw new GitHubError("failed", "This token cannot read which files you viewed.");
    files.push(...pullRequest.files.nodes);
    if (!pullRequest.files.pageInfo.hasNextPage) return { pullRequestId: pullRequest.id, files };
    after = pullRequest.files.pageInfo.endCursor;
  }
  throw new GitHubError("failed", "The pull request has too many files to track which ones you viewed.");
}

/**
 * Marks a changed file as viewed or unviewed for the token's user.
 * @param pullRequestId The pull request's node id.
 * @param path The file.
 * @param viewed The mark to set.
 */
export async function setFileViewed(pullRequestId: string, path: string, viewed: boolean): Promise<void> {
  const field = viewed ? "markFileAsViewed" : "unmarkFileAsViewed";
  const { data } = await graphql<Record<string, unknown>>(
    `mutation ($pullRequestId: ID!, $path: String!) { ${field}(input: { pullRequestId: $pullRequestId, path: $path }) { clientMutationId } }`,
    { pullRequestId, path },
  );
  if (!data[field]) throw new GitHubError("failed", "GitHub did not save the change. Check the token's permissions.");
}

/**
 * Reminds a requested reviewer: removing and re-adding the review request makes GitHub send a new notification,
 * while asking again for a pending reviewer does nothing. Re-adding is retried once, and a failure says so,
 * because the request is gone at that point.
 * @param ref The pull request.
 * @param reviewer A requested user, or a team by its `org/slug`.
 */
export async function pokeReviewer(ref: PullRef, reviewer: { kind: "user" | "team"; name: string }): Promise<void> {
  const path = `${pullPath(ref)}/requested_reviewers`;
  const body = JSON.stringify(
    reviewer.kind === "team" ? { team_reviewers: [reviewer.name.split("/").at(-1)] } : { reviewers: [reviewer.name] },
  );
  await request(path, { method: "DELETE", body });
  try {
    await request(path, { method: "POST", body });
  } catch {
    try {
      await request(path, { method: "POST", body });
    } catch (error) {
      const reason = error instanceof GitHubError ? error.message : "GitHub did not answer.";
      throw new GitHubError(
        "failed",
        `Removed the review request for ${reviewer.name} but could not add it back (${reason}). Re-request ${reviewer.name} by hand.`,
      );
    }
  }
}

/**
 * @param ref The pull request.
 * @returns How many draft comments the viewer's unsubmitted review holds, or null when there is none.
 */
export async function fetchPendingComments(ref: PullRef): Promise<number | null> {
  const pending = await findPendingReview(ref);
  if (!pending) return null;
  const comments = (await request(`${pullPath(ref)}/reviews/${pending.id}/comments?per_page=100`, {})) as unknown[];
  return comments.length;
}

/**
 * Submits a review. A pending review the viewer started is submitted with its draft comments,
 * the way GitHub's own "Submit review" does; otherwise a new review is created.
 * @param ref The pull request.
 * @param event Approve or request changes.
 * @param body The review comment; may be empty.
 */
export async function submitReview(ref: PullRef, event: ReviewEvent, body: string): Promise<void> {
  const pending = await findPendingReview(ref);
  const payload = JSON.stringify(body ? { event, body } : { event });
  const path = pending ? `${pullPath(ref)}/reviews/${pending.id}/events` : `${pullPath(ref)}/reviews`;
  await request(path, { method: "POST", body: payload });
}

async function findPendingReview(ref: PullRef): Promise<{ id: number } | null> {
  const reviews = (await request(`${pullPath(ref)}/reviews?per_page=100`, {})) as { id: number; state: string }[];
  return reviews.find((review) => review.state === "PENDING") ?? null;
}

function pullPath(ref: PullRef): string {
  return `/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`;
}

/**
 * @param token A token to check instead of the stored one.
 * @returns The login the token belongs to.
 */
export async function fetchViewerLogin(token?: string): Promise<string> {
  const { data } = await graphql<{ viewer: { login: string } }>("query { viewer { login } }", {}, token);
  return data.viewer.login;
}

async function graphql<T>(
  query: string,
  variables: Record<string, unknown>,
  token?: string,
): Promise<{ data: T; unreadable: string[] }> {
  const body = (await request("/graphql", { method: "POST", body: JSON.stringify({ query, variables }) }, token)) as {
    data?: T | null;
    errors?: { message: string; path?: (string | number)[] }[];
  };
  const errors = body.errors ?? [];
  if (!body.data) {
    throw new GitHubError("failed", errors.map((error) => error.message).join(" ") || "GitHub returned no data.");
  }
  const unreadable = errors.map(
    (error) => error.path?.filter((segment): segment is string => typeof segment === "string").at(-1) ?? error.message,
  );
  return { data: body.data, unreadable: [...new Set(unreadable)] };
}

async function request(path: string, init: RequestInit, explicitToken?: string): Promise<unknown> {
  const token = explicitToken ?? (await readToken());
  if (!token) throw new GitHubError("no-token", "Add a GitHub token to show reviewers.");
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (response.status === 401) throw new GitHubError("unauthorized", "GitHub rejected the token.");
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (body as { message?: string } | null)?.message ?? response.statusText;
    throw new GitHubError("failed", `GitHub answered ${response.status}: ${message}`);
  }
  return body;
}
