import type { Verdict } from "./reviewers";
import { deriveStatus, lastActivity, type RawStackPull, type StackTone } from "./stack";
import { isBot, pushTimes, type RawTurnThread, toTurnThread, type Turn, type TurnCode, type TurnReason, VIEWER_VERDICTS, whoseTurn } from "./turn";

/** A pull request as the inbox search returns it. */
export type RawInboxPull = RawStackPull & {
  id: string;
  additions: number;
  deletions: number;
  repository: { nameWithOwner: string };
  author: { login: string; avatarUrl: string } | null;
  latestReviews: { nodes: { state?: string; author: { login: string; avatarUrl?: string } | null; submittedAt: string | null }[] };
  /** Reviewers that are neither users nor teams come back as empty objects. */
  reviewRequests: { nodes: { requestedReviewer: { login?: string; combinedSlug?: string } | null }[] };
  reviewRequestedEvents: { nodes: { createdAt: string; requestedReviewer: { combinedSlug?: string } | null }[] };
  stack: {
    number: number;
    size: number;
    entries: { nodes: { position: number; pullRequest: { number: number } | null }[] };
  } | null;
  /** Who started each thread and spoke last in it; missing from fixtures and caches made before turns. */
  turnThreads?: { nodes: RawTurnThread[] };
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

/** Another reviewer's latest verdict on a pull request in the inbox. */
export interface InboxReview {
  login: string;
  avatarUrl: string | null;
  verdict: Verdict;
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
  /** Everyone else's latest verdict, change requests first; missing from an inbox stored before verdicts. */
  reviews?: InboxReview[];
  /** Whose move it waits for; missing from an inbox stored before turns. */
  turn?: Turn;
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
  /**
   * Pull requests the searches found that wait for nobody in particular, like one the viewer approved or a team
   * request in a repository set to count only direct ones; missing from an inbox cached before it existed.
   */
  other?: InboxGroup[];
  /** Pull requests waiting for the viewer's review. */
  reviewCount: number;
  /** Pull requests waiting for the viewer's move, for the toolbar badge; missing from an inbox stored before turns. */
  turnCount?: number;
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
  const mine = group(pullsOf(raw.mine.nodes), viewer, "mine").map((entry) => waitOnDownstack(entry));
  // After an approval nothing waits for the author, unless they answered in a thread the viewer started.
  const waiting = group(
    pullsOf(raw.waiting?.nodes ?? []).filter(
      (pull) => waitingVerdict(pull, viewer) !== null || (isReviewedOnly(pull, viewer) && turnOf(pull, viewer, "waiting").whose === "you"),
    ),
    viewer,
    "waiting",
  );
  waiting.sort((a, b) => newest(b) - newest(a));
  review.sort((a, b) => newest(b) - newest(a));
  mine.sort((a, b) => {
    const byUrgency = urgency(a) - urgency(b);
    return byUrgency === 0 ? newest(b) - newest(a) : byUrgency;
  });
  const yours = [...review, ...mine, ...waiting].flatMap((entry) => entry.pulls).filter((pull) => pull.turn?.whose === "you");
  const shown = new Set([...review, ...mine, ...waiting].flatMap((entry) => entry.pulls.map((pull) => pull.url)));
  const left = new Map<string, RawInboxPull>();
  for (const pull of [...pullsOf(raw.review.nodes), ...pullsOf(raw.waiting?.nodes ?? [])]) if (!shown.has(pull.url)) left.set(pull.url, pull);
  const other = group([...left.values()], viewer, "other");
  other.sort((a, b) => newest(b) - newest(a));
  return {
    viewer,
    fetchedAt,
    review,
    mine,
    waiting,
    other,
    reviewCount: review.reduce((sum, entry) => sum + entry.pulls.length, 0),
    turnCount: yours.length,
  };
}

/** @returns Whether the viewer reviewed someone else's pull request and isn't asked to review it again. */
function isReviewedOnly(pull: RawInboxPull, viewer: string): boolean {
  return pull.author?.login !== viewer && requestedVia(pull, viewer) === null;
}

/**
 * A layer can only merge after the layers below it, as the bar's stack says: an own layer ready to merge above
 * another open one of the viewer's waits on its downstack, so only the lowest is the viewer's turn to merge.
 * @param entry A group of the viewer's own pull requests, top first.
 * @returns The group, its upper ready layers waiting on their downstack.
 */
function waitOnDownstack(entry: InboxGroup): InboxGroup {
  const lowest = Math.min(...entry.pulls.map((pull) => pull.position ?? Infinity));
  return {
    ...entry,
    pulls: entry.pulls.map((pull) => {
      if (pull.position === null || pull.position === lowest || !pull.turn?.reasons.some((reason) => reason.code === "ready-to-merge")) return pull;
      const reasons = pull.turn.reasons.filter((reason) => reason.code !== "ready-to-merge");
      return {
        ...pull,
        label: pull.label === "Ready to merge" ? "Waiting on downstack" : pull.label,
        turn: reasons.length > 0 ? { whose: "you", reasons } : { whose: "them", reasons: [] },
      };
    }),
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
  return pushTimes(pull).some((pushedAt) => Date.parse(pushedAt) > Date.parse(reviewedAt));
}

/**
 * Groups pull requests found outside the inbox's searches, for its "Everything else" section.
 * @param pulls The pull requests.
 * @param viewer The viewer's login.
 * @returns One group per stack or lone pull request, newest first.
 */
export function groupOthers(pulls: RawInboxPull[], viewer: string): InboxGroup[] {
  return group(pulls, viewer, "other").toSorted((a, b) => newest(b) - newest(a));
}

function group(pulls: RawInboxPull[], viewer: string, kind: InboxRole): InboxGroup[] {
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

function toInboxPull(pull: RawInboxPull, viewer: string, kind: InboxRole): InboxPull {
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
    reviews: othersReviews(pull, viewer),
    viaTeam: kind === "review" && pull.reviewRequests.nodes.every((request) => request.requestedReviewer?.login !== viewer),
    ...(kind === "waiting" && { yourVerdict: waitingVerdict(pull, viewer), pushedSinceReview: pushedSinceReview(pull, viewer) }),
    ...(kind !== "other" && { turn: turnOf(pull, viewer, kind) }),
  };
}

/**
 * @param pull The pull request.
 * @param viewer The viewer's login.
 * @param kind The search that found it; a review request in it already passed the team filter.
 * @returns Whose move it waits for, see {@link whoseTurn}.
 */
function turnOf(pull: RawInboxPull, viewer: string, kind: "review" | "waiting" | "mine"): Turn {
  const turn = baseTurn(pull, viewer, kind);
  return kind === "review" ? demoteReviewed(turn, humanVerdicts(pull, viewer)) : turn;
}

/**
 * One human verdict is enough on a pull request, so a review request someone else already answered stops being the
 * viewer's turn: an AI reviewer often asks a second person after the first one reviewed. Being asked again still is.
 * @param turn The turn of a review request.
 * @param verdicts The standing human verdicts besides the viewer's and the author's.
 * @returns The turn without the first-time request, and someone else's verdict as the reason when nothing else is left.
 */
export function demoteReviewed(turn: Turn, verdicts: { login: string; state: string }[]): Turn {
  const reasons = turn.reasons.filter((reason) => reason.code !== "requested");
  if (verdicts.length === 0 || reasons.length === turn.reasons.length) return turn;
  if (reasons.length > 0) return { whose: turn.whose, reasons };
  const changes = verdicts.filter((verdict) => verdict.state === "CHANGES_REQUESTED").map((verdict) => verdict.login);
  const reason: TurnReason =
    changes.length > 0 ? { code: "changes-by-other", who: changes } : { code: "approved-by-other", who: verdicts.map((verdict) => verdict.login) };
  return { whose: "them", reasons: [reason] };
}

/** @returns The approvals and change requests that stand from people other than the viewer and the author, bots left out. */
function humanVerdicts(pull: RawInboxPull, viewer: string): { login: string; state: string }[] {
  return pull.latestOpinionatedReviews.nodes.flatMap(({ state, author }) => {
    if (!author || author.login === viewer || author.login === pull.author?.login || isBot(author.login, author.__typename)) return [];
    return state === "APPROVED" || state === "CHANGES_REQUESTED" ? { login: author.login, state } : [];
  });
}

function baseTurn(pull: RawInboxPull, viewer: string, kind: "review" | "waiting" | "mine"): Turn {
  const { label } = deriveStatus(pull);
  const latest = new Map(pull.latestReviews.nodes.flatMap((review) => (review.author ? [[review.author.login, review] as const] : [])));
  const requested = pull.reviewRequests.nodes.flatMap((request) => request.requestedReviewer?.login ?? request.requestedReviewer?.combinedSlug ?? []);
  const standing = new Map(pull.latestOpinionatedReviews.nodes.flatMap((review) => (review.author ? [[review.author.login, review] as const] : [])));
  const viewerState = standing.get(viewer)?.state ?? latest.get(viewer)?.state;
  const changeRequests = [...standing.values()].flatMap((review) => {
    const login = review.author?.login;
    if (!login || review.state !== "CHANGES_REQUESTED" || login === viewer || isBot(login, review.author?.__typename)) return [];
    return { login, at: latest.get(login)?.submittedAt ?? null, requested: requested.includes(login) };
  });
  return whoseTurn({
    viewer,
    author: pull.author?.login ?? null,
    draft: pull.isDraft,
    conflict: pull.mergeable === "CONFLICTING",
    checksFailed: pull.statusCheckRollup?.state === "FAILURE" || pull.statusCheckRollup?.state === "ERROR",
    readyToMerge: label === "Ready to merge",
    needsReview: label === "Needs review",
    asked: kind === "review" ? (latest.has(viewer) ? "rerequested" : "requested") : null,
    viewerVerdict: VIEWER_VERDICTS[viewerState ?? ""] ?? null,
    viewerReviewedAt: latest.get(viewer)?.submittedAt ?? null,
    pushes: pushTimes(pull),
    changeRequests,
    requested,
    threads: (pull.turnThreads?.nodes ?? []).map((thread) => toTurnThread(thread)),
  });
}



const VERDICTS: Record<string, Verdict | undefined> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
  DISMISSED: "dismissed",
  COMMENTED: "commented",
};

/** Change requests matter most, then approvals; a dismissed review and a comment say the least. */
const VERDICT_ORDER: Record<Verdict, number> = { changes_requested: 0, approved: 1, dismissed: 2, commented: 3 };

/**
 * @param pull The pull request.
 * @param viewer The viewer, whose own verdict the row already says.
 * @returns Everyone else's latest verdict, leaving out the author's own comments, change requests first.
 */
export function othersReviews(pull: Pick<RawInboxPull, "latestReviews" | "author">, viewer: string): InboxReview[] {
  const reviews: InboxReview[] = [];
  for (const review of pull.latestReviews.nodes) {
    const login = review.author?.login;
    const verdict = review.state ? VERDICTS[review.state] : undefined;
    if (!login || !verdict || login === viewer || login === pull.author?.login) continue;
    reviews.push({ login, avatarUrl: review.author?.avatarUrl ?? null, verdict });
  }
  return reviews.toSorted((a, b) => VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict]);
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


/** Which search a row came from, which decides what its meta line says; "other" for one waiting for nobody in particular. */
export type InboxRole = "review" | "waiting" | "mine" | "other";

/** A group in one of the inbox's categories, with the search its pull requests came from. */
export type TurnGroup = InboxGroup & { role: InboxRole };

/** The popup's sections: whose move a pull request waits for, then review requests someone else answered, drafts and the rest. */
export type InboxSection = "you" | "them" | "reviewed" | "none" | "other";

/** Why a pull request is in the inbox, each under one heading of its section. */
export type InboxCategory =
  | "rerequested"
  | "requested"
  | "replies"
  | "pushed"
  | "fix"
  | "ask"
  | "merge"
  | "author"
  | "reviewers"
  | "changes-by-other"
  | "approved-by-other"
  | "draft"
  | "other";

/** Each section's categories, top to bottom: the most pressing first. */
export const SECTION_CATEGORIES: Record<InboxSection, InboxCategory[]> = {
  you: ["rerequested", "requested", "replies", "pushed", "fix", "ask", "merge"],
  them: ["author", "reviewers"],
  reviewed: ["changes-by-other", "approved-by-other"],
  none: ["draft"],
  other: ["other"],
};

/** The sections in the popup's order. */
export const SECTIONS_IN_ORDER = Object.keys(SECTION_CATEGORIES) as InboxSection[];

/** Which category each turn reason puts a pull request in; the turn lists its reasons most pressing first. */
const REASON_CATEGORY: Partial<Record<TurnCode, InboxCategory>> = {
  rerequested: "rerequested",
  requested: "requested",
  replies: "replies",
  "pushed-since-review": "pushed",
  conflict: "fix",
  "checks-failed": "fix",
  "changes-requested": "fix",
  "ask-again": "ask",
  "ask-for-review": "ask",
  "ready-to-merge": "merge",
  "changes-by-other": "changes-by-other",
  "approved-by-other": "approved-by-other",
  draft: "draft",
};

/**
 * @param pull The pull request.
 * @param role The search that found it.
 * @returns The one category it shows under. An inbox stored before turns falls back to the search that found it.
 */
export function categoryOf(pull: InboxPull, role: InboxRole): InboxCategory {
  if (role === "other") return "other";
  if (!pull.turn) {
    if (role === "review") return pull.rerequested ? "rerequested" : "requested";
    if (role === "waiting") return "author";
    return pull.label === "Draft" ? "draft" : "reviewers";
  }
  // Being asked again outranks everything else the viewer has to do on it.
  if (pull.turn.reasons.some((reason) => reason.code === "rerequested")) return "rerequested";
  const [match] = pull.turn.reasons.flatMap((reason) => REASON_CATEGORY[reason.code] ?? []);
  if (match) return match;
  if (pull.turn.whose === "none") return "draft";
  return role === "mine" ? "reviewers" : "author";
}

/**
 * @param category A category.
 * @returns The section it belongs to.
 */
export function sectionOf(category: InboxCategory): InboxSection {
  return SECTIONS_IN_ORDER.find((section) => SECTION_CATEGORIES[section].includes(category)) ?? "other";
}

/**
 * Sorts the inbox into its categories. A stack whose layers fall into different categories is split between them,
 * and a pull request found by several searches shows once.
 * @param inbox The inbox.
 * @param more Pull requests loaded on request for "Everything else", left out where the inbox has them already.
 * @returns Each category's groups: being asked again longest waiting first, since the longer someone has waited on
 *   a second look the more it blocks them; every other category newest first.
 */
export function inboxCategories(inbox: Inbox, more: InboxGroup[] = []): Record<InboxCategory, TurnGroup[]> {
  const categories = Object.fromEntries(
    SECTIONS_IN_ORDER.flatMap((section) => SECTION_CATEGORIES[section]).map((category) => [category, [] as TurnGroup[]]),
  ) as Record<InboxCategory, TurnGroup[]>;
  const roles: [InboxRole, InboxGroup[]][] = [
    ["review", inbox.review],
    ["mine", inbox.mine],
    ["waiting", inbox.waiting ?? []],
    ["other", inbox.other ?? []],
    ["other", more],
  ];
  const seen = new Set<string>();
  for (const [role, groups] of roles) {
    for (const entry of groups) {
      const placed = new Map<InboxCategory, InboxPull[]>();
      for (const pull of entry.pulls) {
        if (seen.has(pull.url)) continue;
        seen.add(pull.url);
        const category = categoryOf(pull, role);
        placed.set(category, [...(placed.get(category) ?? []), pull]);
      }
      for (const [category, pulls] of placed) categories[category].push({ ...entry, pulls, role });
    }
  }
  for (const [category, groups] of Object.entries(categories)) {
    groups.sort(category === "rerequested" ? (a, b) => newest(a) - newest(b) : (a, b) => newest(b) - newest(a));
  }
  return categories;
}
