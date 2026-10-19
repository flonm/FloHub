import { deriveStatus, lastActivity, type RawStackPull, type StackTone } from "./stack";

/** A pull request as the inbox search returns it. */
export type RawInboxPull = RawStackPull & {
  id: string;
  additions: number;
  deletions: number;
  repository: { nameWithOwner: string };
  author: { login: string; avatarUrl: string } | null;
  latestReviews: { nodes: { state?: string; author: { login: string } | null; submittedAt: string | null }[] };
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
  waiting?: { nodes: (RawInboxPull | Record<string, never>)[] };
}

const SECTIONS = ["review", "mine", "waiting"] as const;

/** What the inbox searches return before the details are fetched: each hit's node id, or an empty object for an issue. */
export type RawInboxIds = { viewer: { login: string } } & Record<(typeof SECTIONS)[number], { nodes: (Record<string, never> | { id: string })[] }>;

/**
 * @param ids The search results.
 * @returns Every pull request's node id, each once, though several searches found it.
 */
export function inboxIds(ids: RawInboxIds): string[] {
  return [...new Set(SECTIONS.flatMap((section) => hitsOf(ids[section].nodes).map((node) => node.id)))];
}

/**
 * @param items The items.
 * @param size The most items a chunk holds.
 * @returns The items in order, cut into chunks of `size`, the last one shorter.
 */
export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) chunks.push(items.slice(start, start + size));
  return chunks;
}

/**
 * Puts the fetched details back into the searches that found them, in the order GitHub ranked them.
 * A pull request whose details didn't come back, because it was deleted or the token lost access since the search, is left out.
 * @param ids The search results.
 * @param details Each pull request's details, by node id.
 * @returns The inbox searches as {@link buildInbox} takes them.
 */
export function assembleRawInbox(ids: RawInboxIds, details: ReadonlyMap<string, RawInboxPull>): RawInbox {
  const section = (key: (typeof SECTIONS)[number]) => ({
    nodes: hitsOf(ids[key].nodes).flatMap((node) => details.get(node.id) ?? []),
  });
  return { viewer: ids.viewer, review: section("review"), mine: section("mine"), waiting: section("waiting") };
}

function hitsOf(nodes: RawInboxIds["review"]["nodes"]): { id: string }[] {
  return nodes.filter((node): node is { id: string } => typeof node.id === "string");
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
  /** The viewer's verdict its author still has to answer, for the "Waiting for author" section. */
  yourVerdict?: "changes_requested" | "commented" | null;
  /** The author pushed after the viewer's latest review. */
  pushedSinceReview?: boolean;
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
  /** Pull requests the viewer reviewed that wait for their author; missing from an inbox cached before it existed. */
  waiting?: InboxGroup[];
  /** Pull requests waiting for the viewer's review, for the toolbar badge. */
  reviewCount: number;
}

/** How urgently a status asks the author to act, most urgent first. */
const URGENCY: Record<StackTone, number> = { danger: 0, attention: 1, success: 2, accent: 3, neutral: 4, done: 5 };

/**
 * Turns the inbox searches into groups: one per stack, or one per pull request outside any stack.
 * Review requests keep only non-draft pull requests that still wait for the viewer, see {@link requestedVia};
 * reviewed pull requests keep only those waiting for their author, see {@link waitingVerdict}.
 * In the repositories set to count only direct requests, a request that reaches the viewer through a team is dropped.
 * Review requests and reviewed pull requests are ordered by their latest activity, the viewer's own pull requests
 * by what needs them first.
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
    "review",
  );
  const mine = group(pullsOf(raw.mine.nodes), viewer, "mine");
  const waiting = group(
    pullsOf(raw.waiting?.nodes ?? []).filter((pull) => waitingVerdict(pull, viewer) !== null),
    viewer,
    "waiting",
  );
  waiting.sort((a, b) => newest(b) - newest(a));
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
    waiting,
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

/**
 * A pull request someone else wrote waits for its author after the viewer requested changes, or only commented,
 * as long as the viewer isn't asked to review it again. An approval, or a review dismissed after a push, means
 * the author isn't waited on.
 * @param pull The pull request.
 * @param viewer The viewer's login.
 * @returns The viewer's verdict that the author still has to answer, or null.
 */
function waitingVerdict(pull: RawInboxPull, viewer: string): "changes_requested" | "commented" | null {
  if (pull.author?.login === viewer || requestedVia(pull, viewer) !== null) return null;
  // A later comment doesn't replace a verdict, and the verdicts only list writers, so a missing one falls back to the latest review.
  const state =
    pull.latestOpinionatedReviews.nodes.find((review) => review.author?.login === viewer)?.state ??
    pull.latestReviews.nodes.find((review) => review.author?.login === viewer)?.state;
  if (state === "CHANGES_REQUESTED") return "changes_requested";
  return state === "COMMENTED" ? "commented" : null;
}

/** @returns Whether the head branch got a push or commit after the viewer's latest review. */
function pushedSinceReview(pull: RawInboxPull, viewer: string): boolean {
  const reviewedAt = pull.latestReviews.nodes.find((review) => review.author?.login === viewer)?.submittedAt;
  if (!reviewedAt) return false;
  return pull.timelineItems.nodes.some((item) => {
    const pushedAt = item.__typename === "HeadRefForcePushedEvent" ? item.createdAt : item.commit?.committedDate;
    return pushedAt !== undefined && Date.parse(pushedAt) > Date.parse(reviewedAt);
  });
}

function group(pulls: RawInboxPull[], viewer: string, kind: "review" | "waiting" | "mine"): InboxGroup[] {
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
    entry.pulls.push(toInboxPull(pull, viewer, kind));
    groups.set(key, entry);
  }
  for (const entry of groups.values()) entry.pulls.sort((a, b) => (b.position ?? 0) - (a.position ?? 0));
  return [...groups.values()];
}

function toInboxPull(pull: RawInboxPull, viewer: string, kind: "review" | "waiting" | "mine"): InboxPull {
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
    viaTeam: kind === "review" && pull.reviewRequests.nodes.every((request) => request.requestedReviewer?.login !== viewer),
    ...(kind === "waiting" && { yourVerdict: waitingVerdict(pull, viewer), pushedSinceReview: pushedSinceReview(pull, viewer) }),
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

