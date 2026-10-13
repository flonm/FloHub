export interface RawCommitRef {
  oid: string;
  committedDate: string;
}

export interface RawVersionEvent {
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
  reviews: { nodes: { author: { login: string } | null; submittedAt: string | null; commit: RawCommitRef | null }[] };
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
  /** Whether the viewer's latest review was on this version. */
  viewerLatestReview: boolean;
  current: boolean;
}

export interface VersionHistory {
  baseRefOid: string;
  /** Oldest first; the last one is the current head. */
  versions: Version[];
  /** Heads the base branch had over time, when it is another pull request's head branch. */
  baseHeads: { oid: string; at: string }[];
}

/** How many candidate bases the service worker compares a version with. */
export const MAX_BASE_TRIES = 6;

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
    const version = { oid: commit.oid, at, order, pushedBy: pushedBy ?? null, reviewedBy: [], viewerLatestReview: false, current: false };
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
    if (login === viewer) viewerLatest = review.commit.oid;
  }

  const head = pull.commits.nodes.at(-1)?.commit;
  const headCommit = head?.oid === pull.headRefOid ? head : { oid: pull.headRefOid, committedDate: new Date().toISOString() };
  see(headCommit, Number.POSITIVE_INFINITY).current = true;
  if (viewerLatest) found.get(viewerLatest)!.viewerLatestReview = true;

  const versions = [...found.values()]
    .sort((a, b) => Number(a.current) - Number(b.current) || a.order - b.order)
    .map(({ order: _, ...version }, index) => ({ ...version, number: index + 1 }));
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
  for (const event of [...pull.timelineItems.nodes].reverse()) {
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
  const before = heads.filter((head) => Date.parse(head.at) <= at).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const after = heads.filter((head) => Date.parse(head.at) > at).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
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
  compares.forEach((compare, index) => {
    if (index > 0 && compare.onBase && compare.aheadBy < compares[best]!.aheadBy) best = index;
  });
  return best;
}

/**
 * Picks what to compare by default: what the viewer last reviewed, or else the version before the current one.
 * @param versions Oldest first.
 * @returns The two version numbers, or null when there is only one version.
 */
export function defaultRange(versions: Version[]): { from: number; to: number } | null {
  const current = versions.at(-1);
  if (!current || versions.length < 2) return null;
  const reviewed = versions.find((version) => version.viewerLatestReview && !version.current);
  return { from: (reviewed ?? versions.at(-2)!).number, to: current.number };
}

function earliest(a: string, b?: string): string {
  return b !== undefined && Date.parse(b) < Date.parse(a) ? b : a;
}
