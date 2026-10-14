import { deriveStatus, lastActivity, type RawStackPull, type StackTone } from "./stack";

/** A pull request as the inbox search returns it. */
export type RawInboxPull = RawStackPull & {
  additions: number;
  deletions: number;
  repository: { nameWithOwner: string };
  author: { login: string; avatarUrl: string } | null;
  latestReviews: { nodes: { author: { login: string } | null; submittedAt: string | null }[] };
  /** Reviewers that are neither users nor teams come back as empty objects. */
  reviewRequests: { nodes: { requestedReviewer: { login?: string; combinedSlug?: string } | null }[] };
  reviewRequestedEvents: { nodes: { createdAt: string; requestedReviewer: { combinedSlug?: string } | null }[] };
  stack: {
    number: number;
    size: number;
    entries: { nodes: { position: number; pullRequest: { number: number } | null }[] };
  } | null;
};

export interface RawInbox {
  viewer: { login: string };
  review: { nodes: (RawInboxPull | Record<string, never>)[] };
  mine: { nodes: (RawInboxPull | Record<string, never>)[] };
}

export interface InboxPull {
  number: number;
  title: string;
  url: string;
  tone: StackTone;
  label: string;
  author: string | null;
  avatarUrl: string | null;
  /** The layer's place in its stack, counted from the base. */
  position: number | null;
  lastActivity: string;
  resolvedThreads: number;
  totalThreads: number;
  /** Lines the whole pull request adds and deletes; missing in an inbox cached before they were fetched. */
  additions?: number;
  deletions?: number;
  /** The viewer reviewed it before and was asked again. */
  rerequested: boolean;
  /** It waits for the viewer only through a team; missing in an inbox cached before this was tracked. */
  viaTeam?: boolean;
}

export interface InboxGroup {
  key: string;
  repo: string;
  /** Null for a pull request in no stack. */
  stackNumber: number | null;
  stackSize: number;
  /** Top of the stack first. */
  pulls: InboxPull[];
}

export interface Inbox {
  viewer: string;
  fetchedAt: number;
  review: InboxGroup[];
  mine: InboxGroup[];
  /** Pull requests waiting for the viewer's review, for the toolbar badge. */
  reviewCount: number;
}

/** How urgently a status asks the author to act, most urgent first. */
const URGENCY: Record<StackTone, number> = { danger: 0, attention: 1, success: 2, accent: 3, neutral: 4, done: 5 };

/**
 * Turns the two inbox searches into groups: one per stack, or one per pull request outside any stack.
 * Review requests keep only non-draft pull requests that still wait for the viewer, see {@link requestedVia}.
 * In the repositories set to count only direct requests, a request that reaches the viewer through a team is dropped.
 * Review requests are ordered by their latest activity, the viewer's own pull requests by what needs them first.
 * @param raw The search results.
 * @param fetchedAt When they were fetched.
 * @param directRepos Repositories, lowercase `owner/name`, that count only requests naming the viewer.
 * @returns The inbox.
 */
export function buildInbox(raw: RawInbox, fetchedAt: number, directRepos: ReadonlySet<string> = new Set()): Inbox {
  const viewer = raw.viewer.login;
  // The search index lags behind a submitted review, so check the request is still open on the pull request itself.
  const review = group(
    pullsOf(raw.review.nodes).filter((pull) => {
      if (pull.isDraft) return false;
      const via = requestedVia(pull, viewer);
      return via === "user" || (via === "team" && !directRepos.has(pull.repository.nameWithOwner.toLowerCase()));
    }),
    viewer,
    true,
  );
  const mine = group(pullsOf(raw.mine.nodes), viewer, false);
  review.sort((a, b) => newest(b) - newest(a));
  mine.sort((a, b) => {
    const byUrgency = urgency(a) - urgency(b);
    return byUrgency === 0 ? newest(b) - newest(a) : byUrgency;
  });
  return {
    viewer,
    fetchedAt,
    review,
    mine,
    reviewCount: review.reduce((sum, entry) => sum + entry.pulls.length, 0),
  };
}

function pullsOf(nodes: (RawInboxPull | Record<string, never>)[]): RawInboxPull[] {
  return nodes.filter((node): node is RawInboxPull => typeof node.number === "number");
}

/**
 * GitHub drops a user's request when they submit a review and adds it back when they are re-requested,
 * but a team's request stays open after a member reviews. So a team request counts only when it was made
 * after the viewer's latest review; re-requesting the team makes it count again.
 * The search already matched the viewer through a team, so any pending team is taken to be one of theirs.
 * @param pull The pull request.
 * @param viewer The viewer's login.
 * @returns How the pull request waits for the viewer's review right now: by name, through a team, or not at all.
 */
function requestedVia(pull: RawInboxPull, viewer: string): "user" | "team" | null {
  const reviewers = pull.reviewRequests.nodes.map((request) => request.requestedReviewer);
  if (reviewers.some((reviewer) => reviewer?.login === viewer)) return "user";
  const teams = new Set(reviewers.flatMap((reviewer) => reviewer?.combinedSlug ?? []));
  if (teams.size === 0) return null;
  const reviewedAt = pull.latestReviews.nodes.find((review) => review.author?.login === viewer)?.submittedAt;
  if (!reviewedAt) return "team";
  const asked = pull.reviewRequestedEvents.nodes.some(
    (event) =>
      teams.has(event.requestedReviewer?.combinedSlug ?? "") && Date.parse(event.createdAt) > Date.parse(reviewedAt),
  );
  return asked ? "team" : null;
}

function group(pulls: RawInboxPull[], viewer: string, review: boolean): InboxGroup[] {
  const groups = new Map<string, InboxGroup>();
  for (const pull of pulls) {
    const repo = pull.repository.nameWithOwner;
    const key = pull.stack ? `${repo}#stack-${pull.stack.number}` : `${repo}#${pull.number}`;
    const entry = groups.get(key) ?? {
      key,
      repo,
      stackNumber: pull.stack?.number ?? null,
      stackSize: pull.stack?.size ?? 1,
      pulls: [],
    };
    entry.pulls.push(toInboxPull(pull, viewer, review));
    groups.set(key, entry);
  }
  for (const entry of groups.values()) entry.pulls.sort((a, b) => (b.position ?? 0) - (a.position ?? 0));
  return [...groups.values()];
}

function toInboxPull(pull: RawInboxPull, viewer: string, review: boolean): InboxPull {
  const { tone, label } = deriveStatus(pull);
  const position = pull.stack?.entries.nodes.find((node) => node.pullRequest?.number === pull.number)?.position ?? null;
  return {
    number: pull.number,
    title: pull.title,
    url: pull.url,
    tone,
    label,
    author: pull.author?.login ?? null,
    avatarUrl: pull.author?.avatarUrl ?? null,
    position,
    lastActivity: lastActivity(pull),
    resolvedThreads: pull.reviewThreads.nodes.filter((thread) => thread.isResolved).length,
    totalThreads: pull.reviewThreads.totalCount,
    additions: pull.additions,
    deletions: pull.deletions,
    rerequested: pull.latestReviews.nodes.some((latest) => latest.author?.login === viewer),
    viaTeam: review && pull.reviewRequests.nodes.every((request) => request.requestedReviewer?.login !== viewer),
  };
}

function newest(entry: InboxGroup): number {
  return Math.max(...entry.pulls.map((pull) => Date.parse(pull.lastActivity)));
}

function urgency(entry: InboxGroup): number {
  return Math.min(...entry.pulls.map((pull) => URGENCY[pull.tone]));
}

/** How long a review request may sit without activity before the inbox flags it as waiting too long. */
export const STALE_AFTER_MS = 2 * 86_400_000;

/**
 * @param pull The pull request.
 * @param now The current time in epoch milliseconds.
 * @returns Whether it has seen no push, edit or review for at least {@link STALE_AFTER_MS}.
 */
export function isStale(pull: Pick<InboxPull, "lastActivity">, now: number): boolean {
  return now - Date.parse(pull.lastActivity) >= STALE_AFTER_MS;
}

