import type { RawPullRequest } from "./reviewers";
import { deriveStatus, type RawStackPull } from "./stack";

/** Whose move a pull request waits for, from the viewer's side: theirs, someone else's, or nobody's yet (a draft). */
export type Whose = "you" | "them" | "none";

/** Why a pull request waits for someone, as a stable code the views word themselves. */
export type TurnCode =
  /** You are asked to review it. */
  | "requested"
  /** You are asked to review it again. */
  | "rerequested"
  /** Unresolved threads where someone else spoke last: `count` of them. */
  | "replies"
  /** You requested changes and the author pushed since. */
  | "pushed-since-review"
  /** On your pull request: a change request you haven't pushed for yet, `who` gave it. */
  | "changes-requested"
  /** On your pull request: you pushed since `who` requested changes, but didn't ask them again. */
  | "ask-again"
  | "checks-failed"
  | "conflict"
  | "ready-to-merge"
  /** On your pull request: it needs a review and nobody is asked for one. */
  | "ask-for-review"
  /** On your pull request: `who` are asked to review and haven't yet. */
  | "waiting-on-reviewers"
  /** On someone else's pull request: its author has your verdict to answer. */
  | "waiting-on-author"
  | "draft";

export interface TurnReason {
  code: TurnCode;
  count?: number;
  who?: string[];
}

export interface Turn {
  whose: Whose;
  /** Most pressing first. */
  reasons: TurnReason[];
}

/** A review thread as the turn needs it: who started it and which person spoke last, bots left out. */
export interface TurnThread {
  resolved: boolean;
  /** Whether GitHub marks the thread's line as changed since; missing from overviews cached before it was fetched. */
  outdated?: boolean;
  starter: string | null;
  lastSpeaker: string | null;
  /** The people among the thread's last few comments; missing from overviews cached before they were kept. */
  recentSpeakers?: string[];
}

/** A review thread as GitHub returns it for the turn: its first comment and its last few. */
export interface RawTurnThread {
  isResolved: boolean;
  /** Missing from caches made before it was fetched. */
  isOutdated?: boolean;
  first: { nodes: RawTurnComment[] };
  recent: { nodes: RawTurnComment[] };
}

interface RawTurnComment {
  author: { __typename?: string; login: string } | null;
}

/** Everything the turn is decided from, gathered alike from the inbox and from the bar's overview. */
export interface TurnInput {
  viewer: string;
  author: string | null;
  draft: boolean;
  conflict: boolean;
  checksFailed: boolean;
  readyToMerge: boolean;
  /** Whether it still needs an approval or more. */
  needsReview: boolean;
  /** Whether the viewer is asked to review, for the first time or again. */
  asked: "requested" | "rerequested" | null;
  /** The viewer's standing verdict on someone else's pull request. */
  viewerVerdict: "approved" | "changes_requested" | "commented" | null;
  viewerReviewedAt: string | null;
  /** When the head branch got commits or force-pushes, any order. */
  pushes: string[];
  /** Other people's standing change requests, with when they last reviewed and whether they are asked again. */
  changeRequests: { login: string; at: string | null; requested: boolean }[];
  /** Everyone asked to review who hasn't answered the request yet: logins and team slugs. */
  requested: string[];
  threads: TurnThread[];
}

/**
 * @param login A login.
 * @param typename The actor's GraphQL type, when fetched.
 * @returns Whether it is a bot, whose comments never decide a turn.
 */
export function isBot(login: string, typename?: string): boolean {
  return typename === "Bot" || login.endsWith("[bot]");
}

/**
 * @param thread A thread as GitHub returns it.
 * @returns Who started it and which person spoke last; an AI reviewer's comments don't count as anyone's word.
 */
export function toTurnThread(thread: RawTurnThread): TurnThread {
  const recentSpeakers = thread.recent.nodes.flatMap((comment) => person(comment) ?? []);
  return {
    resolved: thread.isResolved,
    outdated: thread.isOutdated ?? false,
    starter: person(thread.first.nodes[0]),
    lastSpeaker: recentSpeakers.at(-1) ?? null,
    recentSpeakers,
  };
}

/** @returns The comment's author, unless it is a bot or a deleted user. */
function person(comment: RawTurnComment | undefined): string | null {
  return comment?.author && !isBot(comment.author.login, comment.author.__typename) ? comment.author.login : null;
}

/**
 * Decides whose move a pull request waits for, after Gerrit's attention set.
 *
 * On the viewer's own pull request it is their turn when something only they can do is due: a merge conflict,
 * failing checks, a change request they haven't pushed for, asking a reviewer again after pushing for their
 * change request, threads where a reviewer spoke last, asking for a review nobody is asked for, or merging. Otherwise it waits for the reviewers it asks.
 *
 * On someone else's, it is the viewer's turn while they are asked to review, when someone answered last in a thread
 * they started, or when the author pushed since the viewer requested changes. Otherwise it waits for the author.
 * A draft waits for nobody.
 * @param input The pull request, from the viewer's side.
 * @returns Whose turn it is, and why.
 */
export function whoseTurn(input: TurnInput): Turn {
  if (input.author === input.viewer) return ownTurn(input);
  const reasons: TurnReason[] = [];
  if (input.asked) reasons.push({ code: input.asked });
  const replies = input.threads.filter(
    (thread) => !thread.resolved && thread.starter === input.viewer && thread.lastSpeaker !== null && thread.lastSpeaker !== input.viewer,
  ).length;
  if (replies > 0) reasons.push({ code: "replies", count: replies });
  if (!input.asked && input.viewerVerdict === "changes_requested" && pushedAfter(input.pushes, input.viewerReviewedAt)) {
    reasons.push({ code: "pushed-since-review" });
  }
  if (input.draft && !input.asked) return { whose: "none", reasons: [{ code: "draft" }] };
  if (reasons.length > 0) return { whose: "you", reasons };
  return { whose: "them", reasons: input.viewerVerdict && input.viewerVerdict !== "approved" ? [{ code: "waiting-on-author" }] : [] };
}

function ownTurn(input: TurnInput): Turn {
  if (input.draft) return { whose: "none", reasons: [{ code: "draft" }] };
  const reasons: TurnReason[] = [];
  if (input.conflict) reasons.push({ code: "conflict" });
  if (input.checksFailed) reasons.push({ code: "checks-failed" });
  const standing = input.changeRequests.filter((request) => !request.requested);
  const unanswered = standing.filter((request) => !pushedAfter(input.pushes, request.at)).map((request) => request.login);
  const answered = standing.filter((request) => pushedAfter(input.pushes, request.at)).map((request) => request.login);
  if (unanswered.length > 0) reasons.push({ code: "changes-requested", who: unanswered });
  const replies = input.threads.filter(
    (thread) => !thread.resolved && thread.lastSpeaker !== null && thread.lastSpeaker !== input.viewer,
  ).length;
  if (replies > 0) reasons.push({ code: "replies", count: replies });
  if (answered.length > 0) reasons.push({ code: "ask-again", who: answered });
  if (input.readyToMerge) reasons.push({ code: "ready-to-merge" });
  if (input.needsReview && input.requested.length === 0 && answered.length === 0) reasons.push({ code: "ask-for-review" });
  if (reasons.length > 0) return { whose: "you", reasons };
  return { whose: "them", reasons: input.requested.length > 0 ? [{ code: "waiting-on-reviewers", who: input.requested }] : [] };
}

/** @returns Whether the head branch got a push after the given time; never before anything happened. */
function pushedAfter(pushes: string[], at: string | null): boolean {
  if (!at) return false;
  const since = Date.parse(at);
  return pushes.some((pushedAt) => Date.parse(pushedAt) > since);
}

/** @returns When the head branch got its recent commits and force-pushes. */
export function pushTimes(pull: Pick<RawStackPull, "timelineItems">): string[] {
  return pull.timelineItems.nodes.flatMap((item) =>
    item.__typename === "HeadRefForcePushedEvent" ? (item.createdAt ?? []) : (item.commit?.committedDate ?? []),
  );
}

/** The viewer's own verdicts by review state; a dismissed review stands for none. */
export const VIEWER_VERDICTS: Partial<Record<string, "approved" | "changes_requested" | "commented">> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
  COMMENTED: "commented",
};

/** A pull request as the bar's overview has it. */
type OverviewPull = RawPullRequest & RawStackPull & { turnThreads?: { nodes: RawTurnThread[] } };

/**
 * @param pull The pull request on screen.
 * @param viewer The viewer's login.
 * @returns What {@link whoseTurn} needs, from the bar's overview.
 */
export function overviewTurnInput(pull: OverviewPull, viewer: string): TurnInput {
  const { label } = deriveStatus(pull);
  const requested = pull.reviewRequests.nodes.flatMap(({ requestedReviewer: reviewer }) => {
    if (!reviewer) return [];
    return reviewer.__typename === "Team" ? reviewer.combinedSlug : reviewer.login;
  });
  const standing = new Map<string, { state: string; at: string | null; bot: boolean }>();
  const lastAt = new Map<string, string | null>();
  for (const review of pull.reviews.nodes) {
    if (!review.author || review.state === "PENDING") continue;
    const { login } = review.author;
    lastAt.set(login, review.submittedAt);
    if (review.state !== "COMMENTED" || !standing.has(login)) {
      standing.set(login, { state: review.state, at: review.submittedAt, bot: isBot(login, review.author.__typename) });
    }
  }
  const mine = standing.get(viewer)?.state;
  const changeRequests = [...standing].flatMap(([login, review]) =>
    review.state === "CHANGES_REQUESTED" && login !== viewer && !review.bot
      ? { login, at: lastAt.get(login) ?? review.at, requested: requested.includes(login) }
      : [],
  );
  return {
    viewer,
    author: pull.author?.login ?? null,
    draft: pull.isDraft,
    conflict: pull.mergeable === "CONFLICTING",
    checksFailed: pull.statusCheckRollup?.state === "FAILURE" || pull.statusCheckRollup?.state === "ERROR",
    readyToMerge: label === "Ready to merge",
    needsReview: label === "Needs review",
    asked: requested.includes(viewer) ? (lastAt.has(viewer) ? "rerequested" : "requested") : null,
    viewerVerdict: VIEWER_VERDICTS[mine ?? ""] ?? null,
    viewerReviewedAt: lastAt.get(viewer) ?? null,
    pushes: pushTimes(pull),
    changeRequests,
    requested,
    threads: (pull.turnThreads?.nodes ?? []).map((thread) => toTurnThread(thread)),
  };
}

/**
 * @param threads The pull request's threads.
 * @param author The pull request's author.
 * @returns For each reviewer, how many of the unresolved threads they started the author answered last, so the
 *   next word is theirs.
 */
export function repliesAwaiting(threads: TurnThread[], author: string | null): Map<string, number> {
  const counts = new Map<string, number>();
  for (const thread of threads) {
    if (thread.resolved || !thread.starter || thread.starter === author || thread.lastSpeaker !== author) continue;
    counts.set(thread.starter, (counts.get(thread.starter) ?? 0) + 1);
  }
  return counts;
}
