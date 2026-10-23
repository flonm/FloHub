import { formatAge } from "./age";
import type { RawReviewState, Verdict } from "./reviewers";

interface RawCommitRef {
  oid: string;
  committedDate: string;
}

interface RawVersionEvent {
  __typename: string;
  createdAt?: string;
  actor?: { login: string } | null;
  beforeCommit?: RawCommitRef | null;
  afterCommit?: RawCommitRef | null;
  previousRefName?: string;
  /** The base before GitHub retargeted the pull request, after its base branch was merged and deleted. */
  oldBase?: string;
}

export interface RawVersionPull {
  baseRefName: string;
  baseRefOid: string;
  headRefOid: string;
  createdAt: string;
  commits: { nodes: { commit: RawCommitRef }[] };
  timelineItems: { nodes: (RawVersionEvent | null)[] };
  reviews: {
    nodes: {
      /** Missing from histories cached before review states were fetched. */
      state?: RawReviewState;
      author: { login: string; avatarUrl?: string } | null;
      submittedAt: string | null;
      commit: RawCommitRef | null;
    }[];
  };
}

/** The pull requests whose head branch the viewed pull request is, or was, based on. */
export interface RawBasePull {
  headRefOid: string;
  /** Whether the pull request comes from a fork, whose branch only shares the base branch's name. */
  isCrossRepository?: boolean;
  commits: { nodes: { commit: RawCommitRef }[] };
  timelineItems: { nodes: (RawVersionEvent | null)[] };
}

/** A head commit the pull request had at some point. */
export interface Version {
  oid: string;
  /** 1 for the oldest known version. */
  number: number;
  /** When the commit was made or pushed, whichever is earlier. */
  at: string;
  /** Who force-pushed this version, when it came from a force push. */
  pushedBy: string | null;
  /** Everyone who reviewed exactly this version. */
  reviewedBy: string[];
  /**
   * Each reviewer's verdict on exactly this version, in the order they first reviewed it: their latest approval,
   * change request or dismissed review, else that they commented. Missing from histories cached before verdicts.
   */
  reviews?: VersionReview[];
  /** Whether the viewer's latest review was on this version. */
  viewerLatestReview: boolean;
  current: boolean;
}

export interface VersionReview {
  login: string;
  avatarUrl: string | null;
  verdict: Verdict;
}

const VERDICTS: Partial<Record<RawReviewState, Verdict>> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
  DISMISSED: "dismissed",
  COMMENTED: "commented",
};

export interface VersionHistory {
  baseRefOid: string;
  /** Oldest first; the last one is the current head. */
  versions: Version[];
  /** Heads the base branch had over time, when it is another pull request's head branch. */
  baseHeads: { oid: string; at: string }[];
}

/** How many candidate bases the service worker compares a version with. */
const MAX_BASE_TRIES = 6;

/**
 * Collects every head the pull request is known to have had: both sides of each force push, each reviewed commit,
 * and the current head. Plain pushes between them leave no trace in the timeline, so they only show up when someone
 * reviewed them. They're numbered in the order they were the head: when they were pushed, were replaced by a push,
 * or were reviewed. Commit dates would misorder cherry-picks and rebases that keep the dates.
 * @param pull The raw pull request.
 * @param basePulls The pull requests whose head branch this one is based on, now or before.
 * @param viewer The viewer's login.
 * @returns The versions, oldest first.
 */
export function deriveVersions(pull: RawVersionPull, basePulls: RawBasePull[], viewer: string): VersionHistory {
  const found = new Map<string, Omit<Version, "number"> & { order: number }>();
  const see = (commit: RawCommitRef, order: number, pushedAt?: string, pushedBy?: string) => {
    const at = earliest(commit.committedDate, pushedAt);
    const known = found.get(commit.oid);
    if (known) {
      known.at = earliest(known.at, at);
      known.order = Math.min(known.order, order);
      known.pushedBy ??= pushedBy ?? null;
      return known;
    }
    const version = {
      oid: commit.oid,
      at,
      order,
      pushedBy: pushedBy ?? null,
      reviewedBy: [],
      reviews: [] as VersionReview[],
      viewerLatestReview: false,
      current: false,
    };
    found.set(commit.oid, version);
    return version;
  };

  for (const event of pull.timelineItems.nodes) {
    if (event?.__typename !== "HeadRefForcePushedEvent" || !event.createdAt) continue;
    const pushedAt = Date.parse(event.createdAt);
    // The commit a push replaced was the head until just before it.
    if (event.beforeCommit) see(event.beforeCommit, pushedAt - 1);
    if (event.afterCommit) see(event.afterCommit, pushedAt, event.createdAt, event.actor?.login);
  }

  let viewerLatest: string | null = null;
  for (const review of pull.reviews.nodes) {
    if (!review.commit) continue;
    const version = see(review.commit, Date.parse(review.submittedAt ?? review.commit.committedDate));
    const login = review.author?.login;
    if (login && !version.reviewedBy.includes(login)) version.reviewedBy.push(login);
    const verdict = review.state ? VERDICTS[review.state] : undefined;
    if (login && verdict) {
      version.reviews ??= [];
      const { reviews } = version;
      const known = reviews.find((entry) => entry.login === login);
      if (!known) reviews.push({ login, avatarUrl: review.author?.avatarUrl ?? null, verdict });
      // A later comment never overrides a verdict, as on the reviewer rows.
      else if (verdict !== "commented" || known.verdict === "commented") known.verdict = verdict;
    }
    if (login === viewer) viewerLatest = review.commit.oid;
  }

  const head = pull.commits.nodes.at(-1)?.commit;
  const headCommit = head?.oid === pull.headRefOid ? head : { oid: pull.headRefOid, committedDate: new Date().toISOString() };
  see(headCommit, Infinity).current = true;
  const viewerVersion = viewerLatest ? found.get(viewerLatest) : undefined;
  if (viewerVersion) viewerVersion.viewerLatestReview = true;

  const versions = [...found.values()]
    .toSorted((a, b) => (a.current === b.current ? a.order - b.order : Number(a.current) - Number(b.current)))
    // oxlint-disable-next-line oxc/no-map-spread -- the copy drops `order`, which mutating in place can't
    .map(({ order, ...version }, index) => ({ ...version, number: index + 1 }));
  return { baseRefOid: pull.baseRefOid, versions, baseHeads: deriveBaseHeads(basePulls) };
}

function deriveBaseHeads(basePulls: RawBasePull[]): { oid: string; at: string }[] {
  const heads = new Map<string, string>();
  const see = (commit: RawCommitRef, pushedAt?: string) => {
    const at = earliest(commit.committedDate, pushedAt);
    heads.set(commit.oid, earliest(heads.get(commit.oid) ?? at, at));
  };
  for (const pull of basePulls) {
    if (pull.isCrossRepository) continue;
    for (const event of pull.timelineItems.nodes) {
      if (event?.__typename !== "HeadRefForcePushedEvent") continue;
      if (event.beforeCommit) see(event.beforeCommit);
      if (event.afterCommit) see(event.afterCommit, event.createdAt);
    }
    const head = pull.commits.nodes.at(-1)?.commit;
    if (head?.oid === pull.headRefOid) see(head);
  }
  return [...heads].map(([oid, at]) => ({ oid, at }));
}

/**
 * @param pull The raw pull request.
 * @returns Every branch the pull request was based on, whether someone changed the base or GitHub did after the base
 * branch was merged: the current base and earlier ones, newest first.
 */
export function baseBranches(pull: RawVersionPull): string[] {
  const names = [pull.baseRefName];
  for (const event of pull.timelineItems.nodes.toReversed()) {
    if (event?.__typename === "BaseRefChangedEvent" && event.previousRefName) names.push(event.previousRefName);
    if (event?.__typename === "AutomaticBaseChangeSucceededEvent" && event.oldBase) names.push(event.oldBase);
  }
  return [...new Set(names)];
}

/**
 * Orders the commits to diff a version against. The service worker takes the first one the version descends from.
 * The current base comes first. In a stack, a version made before the base branch was rebased descends from one of the
 * base branch's earlier heads: the latest one before the version is the likeliest.
 * @param history The pull request's versions and its base branch's heads.
 * @param version The version to diff.
 * @returns Candidate bases, best first, at most {@link MAX_BASE_TRIES}.
 */
export function baseCandidates(history: VersionHistory, version: Version): string[] {
  const at = Date.parse(version.at);
  const heads = history.baseHeads.filter((head) => head.oid !== history.baseRefOid);
  const before = heads.filter((head) => Date.parse(head.at) <= at).toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const after = heads.filter((head) => Date.parse(head.at) > at).toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return [history.baseRefOid, ...[...before, ...after].map((head) => head.oid)].slice(0, MAX_BASE_TRIES);
}

/**
 * Picks which compare to diff a version against: of the candidate bases the version descends from, the closest one,
 * meaning the fewest commits between it and the version. The current base always counts: if the version doesn't
 * descend from it, its merge base with the version does.
 * @param compares The version compared with each candidate base, the current base first.
 * @returns The index of the compare to use.
 */
export function pickBase(compares: { onBase: boolean; aheadBy: number }[]): number {
  let best = 0;
  let bestAheadBy = compares[0]?.aheadBy ?? 0;
  for (const [index, compare] of compares.entries()) {
    if (index === 0 || !compare.onBase || compare.aheadBy >= bestAheadBy) continue;
    best = index;
    bestAheadBy = compare.aheadBy;
  }
  return best;
}

/**
 * Picks what to compare by default: what the viewer last reviewed, or else the version before the current one.
 * @param versions Oldest first.
 * @returns The two version numbers, or null when there is only one version.
 */
export function defaultRange(versions: Version[]): { from: number; to: number } | null {
  const current = versions.at(-1);
  const previous = versions.at(-2);
  if (!current || !previous) return null;
  return { from: (lastReviewedVersion(versions) ?? previous).number, to: current.number };
}

/** A pair of versions the viewer compared, by commit so it survives versions being renumbered. */
export interface SavedRange {
  /** The older side's commit, or {@link BASE} for the base branch. */
  from: string;
  to: string;
  /** Whether `to` was the current head then, so the range follows the head to later pushes. */
  toCurrent: boolean;
  /** When the viewer picked the range. */
  at: number;
}

/**
 * The older side of a range that shows one version's own changes against the base branch, as GitHub's Files changed
 * tab shows them: number 0 among the versions, and `base` in a saved range or a link.
 */
export const BASE = "base";

/** How long a pull request keeps the range the viewer last compared. */
const RANGE_MEMORY_MS = 30 * 86_400_000;
/** How many pull requests keep the range the viewer last compared. */
const MAX_SAVED_RANGES = 100;

/**
 * Picks what to compare when the view opens: the range the viewer last compared, with its newer side moved to the
 * current head when it was the head back then, or else {@link defaultRange}.
 * @param versions Oldest first.
 * @param saved The range the viewer last compared on this pull request, if any.
 * @returns The two version numbers, or null when there is only one version.
 */
export function restoreRange(versions: Version[], saved: SavedRange | null): { from: number; to: number } | null {
  const fallback = defaultRange(versions);
  if (!fallback || !saved) return fallback;
  // A range from a link names its commits by their short form.
  const from = saved.from === BASE ? 0 : versions.find((version) => version.oid.startsWith(saved.from))?.number;
  const to = saved.toCurrent ? versions.at(-1) : versions.find((version) => version.oid.startsWith(saved.to));
  if (from === undefined || !to || from === to.number) return fallback;
  return { from, to: to.number };
}

/**
 * Keeps the range on screen when the versions are fetched again: by commit, since a newly seen review can renumber
 * them, with the newer side moved to the current head when it was the head before.
 * @param before The versions the range was picked from, oldest first.
 * @param after The versions fetched again, oldest first.
 * @param from The older version's number in `before`.
 * @param to The newer version's number in `before`.
 * @returns The two version numbers in `after`, or null when one of the versions is gone.
 */
export function carryRange(before: Version[], after: Version[], from: number, to: number): { from: number; to: number } | null {
  const older = before[from - 1];
  const newer = before[to - 1];
  const carriedFrom = from === 0 ? 0 : older && after.find((version) => version.oid === older.oid)?.number;
  const carriedTo = newer && (newer.current ? after.at(-1) : after.find((version) => version.oid === newer.oid));
  return carriedFrom !== undefined && carriedTo ? { from: carriedFrom, to: carriedTo.number } : null;
}

/**
 * @param versions Oldest first.
 * @param from The older version's number.
 * @param to The newer version's number.
 * @param now The current time.
 * @returns The range to remember, or null for one not worth restoring: a version compared with itself.
 */
export function rangeToSave(versions: Version[], from: number, to: number, now: number): SavedRange | null {
  const older = from === 0 ? BASE : versions[from - 1]?.oid;
  const newer = versions[to - 1];
  if (!older || !newer || older === newer.oid) return null;
  return { from: older, to: newer.oid, toCurrent: newer.current, at: now };
}

/**
 * Finds the version a review comment was written on. A comment's commit is nearly always one, since a review makes its
 * commit a version; a comment drafted on a commit that was pushed over before the review was submitted may not be.
 * @param versions Oldest first.
 * @param oid The commit the comment was written on.
 * @param at When the comment was written.
 * @returns That version, or else the head at the time the comment was written, and whether it is the comment's own.
 */
export function commentVersion(versions: Version[], oid: string, at: string): { version: Version; exact: boolean } | null {
  const own = versions.find((version) => version.oid === oid);
  if (own) return { version: own, exact: true };
  const written = Date.parse(at);
  const then = versions.findLast((version) => Date.parse(version.at) <= written) ?? versions[0];
  return then ? { version: then, exact: false } : null;
}

/**
 * @param older The older compared version, or null for the base branch.
 * @param newer The newer compared version.
 * @returns The range as the page's URL keeps it, like `1a2b3c4..5d6e7f8`; a newer side that is the head is left
 * empty, so a link or a reload follows later pushes.
 */
export function formatRangeParam(older: Version | null, newer: Version): string {
  return `${older ? older.oid.slice(0, 7) : BASE}..${newer.current ? "" : newer.oid.slice(0, 7)}`;
}

/**
 * @param range A saved range, or one a review comment names.
 * @returns The range as the page's URL keeps it, like {@link formatRangeParam} writes it.
 */
export function rangeParam(range: SavedRange): string {
  return `${range.from === BASE ? BASE : range.from.slice(0, 7)}..${range.toCurrent ? "" : range.to.slice(0, 7)}`;
}

/**
 * @param value The URL's range, as {@link formatRangeParam} writes it.
 * @param now The current time.
 * @returns The range to open on, or null for an empty or malformed value, which opens on the remembered range.
 */
export function parseRangeParam(value: string, now: number): SavedRange | null {
  const match = /^(base|[\da-f]{7,40})\.\.([\da-f]{7,40})?$/u.exec(value);
  if (!match?.[1]) return null;
  return { from: match[1], to: match[2] ?? "", toCurrent: match[2] === undefined, at: now };
}

/**
 * @param ranges The saved ranges, by pull request.
 * @param now The current time.
 * @returns Those still worth keeping: the most recently picked ones younger than a month.
 */
export function keepRecentRanges(ranges: Record<string, SavedRange>, now: number): Record<string, SavedRange> {
  return Object.fromEntries(
    Object.entries(ranges)
      .filter(([, range]) => now - range.at < RANGE_MEMORY_MS)
      .toSorted(([, a], [, b]) => b.at - a.at)
      .slice(0, MAX_SAVED_RANGES),
  );
}

/**
 * @param versions Oldest first.
 * @returns The version the viewer last reviewed, or null when they never did or reviewed the current one.
 */
export function lastReviewedVersion(versions: Version[]): Version | null {
  return versions.find((version) => version.viewerLatestReview && !version.current) ?? null;
}

function earliest(a: string, b?: string): string {
  return b !== undefined && Date.parse(b) < Date.parse(a) ? b : a;
}

/**
 * Moves the compared range to a version picked on the timeline. A version before the range, or inside it, becomes
 * the older side, since "what changed since vN" is the usual question; one after the range becomes the newer side,
 * and so does any later version picked with Shift. The base branch, 0, can only be the older side.
 * @param range The compared range, `from` 0 for the base branch.
 * @param picked The version picked, 0 for the base branch.
 * @param newer Whether the viewer asked for the newer side (Shift).
 * @returns The new range, or null when it doesn't change.
 */
export function pickOnTimeline(range: { from: number; to: number }, picked: number, newer = false): { from: number; to: number } | null {
  if (picked === range.from || picked === range.to) return null;
  if (picked > range.to || (newer && picked > range.from)) return { from: range.from, to: picked };
  return { from: picked, to: range.to };
}

/**
 * @param version The version, or undefined for the base branch.
 * @param now The current time.
 * @returns The version in a few words for the picker: its number and what sets it apart.
 */
export function shortVersion(version: Version | undefined, now: number): { name: string; tag: string | null; review: boolean } {
  if (!version) return { name: "Base", tag: null, review: false };
  const name = `v${version.number}`;
  if (version.viewerLatestReview) return { name, tag: "your review", review: true };
  if (version.current) return { name, tag: "current", review: false };
  return { name, tag: formatAge(version.at, now).short, review: false };
}

/** Someone who reviewed at least one version, for the timeline's reviewer picker. */
export interface VersionReviewer {
  login: string;
  avatarUrl: string | null;
  /** How many versions they reviewed. */
  count: number;
}

/**
 * @param versions Oldest first.
 * @returns Everyone who reviewed a version, in the order they first did, with how many versions they reviewed.
 */
export function versionReviewers(versions: Version[]): VersionReviewer[] {
  const reviewers = new Map<string, VersionReviewer>();
  const reviews = versions.flatMap((version) => version.reviews ?? []);
  for (const review of reviews) {
    const known = reviewers.get(review.login);
    if (known) known.count++;
    else reviewers.set(review.login, { login: review.login, avatarUrl: review.avatarUrl, count: 1 });
  }
  return [...reviewers.values()];
}

/**
 * @param version The version.
 * @param focus The one reviewer to follow, or null for everyone.
 * @returns The reviews the timeline draws on the version.
 */
export function reviewsShown(version: Version, focus: string | null): VersionReview[] {
  const reviews = version.reviews ?? [];
  return focus === null ? reviews : reviews.filter((review) => review.login === focus);
}

/**
 * Whether a version can't be picked for one side of the range, since it would put the older side after the newer.
 * @param side Which side the version would be.
 * @param version The version's number, 0 for the base branch.
 * @param range The compared range.
 * @returns Whether to leave the version out of reach.
 */
export function outOfOrder(side: "from" | "to", version: number, range: { from: number; to: number }): boolean {
  return side === "from" ? version >= range.to : version <= range.from;
}
