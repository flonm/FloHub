import { deriveStatus, lastActivity, type RawStackPull, type StackTone } from "./stack";

/** A pull request as the inbox search returns it. */
export type RawInboxPull = RawStackPull & {
  repository: { nameWithOwner: string };
  author: { login: string; avatarUrl: string } | null;
  latestReviews: { nodes: { author: { login: string } | null }[] };
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
  /** The viewer reviewed it before and was asked again. */
  rerequested: boolean;
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
 * Review requests are ordered by their latest activity, the viewer's own pull requests by what needs them first.
 * @param raw The search results.
 * @param fetchedAt When they were fetched.
 * @returns The inbox.
 */
export function buildInbox(raw: RawInbox, fetchedAt: number): Inbox {
  const review = group(pullsOf(raw.review.nodes), raw.viewer.login);
  const mine = group(pullsOf(raw.mine.nodes), raw.viewer.login);
  review.sort((a, b) => newest(b) - newest(a));
  mine.sort((a, b) => urgency(a) - urgency(b) || newest(b) - newest(a));
  return {
    viewer: raw.viewer.login,
    fetchedAt,
    review,
    mine,
    reviewCount: review.reduce((sum, entry) => sum + entry.pulls.length, 0),
  };
}

function pullsOf(nodes: (RawInboxPull | Record<string, never>)[]): RawInboxPull[] {
  return nodes.filter((node): node is RawInboxPull => typeof node.number === "number");
}

function group(pulls: RawInboxPull[], viewer: string): InboxGroup[] {
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
    entry.pulls.push(toInboxPull(pull, viewer));
    groups.set(key, entry);
  }
  for (const entry of groups.values()) entry.pulls.sort((a, b) => (b.position ?? 0) - (a.position ?? 0));
  return [...groups.values()];
}

function toInboxPull(pull: RawInboxPull, viewer: string): InboxPull {
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
    rerequested: pull.latestReviews.nodes.some((review) => review.author?.login === viewer),
  };
}

function newest(entry: InboxGroup): number {
  return Math.max(...entry.pulls.map((pull) => Date.parse(pull.lastActivity)));
}

function urgency(entry: InboxGroup): number {
  return Math.min(...entry.pulls.map((pull) => URGENCY[pull.tone]));
}
