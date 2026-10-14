export type StackTone = "success" | "attention" | "accent" | "danger" | "done" | "neutral";

export interface RawTimelineItem {
  __typename: string;
  createdAt?: string;
  submittedAt?: string | null;
  commit?: { committedDate: string };
}

export interface RawStackPull {
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  /** Missing in overviews cached before FloHub asked for it. */
  isInMergeQueue?: boolean;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  createdAt: string;
  lastEditedAt: string | null;
  mergedAt: string | null;
  statusCheckRollup: { state: "ERROR" | "EXPECTED" | "FAILURE" | "PENDING" | "SUCCESS" } | null;
  latestOpinionatedReviews: { nodes: { state: string }[] };
  reviewThreads: { totalCount: number; nodes: { isResolved: boolean }[] };
  timelineItems: { nodes: RawTimelineItem[] };
}

export interface RawStack {
  number: number;
  size: number;
  baseRefName: string;
  entries: { nodes: { position: number; pullRequest: RawStackPull | null }[] };
}

export interface StackEntry {
  number: number;
  title: string;
  url: string;
  position: number;
  tone: StackTone;
  label: string;
  /** More about the status, shown when hovering the badge. */
  detail: string | null;
  merged: boolean;
  current: boolean;
  resolvedThreads: number;
  totalThreads: number;
  lastActivity: string;
}

export interface StackView {
  /** Null when the pull request is in no stack and the view shows it alone. */
  number: number | null;
  baseRefName: string;
  /** Top of the stack first, the layer next to the base branch last. */
  entries: StackEntry[];
  currentPosition: number;
  size: number;
}

/**
 * Builds the stack overview for a pull request, or a one-entry view when it is in no stack.
 * @param pullRequest The pull request being viewed, with its stack.
 * @param baseRefName The branch the pull request targets.
 * @returns The stack, top first.
 */
export function deriveStack(
  pullRequest: RawStackPull & { stack: RawStack | null },
  baseRefName: string,
): StackView {
  const stack = pullRequest.stack;
  const nodes = stack
    ? stack.entries.nodes.flatMap(({ position, pullRequest: entry }) => (entry ? [{ position, entry }] : []))
    : [{ position: 1, entry: pullRequest }];

  const entries = nodes
    .map(({ position, entry }) => toEntry(entry, position, entry.number === pullRequest.number))
    .sort((a, b) => b.position - a.position);

  return {
    number: stack?.number ?? null,
    baseRefName: stack?.baseRefName ?? baseRefName,
    entries,
    currentPosition: entries.find((entry) => entry.current)?.position ?? 1,
    size: stack?.size ?? 1,
  };
}

function toEntry(pull: RawStackPull, position: number, current: boolean): StackEntry {
  const { tone, label, detail } = deriveStatus(pull);
  return {
    number: pull.number,
    title: pull.title,
    url: pull.url,
    position,
    tone,
    label,
    detail,
    merged: pull.state === "MERGED",
    current,
    resolvedThreads: pull.reviewThreads.nodes.filter((thread) => thread.isResolved).length,
    totalThreads: pull.reviewThreads.totalCount,
    lastActivity: lastActivity(pull),
  };
}

/**
 * Picks the one status that says where a pull request stands, most blocking first.
 *
 * Pull requests further up a stack target another branch, where branch protection leaves
 * `reviewDecision` empty; their decision comes from the latest approvals and change requests.
 * An approval counts even while branch rules still require more reviews, with a detail that says so.
 * An approved pull request is only ready to merge once every conversation is resolved and its checks have finished.
 * @param pull The pull request.
 * @returns The badge tone and label.
 */
export function deriveStatus(pull: RawStackPull): { tone: StackTone; label: string; detail: string | null } {
  if (pull.state === "MERGED") return { tone: "done", label: "Merged", detail: null };
  if (pull.state === "CLOSED") return { tone: "neutral", label: "Closed", detail: null };
  if (pull.isInMergeQueue) return { tone: "done", label: "Merging…", detail: "In the merge queue." };
  if (pull.isDraft) return { tone: "neutral", label: "Draft", detail: null };
  if (pull.mergeable === "CONFLICTING") return { tone: "danger", label: "Merge conflict", detail: null };
  const checks = pull.statusCheckRollup?.state;
  if (checks === "FAILURE" || checks === "ERROR") return { tone: "danger", label: "Checks failed", detail: null };

  const states = pull.latestOpinionatedReviews.nodes.map((review) => review.state);
  if (pull.reviewDecision === "CHANGES_REQUESTED" || states.includes("CHANGES_REQUESTED")) {
    return { tone: "attention", label: "Changes requested", detail: null };
  }
  if (pull.reviewDecision !== "APPROVED" && !states.includes("APPROVED")) {
    return { tone: "accent", label: "Needs review", detail: null };
  }

  const unresolved = pull.reviewThreads.nodes.filter((thread) => !thread.isResolved).length;
  if (unresolved > 0) {
    const conversations = unresolved === 1 ? "1 conversation is" : `${unresolved} conversations are`;
    return { tone: "attention", label: "Unresolved comments", detail: `Approved, but ${conversations} still unresolved.` };
  }
  if (checks === "PENDING" || checks === "EXPECTED") {
    return { tone: "neutral", label: "Checks running", detail: "Approved, waiting for checks to finish before this can merge." };
  }
  const detail =
    pull.reviewDecision === "REVIEW_REQUIRED"
      ? "Approved, but GitHub's branch rules still require more reviews before this can merge."
      : null;
  return { tone: "success", label: "Ready to merge", detail };
}

/**
 * @param pull The pull request.
 * @returns The newest of its creation, merge, last push, title or body edit and review, as an ISO timestamp.
 */
export function lastActivity(pull: RawStackPull): string {
  const timestamps = [pull.createdAt, pull.lastEditedAt, pull.mergedAt];
  for (const item of pull.timelineItems.nodes) {
    timestamps.push(item.createdAt ?? null, item.submittedAt ?? null, item.commit?.committedDate ?? null);
  }
  return timestamps.filter((timestamp): timestamp is string => !!timestamp).reduce((latest, timestamp) =>
    Date.parse(timestamp) > Date.parse(latest) ? timestamp : latest,
  );
}
