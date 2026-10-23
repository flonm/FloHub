export type RawReviewState =
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "COMMENTED"
  | "DISMISSED"
  | "PENDING";

export interface RawActor {
  __typename: "User" | "Bot" | "Mannequin" | "EnterpriseUserAccount" | "Organization";
  login: string;
  avatarUrl: string;
  url: string;
}

export interface RawTeam {
  __typename: "Team";
  name: string;
  combinedSlug: string;
  avatarUrl: string | null;
  url: string;
}

export interface RawPullRequest {
  author: { login: string } | null;
  viewerCanUpdate: boolean;
  reviewRequests: { nodes: { requestedReviewer: RawActor | RawTeam | null }[] };
  reviews: {
    nodes: {
      /** Missing from overviews cached before review ids were fetched. */
      id?: string;
      state: RawReviewState;
      submittedAt: string | null;
      /** Missing from overviews cached before review texts were fetched. */
      bodyText?: string;
      bodyHTML?: string;
      url?: string;
      author: RawActor | null;
      commit?: { oid: string } | null;
    }[];
  };
  /** Missing from overviews cached before dismissals were fetched. */
  dismissals?: RawDismissals;
}

/** The timeline's dismissals, the only place that keeps what a dismissed review had said. */
export interface RawDismissals {
  nodes: ({ previousReviewState?: RawReviewState; review?: { url: string } | null } | null)[];
}

/** The verdict a review gave before it was dismissed. */
export type DismissedVerdict = "approved" | "changes_requested";

export type Verdict = "approved" | "changes_requested" | "dismissed" | "commented";

export type ReviewerStatus = Verdict | "pending" | "rerequested";

export interface Reviewer {
  key: string;
  kind: "user" | "bot" | "team";
  name: string;
  avatarUrl: string | null;
  url: string;
  status: ReviewerStatus;
  /** The verdict a re-requested reviewer gave before the new request. */
  previous: Verdict | null;
  /** What the reviewer's dismissed review had been, when their verdict is a dismissal and the timeline still says. */
  dismissedFrom: DismissedVerdict | null;
  /** The node id of the reviewer's standing approval or change request, when the viewer may dismiss it. */
  dismissId: string | null;
  canRerequest: boolean;
  /** Whether the viewer can remind a currently requested reviewer who hasn't approved yet by removing and re-adding the request. */
  canPoke: boolean;
}

const VERDICT_BY_STATE: Partial<Record<RawReviewState, Verdict>> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
  DISMISSED: "dismissed",
  COMMENTED: "commented",
};

const STATUS_ORDER: Record<ReviewerStatus, number> = {
  changes_requested: 0,
  rerequested: 1,
  pending: 2,
  dismissed: 3,
  commented: 4,
  approved: 5,
};

interface Candidate {
  key: string;
  kind: Reviewer["kind"];
  name: string;
  avatarUrl: string | null;
  url: string;
  requested: boolean;
  opinionated: Verdict | null;
  dismissedFrom: DismissedVerdict | null;
  /** The node id of the review behind the verdict. */
  reviewId: string | null;
  commented: boolean;
}

/**
 * Derives one entry per reviewer from a pull request's review requests and review history.
 *
 * A reviewer's verdict is their latest approval, change request or dismissed review; a later
 * plain comment never overrides it. A requested reviewer who already reviewed is re-requested.
 * The pull request's author, unsubmitted reviews and bots that only commented are left out. A viewer who can
 * update the pull request may dismiss anyone else's standing approval or change request, a bot's included.
 * @param pullRequest The pull request as returned by the reviewer query.
 * @param viewerLogin The login of the token's owner, who is never offered a re-request of themselves.
 * @returns The reviewers, most actionable status first.
 */
export function deriveReviewers(pullRequest: RawPullRequest, viewerLogin: string): Reviewer[] {
  const authorLogin = pullRequest.author?.login;
  const dismissed = dismissedVerdicts(pullRequest.dismissals);
  const candidates = new Map<string, Candidate>();

  for (const { requestedReviewer } of pullRequest.reviewRequests.nodes) {
    if (!requestedReviewer) continue;
    const candidate = toCandidate(requestedReviewer);
    candidate.requested = true;
    candidates.set(candidate.key, candidate);
  }

  for (const review of pullRequest.reviews.nodes) {
    const verdict = VERDICT_BY_STATE[review.state];
    if (!verdict || !review.author || review.author.login === authorLogin) continue;
    const key = actorKey(review.author);
    const candidate = candidates.get(key) ?? toCandidate(review.author);
    candidates.set(key, candidate);
    if (verdict === "commented") candidate.commented = true;
    else {
      candidate.opinionated = verdict;
      candidate.dismissedFrom = verdict === "dismissed" && review.url ? (dismissed.get(review.url) ?? null) : null;
      candidate.reviewId = review.id ?? null;
    }
  }

  return [...candidates.values()]
    .flatMap((candidate) => {
      const verdict = candidate.opinionated ?? (candidate.commented ? "commented" : null);
      if (candidate.kind === "bot" && !candidate.requested && verdict === "commented") return [];
      const status: ReviewerStatus | null = candidate.requested
        ? (verdict ? "rerequested" : "pending")
        : verdict;
      if (!status) return [];
      return {
        key: candidate.key,
        kind: candidate.kind,
        name: candidate.name,
        avatarUrl: candidate.avatarUrl,
        url: candidate.url,
        status,
        previous: status === "rerequested" ? verdict : null,
        dismissedFrom: candidate.dismissedFrom,
        dismissId:
          pullRequest.viewerCanUpdate &&
          (candidate.opinionated === "approved" || candidate.opinionated === "changes_requested") &&
          candidate.name !== viewerLogin
            ? candidate.reviewId
            : null,
        canRerequest:
          pullRequest.viewerCanUpdate &&
          candidate.kind === "user" &&
          !candidate.requested &&
          candidate.name !== viewerLogin,
        canPoke:
          pullRequest.viewerCanUpdate &&
          candidate.requested &&
          candidate.kind !== "bot" &&
          candidate.name !== viewerLogin &&
          candidate.opinionated !== "approved",
      };
    })
    .toSorted((a, b) => {
      const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      return byStatus === 0 ? a.name.localeCompare(b.name) : byStatus;
    });
}

/**
 * GitHub turns a dismissed review's state into DISMISSED and keeps what it had been only on the dismissal event.
 * @param dismissals The pull request's dismissal events, if fetched.
 * @returns The original verdict of each dismissed approval or change request, by review URL.
 */
export function dismissedVerdicts(dismissals?: RawDismissals): Map<string, DismissedVerdict> {
  const verdicts = new Map<string, DismissedVerdict>();
  const events = dismissals?.nodes ?? [];
  for (const event of events) {
    const url = event?.review?.url;
    const state = event?.previousReviewState;
    if (url && (state === "APPROVED" || state === "CHANGES_REQUESTED")) verdicts.set(url, state === "APPROVED" ? "approved" : "changes_requested");
  }
  return verdicts;
}

function toCandidate(reviewer: RawActor | RawTeam): Candidate {
  const base = { requested: false, opinionated: null, dismissedFrom: null, reviewId: null, commented: false };
  if (reviewer.__typename === "Team") {
    return {
      ...base,
      key: actorKey(reviewer),
      kind: "team",
      name: reviewer.combinedSlug,
      avatarUrl: reviewer.avatarUrl,
      url: reviewer.url,
    };
  }
  return {
    ...base,
    key: actorKey(reviewer),
    kind: reviewer.__typename === "Bot" ? "bot" : "user",
    name: reviewer.login,
    avatarUrl: reviewer.avatarUrl,
    url: reviewer.url,
  };
}

function actorKey(reviewer: RawActor | RawTeam): string {
  return reviewer.__typename === "Team" ? `team:${reviewer.combinedSlug}` : `user:${reviewer.login}`;
}
