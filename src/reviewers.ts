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
      state: RawReviewState;
      submittedAt: string | null;
      /** Missing from overviews cached before review texts were fetched. */
      bodyText?: string;
      url?: string;
      author: RawActor | null;
      commit?: { oid: string } | null;
    }[];
  };
}

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
  canRerequest: boolean;
  /** Whether the viewer can remind a currently requested reviewer by removing and re-adding the request. */
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
  commented: boolean;
}

/**
 * Derives one entry per reviewer from a pull request's review requests and review history.
 *
 * A reviewer's verdict is their latest approval, change request or dismissed review; a later
 * plain comment never overrides it. A requested reviewer who already reviewed is re-requested.
 * The pull request's author, unsubmitted reviews and bots that only commented are left out.
 * @param pullRequest The pull request as returned by the reviewer query.
 * @param viewerLogin The login of the token's owner, who is never offered a re-request of themselves.
 * @returns The reviewers, most actionable status first.
 */
export function deriveReviewers(pullRequest: RawPullRequest, viewerLogin: string): Reviewer[] {
  const authorLogin = pullRequest.author?.login;
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
    else candidate.opinionated = verdict;
  }

  return [...candidates.values()]
    .flatMap((candidate) => {
      const verdict = candidate.opinionated ?? (candidate.commented ? "commented" : null);
      if (candidate.kind === "bot" && !candidate.requested && verdict === "commented") return [];
      const status: ReviewerStatus | null = candidate.requested
        ? verdict
          ? "rerequested"
          : "pending"
        : verdict;
      if (!status) return [];
      return [
        {
          key: candidate.key,
          kind: candidate.kind,
          name: candidate.name,
          avatarUrl: candidate.avatarUrl,
          url: candidate.url,
          status,
          previous: status === "rerequested" ? verdict : null,
          canRerequest:
            pullRequest.viewerCanUpdate &&
            candidate.kind === "user" &&
            !candidate.requested &&
            candidate.name !== viewerLogin,
          canPoke:
            pullRequest.viewerCanUpdate &&
            candidate.requested &&
            candidate.kind !== "bot" &&
            candidate.name !== viewerLogin,
        },
      ];
    })
    .sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name),
    );
}

function toCandidate(reviewer: RawActor | RawTeam): Candidate {
  const base = { requested: false, opinionated: null, commented: false };
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
