import type { RawDiscussionComment } from "../core/discussion";
import { assembleRawInbox, chunk, inboxIds, type RawInbox, type RawInboxIds, type RawInboxPull } from "../core/inbox";
import type { PullRef } from "../core/pull-ref";
import type { ReviewEvent } from "../core/shortcuts";
import type { RawPullRequest } from "../core/reviewers";
import type { RawStack, RawStackPull } from "../core/stack";
import type { ViewedFile, ViewedFiles } from "../core/viewed";
import { type CommentLink, type CommentPlace, threadNumber } from "../core/comment-jump";
import type { ReviewAction, ReviewDiscussion } from "../core/threads";
import type { VersionFile } from "../core/interdiff";
import { baseBranches, deriveVersions, pickBase, type RawBasePull, type RawVersionPull, type VersionHistory } from "../core/versions";

const API = "https://api.github.com";

const STACK_PULL_FRAGMENT = `
fragment StackPull on PullRequest {
  number
  title
  url
  state
  isDraft
  isInMergeQueue
  mergeable
  reviewDecision
  createdAt
  lastEditedAt
  mergedAt
  statusCheckRollup { state }
  labels(first: 20) { nodes { name } }
  latestOpinionatedReviews(first: 20, writersOnly: true) { nodes { state author { __typename login } } }
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
      baseRefOid
      headRefOid
      author { login }
      viewerCanUpdate
      forcePushes: timelineItems(last: 1, itemTypes: [HEAD_REF_FORCE_PUSHED_EVENT]) {
        totalCount
        nodes { ... on HeadRefForcePushedEvent { createdAt } }
      }
      dismissals: timelineItems(last: 100, itemTypes: [REVIEW_DISMISSED_EVENT]) {
        nodes { ... on ReviewDismissedEvent { previousReviewState review { url } } }
      }
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
          id
          state
          submittedAt
          bodyText
          bodyHTML
          url
          author { __typename login avatarUrl url }
          commit { oid }
        }
      }
      comments(last: 50) {
        nodes {
          bodyText
          bodyHTML
          url
          createdAt
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

const INBOX_DETAILS_QUERY = `
${STACK_PULL_FRAGMENT}
fragment InboxPull on PullRequest {
  id
  ...StackPull
  additions
  deletions
  repository { nameWithOwner }
  author { login avatarUrl }
  latestReviews(first: 20) { nodes { state author { login } submittedAt } }
  reviewRequests(first: 50) {
    nodes { requestedReviewer { ... on User { login } ... on Team { combinedSlug } } }
  }
  reviewRequestedEvents: timelineItems(last: 50, itemTypes: [REVIEW_REQUESTED_EVENT]) {
    nodes { ... on ReviewRequestedEvent { createdAt requestedReviewer { ... on Team { combinedSlug } } } }
  }
  stack {
    number
    size
    entries(first: 50) { nodes { position pullRequest { number } } }
  }
}
query ($ids: [ID!]!) {
  nodes(ids: $ids) { ... on PullRequest { ...InboxPull } }
}`;

/**
 * The searches return only node ids: GitHub resolves a search's fields one pull request after the other, so asking
 * for the details here takes about ten seconds for 70 hits, at the edge of its timeout. The details come in chunks
 * of {@link INBOX_CHUNK}, fetched side by side: smaller chunks finish in about two seconds, larger ones vary more.
 */
const INBOX_IDS_QUERY = `
query ($review: String!, $mine: String!, $waiting: String!) {
  viewer { login }
  review: search(query: $review, type: ISSUE, first: 50) { nodes { ... on PullRequest { id } } }
  mine: search(query: $mine, type: ISSUE, first: 50) { nodes { ... on PullRequest { id } } }
  waiting: search(query: $waiting, type: ISSUE, first: 50) { nodes { ... on PullRequest { id } } }
}`;

const INBOX_CHUNK = 5;

const REVIEW_SEARCH = "is:pr is:open draft:false archived:false review-requested:@me";
const MINE_SEARCH = "is:pr is:open archived:false author:@me";
const WAITING_SEARCH = "is:pr is:open archived:false reviewed-by:@me -author:@me";

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

const VERSIONS_QUERY = `
query ($owner: String!, $name: String!, $number: Int!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      baseRefName
      baseRefOid
      headRefOid
      createdAt
      commits(last: 1) { nodes { commit { oid committedDate } } }
      timelineItems(last: 100, itemTypes: [HEAD_REF_FORCE_PUSHED_EVENT, BASE_REF_CHANGED_EVENT, AUTOMATIC_BASE_CHANGE_SUCCEEDED_EVENT]) {
        nodes {
          __typename
          ... on HeadRefForcePushedEvent {
            createdAt
            actor { login }
            beforeCommit { oid committedDate }
            afterCommit { oid committedDate }
          }
          ... on BaseRefChangedEvent { previousRefName }
          ... on AutomaticBaseChangeSucceededEvent { oldBase }
        }
      }
      dismissals: timelineItems(last: 100, itemTypes: [REVIEW_DISMISSED_EVENT]) {
        nodes { ... on ReviewDismissedEvent { previousReviewState review { url } } }
      }
      reviews(last: 100, states: [APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED]) {
        nodes { state url author { login avatarUrl } submittedAt commit { oid committedDate } }
      }
    }
  }
}`;

const BASE_PULL_FIELDS = `
nodes {
  headRefOid
  isCrossRepository
  commits(last: 1) { nodes { commit { oid committedDate } } }
  timelineItems(last: 100, itemTypes: [HEAD_REF_FORCE_PUSHED_EVENT]) {
    nodes {
      __typename
      ... on HeadRefForcePushedEvent { createdAt beforeCommit { oid committedDate } afterCommit { oid committedDate } }
    }
  }
}`;

const MAX_BASE_BRANCHES = 5;
const MAX_FILE_PAGES = 30;

interface RawViewedFiles {
  repository: {
    pullRequest: {
      id: string;
      files: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ViewedFile[] } | null;
    } | null;
  } | null;
}

interface RawOverview {
  viewer: { login: string };
  repository: {
    pullRequest:
      | (RawPullRequest &
          RawStackPull & {
            baseRefName: string;
            /** Missing from overviews cached before these fields existed. */
            baseRefOid?: string;
            headRefOid?: string;
            stack: RawStack | null;
            /** Missing from overviews cached before general comments were fetched. */
            comments?: { nodes: RawDiscussionComment[] };
            forcePushes: { totalCount: number; nodes: ({ createdAt?: string } | null)[] } | null;
          })
      | null;
  } | null;
}

/** What one version of a pull request changes, against the base it was made on. */
export interface VersionPatch {
  /** The commit the files are diffed against: the merge base of the version and its base. */
  mergeBase: string;
  /** Whether the version descends from the chosen base; if not, the diff may include the base's own changes. */
  onBase: boolean;
  files: VersionFile[];
  /** Whether GitHub cut the file list off at its limit, so files past it are missing. */
  truncated: boolean;
  /**
   * The candidate base the version was compared with. Only the pull request's own base (the first candidate) gives
   * the lines GitHub's diff has, which a new review comment has to be on.
   */
  base: string;
}

export type Overview = RawOverview & {
  /** Fields GitHub left out because the token cannot read them. */
  unreadable: string[];
};

export type FailureCode = "no-token" | "unauthorized" | "scopes" | "failed";

export class GitHubError extends Error {
  constructor(
    readonly code: FailureCode,
    message: string,
    /** The HTTP status GitHub answered with, if it answered. */
    readonly status?: number,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

/** @returns The stored personal access token, or an empty string. */
export async function readToken(): Promise<string> {
  const { token } = await chrome.storage.local.get("token");
  return typeof token === "string" ? token : "";
}

/** @param token The personal access token to store; an empty string removes it. */
export async function writeToken(token: string): Promise<void> {
  await (token ? chrome.storage.local.set({ token }) : chrome.storage.local.remove("token"));
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
 * Fetches every known version of a pull request, and the history of the branch it is based on, for stacks.
 * @param ref The pull request.
 * @returns The versions, oldest first.
 */
export async function fetchVersions(ref: PullRef): Promise<VersionHistory> {
  const { data } = await graphql<{ viewer: { login: string }; repository: { pullRequest: RawVersionPull | null } | null }>(
    VERSIONS_QUERY,
    { owner: ref.owner, name: ref.repo, number: ref.number },
  );
  const pull = data.repository?.pullRequest;
  if (!pull) throw new GitHubError("failed", `The token cannot see ${ref.owner}/${ref.repo}#${ref.number}.`);
  return deriveVersions(pull, await fetchBasePulls(ref, baseBranches(pull).slice(0, MAX_BASE_BRANCHES)), data.viewer.login);
}

async function fetchBasePulls(ref: PullRef, branches: string[]): Promise<RawBasePull[]> {
  const fields = branches.map(
    (_, index) =>
      `b${index}: pullRequests(headRefName: $b${index}, first: 3, states: [OPEN, CLOSED, MERGED], orderBy: { field: UPDATED_AT, direction: DESC }) { ${BASE_PULL_FIELDS} }`,
  );
  const parameters = branches.map((_, index) => `$b${index}: String!`).join(", ");
  const query = `query ($owner: String!, $name: String!, ${parameters}) { repository(owner: $owner, name: $name) { ${fields.join("\n")} } }`;
  const variables = Object.fromEntries(branches.map((branch, index) => [`b${index}`, branch]));
  try {
    const { data } = await graphql<{ repository: Record<string, { nodes: RawBasePull[] } | null> | null }>(query, {
      owner: ref.owner,
      name: ref.repo,
      ...variables,
    });
    return Object.values(data.repository ?? {}).flatMap((connection) => connection?.nodes ?? []);
  } catch {
    return [];
  }
}

/**
 * Fetches what a version changes, diffed against the closest base it was made on: of the candidate bases it descends
 * from and its merge base with the current base, the one with the fewest commits between it and the version. That way
 * an old version in a stack is diffed against the base branch's head from back then, while a head that is merely an
 * old ancestor, like a release pull request's head in a git-flow repository, loses to the closer merge base.
 * @param ref The pull request.
 * @param head The version's commit.
 * @param bases Candidate bases, the current base first; see `baseCandidates`.
 * @returns The changed files.
 */
export async function fetchVersionPatch(ref: PullRef, head: string, bases: string[]): Promise<VersionPatch> {
  const compares: (RawCompare & { base: string })[] = [];
  for (const base of bases) {
    try {
      // One base after the other: the first that GitHub still has is usually the right one
      // oxlint-disable-next-line no-await-in-loop -- each try depends on whether the one before failed
      compares.push({ ...(await fetchCompare(ref, base, head)), base });
    } catch (error) {
      const missing = error instanceof GitHubError && error.status === 404;
      // An earlier head of the base branch may be gone; the version itself being gone fails every try.
      if (missing && base !== bases[0]) continue;
      throw missing ? new GitHubError("failed", `GitHub no longer has commit ${head.slice(0, 7)}.`) : error;
    }
  }
  const compare = compares[pickBase(compares.map((each) => ({ onBase: isOnBase(each), aheadBy: each.ahead_by })))];
  if (!compare) throw new GitHubError("failed", `Could not compare ${head.slice(0, 7)} with its base.`);
  const files = (compare.files ?? []).map((file) => toVersionFile(file));
  return {
    mergeBase: compare.merge_base_commit.sha,
    onBase: isOnBase(compare),
    files,
    truncated: files.length >= MAX_COMPARE_FILES,
    base: compare.base,
  };
}

async function fetchCompare(ref: PullRef, base: string, head: string): Promise<RawCompare> {
  const key = `${ref.owner}/${ref.repo}:${base}...${head}`;
  const cached = compareCache.get(key);
  if (cached) return cached;
  const compare = (await request(`/repos/${ref.owner}/${ref.repo}/compare/${base}...${head}?per_page=1`, {})) as RawCompare;
  compareCache.set(key, compare);
  if (compareCache.size > MAX_CACHED_COMPARES) {
    const [oldest] = compareCache.keys();
    if (oldest !== undefined) compareCache.delete(oldest);
  }
  return compare;
}

function isOnBase(compare: RawCompare): boolean {
  return compare.status === "ahead" || compare.status === "identical";
}

interface RawCompare {
  status: "ahead" | "behind" | "identical" | "diverged";
  ahead_by: number;
  merge_base_commit: { sha: string };
  files?: { filename: string; previous_filename?: string; status: string; patch?: string; sha: string; changes: number }[];
}

/** GitHub's compare API lists at most this many files. */
const MAX_COMPARE_FILES = 300;
const MAX_CACHED_COMPARES = 40;
const compareCache = new Map<string, RawCompare>();

function toVersionFile(file: NonNullable<RawCompare["files"]>[number]): VersionFile {
  return {
    filename: file.filename,
    ...(file.previous_filename && { previousFilename: file.previous_filename }),
    status: file.status,
    // A pure rename or an empty file changes no lines and has no patch; only a binary or huge file lacks one otherwise.
    ...(file.patch === undefined ? (file.changes === 0 ? { patch: "" } : {}) : { patch: file.patch }),
    sha: file.sha,
  };
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
 * Dismisses an approval or change request. GitHub posts the reason on the pull request and notifies the reviewer.
 * @param reviewId The review's node id.
 * @param message Why it no longer applies; GitHub refuses an empty one.
 */
export async function dismissReview(reviewId: string, message: string): Promise<void> {
  await mutate(
    "mutation ($id: ID!, $message: String!) { dismissPullRequestReview(input: { pullRequestReviewId: $id, message: $message }) { clientMutationId } }",
    { id: reviewId, message },
  );
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
    // oxlint-disable-next-line no-await-in-loop -- each page starts after the cursor the one before returned
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
  const { data } = await graphql<Record<typeof field, { clientMutationId: string | null } | null | undefined>>(
    `mutation ($pullRequestId: ID!, $path: String!) { ${field}(input: { pullRequestId: $pullRequestId, path: $path }) { clientMutationId } }`,
    { pullRequestId, path },
  );
  const saved = viewed ? data.markFileAsViewed : data.unmarkFileAsViewed;
  if (!saved) throw new GitHubError("failed", "GitHub did not save the change. Check the token's permissions.");
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
 * GitHub rejects a change request without a comment unless a pending review carries draft comments, through REST and
 * GraphQL alike. A zero-width space passes that check and renders as an empty review.
 */
const EMPTY_CHANGE_REQUEST = "\u{200B}";

/**
 * Submits a review. A pending review the viewer started is submitted with its draft comments,
 * the way GitHub's own "Submit review" does; otherwise a new review is created. A change request
 * may be empty, see {@link EMPTY_CHANGE_REQUEST}.
 * @param ref The pull request.
 * @param event Approve or request changes.
 * @param body The review comment; may be empty.
 */
export async function submitReview(ref: PullRef, event: ReviewEvent, body: string): Promise<void> {
  const pending = await findPendingReview(ref);
  const text = body || (event === "REQUEST_CHANGES" && !pending ? EMPTY_CHANGE_REQUEST : "");
  const payload = JSON.stringify(text ? { event, body: text } : { event });
  const path = pending ? `${pullPath(ref)}/reviews/${pending.id}/events` : `${pullPath(ref)}/reviews`;
  await request(path, { method: "POST", body: payload });
}

async function findPendingReview(ref: PullRef): Promise<{ id: number } | null> {
  const reviews = (await request(`${pullPath(ref)}/reviews?per_page=100`, {})) as { id: number; state: string }[];
  return reviews.find((review) => review.state === "PENDING") ?? null;
}

const REVIEW_THREADS_QUERY = `
query ($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id
      headRefOid
      author { login }
      reviews(states: PENDING, first: 1) { nodes { id commit { oid } } }
      reviewThreads(last: 100) {
        nodes {
          id isResolved isOutdated path line startLine originalLine originalStartLine diffSide resolvedBy { login }
          comments(first: 50) {
            nodes { databaseId author { login avatarUrl } authorAssociation bodyHTML createdAt url state originalCommit { oid } }
          }
        }
      }
    }
  }
}`;

interface RawReviewThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  startLine: number | null;
  originalLine: number | null;
  originalStartLine: number | null;
  diffSide: "LEFT" | "RIGHT";
  resolvedBy: { login: string } | null;
  comments: {
    nodes: {
      databaseId: number | null;
      author: { login: string; avatarUrl: string } | null;
      authorAssociation: string | null;
      bodyHTML: string;
      createdAt: string;
      url: string;
      state: string;
      originalCommit: { oid: string } | null;
    }[];
  };
}

/**
 * Fetches the pull request's review threads, the viewer's own draft comments among them, for the versions view, and
 * what posting to them needs.
 * @param ref The pull request.
 * @returns The last 100 threads, with up to 50 comments each, the pull request's id and the viewer's pending review.
 */
export async function fetchReviewDiscussion(ref: PullRef): Promise<ReviewDiscussion> {
  const { data } = await graphql<{
    repository: {
      pullRequest: {
        id: string;
        headRefOid: string;
        author: { login: string } | null;
        reviews: { nodes: ({ id: string; commit: { oid: string } | null } | null)[] };
        reviewThreads: { nodes: (RawReviewThread | null)[] };
      } | null;
    } | null;
  }>(REVIEW_THREADS_QUERY, { owner: ref.owner, name: ref.repo, number: ref.number });
  const pull = data.repository?.pullRequest;
  if (!pull) throw new GitHubError("failed", `The token cannot see ${ref.owner}/${ref.repo}#${ref.number}.`);
  const [pending] = pull.reviews.nodes;
  const threads = pull.reviewThreads.nodes
    .filter((raw): raw is RawReviewThread => raw !== null)
    .map((raw) => ({
      id: raw.id,
      path: raw.path,
      resolved: raw.isResolved,
      outdated: raw.isOutdated,
      line: raw.line,
      startLine: raw.startLine,
      originalLine: raw.originalLine,
      originalStartLine: raw.originalStartLine,
      side: raw.diffSide,
      resolvedBy: raw.resolvedBy?.login ?? null,
      comments: raw.comments.nodes.map((comment) => ({
        id: comment.databaseId ?? 0,
        author: comment.author?.login ?? null,
        avatarUrl: comment.author?.avatarUrl ?? null,
        html: comment.bodyHTML,
        createdAt: comment.createdAt,
        url: comment.url,
        pending: comment.state === "PENDING",
        association: comment.authorAssociation,
        originalCommit: comment.originalCommit?.oid ?? null,
      })),
    }));
  return {
    threads,
    pullRequestId: pull.id,
    head: pull.headRefOid,
    author: pull.author?.login ?? null,
    pending: pending?.commit ? { id: pending.id, commit: pending.commit.oid } : null,
  };
}

/**
 * Does what the viewer asked for in the versions view. A new comment goes out on its own (REST, on the head) or into
 * the viewer's pending review, started on the head when there is none. A reply joins the pending review when there
 * is one, as GitHub's own reply does, and else goes out at once. The pending review is looked up again here, since
 * the viewer may have submitted or started one since the view loaded.
 * @param ref The pull request.
 * @param action What to do.
 */
export async function runReviewAction(ref: PullRef, action: ReviewAction): Promise<void> {
  if (action.kind === "resolve") {
    const mutation = action.resolved ? "resolveReviewThread" : "unresolveReviewThread";
    await mutate(`mutation ($id: ID!) { ${mutation}(input: { threadId: $id }) { clientMutationId } }`, { id: action.threadId });
    return;
  }
  const { pullRequestId, head, pending } = await fetchReviewDiscussion(ref);
  if (action.kind === "reply") {
    await (pending
      ? mutate(
          "mutation ($review: ID!, $thread: ID!, $body: String!) { addPullRequestReviewThreadReply(input: { pullRequestReviewId: $review, pullRequestReviewThreadId: $thread, body: $body }) { clientMutationId } }",
          { review: pending.id, thread: action.threadId, body: action.body },
        )
      : request(`${pullPath(ref)}/comments/${action.commentId}/replies`, { method: "POST", body: JSON.stringify({ body: action.body }) }));
    return;
  }
  if (head !== action.head) {
    throw new GitHubError("failed", "The author pushed since this diff loaded. Close and reopen Compare versions to comment on the new head.");
  }
  const lines = {
    line: action.line,
    side: action.side,
    ...(action.startLine !== undefined && { start_line: action.startLine, start_side: action.startSide }),
  };
  if (action.mode === "single") {
    if (pending) throw new GitHubError("failed", "You have a pending review: add the comment to it instead.");
    await request(`${pullPath(ref)}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: action.body, commit_id: action.head, path: action.path, ...lines }),
    });
    return;
  }
  if (pending && pending.commit !== action.head) {
    throw new GitHubError("failed", "Your pending review is on an older version. Submit it before commenting on the current one.");
  }
  const review = pending?.id ?? (await startReview(pullRequestId, action.head));
  await mutate(
    "mutation ($review: ID!, $path: String!, $body: String!, $line: Int!, $side: DiffSide!, $startLine: Int, $startSide: DiffSide) { addPullRequestReviewThread(input: { pullRequestReviewId: $review, path: $path, body: $body, line: $line, side: $side, startLine: $startLine, startSide: $startSide }) { thread { id } } }",
    {
      review,
      path: action.path,
      body: action.body,
      line: action.line,
      side: action.side,
      startLine: action.startLine ?? null,
      startSide: action.startSide ?? null,
    },
  );
}

const THREADS_QUERY = `
query ($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(last: 100) { nodes { id comments(first: 1) { nodes { databaseId } } } }
    }
  }
}`;

/**
 * @param ref The pull request.
 * @param link The comment, or the thread an outdated comment's link names instead.
 * @returns Where the comment sits.
 */
export async function fetchReviewComment(ref: PullRef, link: CommentLink): Promise<CommentPlace> {
  const id = link.kind === "comment" ? link.id : await firstCommentOf(ref, link.id);
  const raw = (await request(`/repos/${ref.owner}/${ref.repo}/pulls/comments/${id}`, {})) as {
    path: string;
    original_commit_id: string;
    original_line: number | null;
    original_start_line: number | null;
    line: number | null;
    start_line: number | null;
    side: "LEFT" | "RIGHT" | null;
    created_at: string;
  };
  return {
    path: raw.path,
    originalCommit: raw.original_commit_id,
    originalLine: raw.original_line,
    originalStartLine: raw.original_start_line,
    line: raw.line,
    startLine: raw.start_line,
    side: raw.side ?? "RIGHT",
    createdAt: raw.created_at,
  };
}

/**
 * @param ref The pull request.
 * @param thread The thread's number, as GitHub links an outdated comment.
 * @returns The number of the thread's first comment, the one the thread's position belongs to.
 */
async function firstCommentOf(ref: PullRef, thread: number): Promise<number> {
  const { data } = await graphql<{
    repository: { pullRequest: { reviewThreads: { nodes: { id: string; comments: { nodes: { databaseId: number | null }[] } }[] } } | null } | null;
  }>(THREADS_QUERY, { owner: ref.owner, name: ref.repo, number: ref.number });
  const found = data.repository?.pullRequest?.reviewThreads.nodes.find((node) => threadNumber(node.id) === thread);
  const id = found?.comments.nodes[0]?.databaseId;
  if (id === undefined || id === null) throw new GitHubError("failed", "Could not find the comment among the pull request's last 100 threads.");
  return id;
}

function pullPath(ref: PullRef): string {
  return `/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`;
}

/**
 * Searches the open, non-draft pull requests that wait for the viewer's review, directly or through a team, and the viewer's own.
 * @returns The raw search results, 50 of each at most.
 */
export async function fetchInbox(): Promise<RawInbox> {
  const { data: ids } = await graphql<RawInboxIds>(INBOX_IDS_QUERY, { review: REVIEW_SEARCH, mine: MINE_SEARCH, waiting: WAITING_SEARCH });
  const chunks = await Promise.all(
    chunk(inboxIds(ids), INBOX_CHUNK).map(async (chunkIds) => {
      const { data } = await graphql<{ nodes: (RawInboxPull | null)[] }>(INBOX_DETAILS_QUERY, { ids: chunkIds });
      return data.nodes;
    }),
  );
  const details = new Map(chunks.flat().flatMap((pull) => (pull ? [[pull.id, pull] as const] : [])));
  return assembleRawInbox(ids, details);
}

/**
 * @param token A token to check instead of the stored one.
 * @returns The login the token belongs to.
 */
export async function fetchViewerLogin(token?: string): Promise<string> {
  const { data } = await graphql<{ viewer: { login: string } }>("query { viewer { login } }", {}, token);
  return data.viewer.login;
}

// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- callers name the response's shape, like the assertions on REST responses
async function graphql<T>(
  query: string,
  variables: Record<string, unknown>,
  token?: string,
): Promise<{ data: T; unreadable: string[] }> {
  const body = (await request("/graphql", { method: "POST", body: JSON.stringify({ query, variables }) }, token)) as {
    data?: T | null;
    errors?: { type?: string; message: string; path?: (string | number)[] }[];
  };
  const errors = body.errors ?? [];
  if (body.data === undefined || body.data === null) {
    const scopes = missingScopes(errors);
    if (scopes !== null) throw new GitHubError("scopes", scopes);
    throw new GitHubError("failed", errors.map((error) => error.message).join(" ") || "GitHub returned no data.");
  }
  const unreadable = errors.map(
    (error) => error.path?.findLast((segment): segment is string => typeof segment === "string") ?? error.message,
  );
  return { data: body.data, unreadable: [...new Set(unreadable)] };
}

/**
 * Starts a pending review on a commit, which only the viewer sees until they submit it.
 * @param pullRequestId The pull request's GraphQL id.
 * @param head The commit the review is on: the head, whose lines its comments name.
 * @returns The review's GraphQL id.
 */
async function startReview(pullRequestId: string, head: string): Promise<string> {
  const started = await mutate<{ addPullRequestReview: { pullRequestReview: { id: string } } }>(
    "mutation ($pull: ID!, $commit: GitObjectID!) { addPullRequestReview(input: { pullRequestId: $pull, commitOID: $commit }) { pullRequestReview { id } } }",
    { pull: pullRequestId, commit: head },
  );
  return started.addPullRequestReview.pullRequestReview.id;
}

/**
 * Runs a GraphQL mutation. A mutation that fails answers with data that is null where the mutation's result would be,
 * next to the errors, which a query would read as fields the token can't see: here any error is a failure.
 * @param query The mutation.
 * @param variables Its variables.
 * @returns The mutation's result.
 */
async function mutate<T = unknown>(query: string, variables: Record<string, unknown>): Promise<T> {
  const body = (await request("/graphql", { method: "POST", body: JSON.stringify({ query, variables }) })) as {
    data?: T | null;
    errors?: { type?: string; message: string }[];
  };
  const errors = body.errors ?? [];
  if (errors.length > 0 || body.data === undefined || body.data === null) {
    const scopes = missingScopes(errors);
    if (scopes !== null) throw new GitHubError("scopes", scopes);
    throw new GitHubError("failed", errors.map((error) => error.message).join(" ") || "GitHub returned no data.");
  }
  return body.data;
}

/**
 * @param errors The errors of a GraphQL response that returned no data.
 * @returns What the token lacks, when that is why GitHub refused the query, or null.
 */
export function missingScopes(errors: { type?: string; message: string }[]): string | null {
  const refused = errors.find((error) => error.type === "INSUFFICIENT_SCOPES");
  if (!refused) return null;
  const scopes = /following scopes: \[([^\]]*)\]/u.exec(refused.message)?.[1]?.replaceAll("'", "").trim();
  return scopes ? `The token lacks the ${scopes} scope.` : "The token lacks a scope FloHub needs.";
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
  const body = await readJson(response);
  if (!response.ok) {
    const message = (body as { message?: string } | null)?.message ?? response.statusText;
    throw new GitHubError("failed", `GitHub answered ${response.status}: ${message}`, response.status);
  }
  return body;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
