import type { RawActor, RawReviewState } from "./reviewers";

export type DiscussionVerdict = "approved" | "changes_requested" | "dismissed" | "commented";

/** A comment on the pull request as a whole: a review's own text or a general comment, never an inline thread. */
export interface DiscussionItem {
  key: string;
  author: string;
  avatarUrl: string | null;
  profileUrl: string | null;
  /** Written by a bot, or a stack tool's comment posted under a person's account. */
  bot: boolean;
  /** The review's verdict, or null for a general comment. */
  verdict: DiscussionVerdict | null;
  text: string;
  /** GitHub's rendering of the text, or null in an overview cached before it was fetched. */
  html: string | null;
  at: string;
  url: string;
}

export interface RawDiscussionComment {
  bodyText: string;
  /** Missing from overviews cached before rendered texts were fetched. */
  bodyHTML?: string;
  url: string;
  createdAt: string;
  author: RawActor | null;
}

export interface RawDiscussionSource {
  reviews: {
    nodes: {
      state: RawReviewState;
      submittedAt: string | null;
      bodyText?: string;
      bodyHTML?: string;
      url?: string;
      author: RawActor | null;
    }[];
  };
  /** Missing in an overview cached before comments were fetched. */
  comments?: { nodes: RawDiscussionComment[] };
}

const VERDICTS: Partial<Record<RawReviewState, DiscussionVerdict>> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
  DISMISSED: "dismissed",
  COMMENTED: "commented",
};

/** Comments stack tools post under the author's own account. */
const TOOL_TEXTS = [
  /^Warning\s*This pull request is not mergeable via GitHub because a downstack PR is open/u,
  /This stack of pull requests is managed by Graphite/u,
  /Stack created with GitHub Stacks CLI/u,
];

/** Whitespace and the zero-width characters an empty change request is sent with. */
const INVISIBLE = /[\s\u{200B}-\u{200D}\u{2060}\u{FEFF}]/gu;

/**
 * Collects the review texts and general comments of a pull request, newest first. Reviews without text,
 * such as an inline-only review or an empty change request, and unsubmitted drafts are left out.
 * @param pull The pull request's reviews and comments.
 * @returns The discussion, newest first.
 */
export function deriveDiscussion(pull: RawDiscussionSource): DiscussionItem[] {
  const items: DiscussionItem[] = [];
  for (const review of pull.reviews.nodes) {
    const verdict = VERDICTS[review.state];
    const text = review.bodyText?.trim() ?? "";
    if (!verdict || !review.submittedAt || !review.url || !hasText(text)) continue;
    items.push(toItem(review.url, review.author, verdict, text, review.bodyHTML ?? null, review.submittedAt));
  }
  const comments = pull.comments?.nodes ?? [];
  for (const comment of comments) {
    const text = comment.bodyText.trim();
    if (!hasText(text)) continue;
    items.push(toItem(comment.url, comment.author, null, text, comment.bodyHTML ?? null, comment.createdAt));
  }
  return items.toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/**
 * @param pull The pull request's reviews.
 * @param viewer The viewer's login.
 * @returns When the viewer last submitted a review, or null.
 */
export function lastReviewBy(pull: RawDiscussionSource, viewer: string): string | null {
  let latest: string | null = null;
  for (const review of pull.reviews.nodes) {
    if (review.author?.login !== viewer || !review.submittedAt || review.state === "PENDING") continue;
    if (!latest || Date.parse(review.submittedAt) > Date.parse(latest)) latest = review.submittedAt;
  }
  return latest;
}

/**
 * An item is new when someone other than the viewer wrote it after the viewer last looked.
 * @param item The item.
 * @param seenAt When the viewer last opened the pull request, or reviewed it; null marks nothing as new.
 * @param viewer The viewer's login.
 * @returns Whether to highlight the item.
 */
export function isUnread(item: DiscussionItem, seenAt: string | null, viewer: string): boolean {
  return seenAt !== null && item.author !== viewer && Date.parse(item.at) > Date.parse(seenAt);
}

function hasText(text: string): boolean {
  return text.replace(INVISIBLE, "").length > 0;
}

function toItem(
  url: string,
  author: RawActor | null,
  verdict: DiscussionVerdict | null,
  text: string,
  html: string | null,
  at: string,
): DiscussionItem {
  return {
    key: url,
    author: author?.login ?? "ghost",
    avatarUrl: author?.avatarUrl ?? null,
    profileUrl: author?.url ?? null,
    bot: author?.__typename === "Bot" || (author?.login.endsWith("[bot]") ?? false) || TOOL_TEXTS.some((tool) => tool.test(text)),
    verdict,
    text,
    html,
    at,
    url,
  };
}
