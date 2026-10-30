import type { FailureCode, Overview, VersionPatch } from "./github";
import type { CommentLink, CommentPlace } from "../core/comment-jump";
import type { ReviewAction, ReviewDiscussion } from "../core/threads";
import type { PullRef } from "../core/pull-ref";
import type { Inbox } from "../core/inbox";
import type { Everything } from "./inbox-sync";
import type { ViewedFiles } from "../core/viewed";
import type { ReviewEvent } from "../core/shortcuts";
import type { PullMove } from "../core/pull-state";
import type { VersionHistory } from "../core/versions";

export type Message =
  | { type: "overview"; ref: PullRef }
  | { type: "rerequest"; ref: PullRef; login: string }
  | { type: "dismiss-review"; reviewId: string; message: string }
  | { type: "post-comment"; ref: PullRef; body: string }
  | { type: "poke"; ref: PullRef; reviewer: { kind: "user" | "team"; name: string } }
  | { type: "viewed-files"; ref: PullRef }
  | { type: "set-viewed"; pullRequestId: string; path: string; viewed: boolean }
  | { type: "pending-comments"; ref: PullRef }
  | { type: "submit-review"; ref: PullRef; event: ReviewEvent; body: string }
  | { type: "move-pull"; pullRequestId: string; move: PullMove }
  /** `maxAgeMs` lets a stored inbox that young answer without asking GitHub. */
  | { type: "inbox"; maxAgeMs?: number }
  /** Every open pull request of these owners and `owner/name` repositories, for the inbox's "Everything else". */
  | { type: "everything"; scopes: string[] }
  | { type: "versions"; ref: PullRef }
  | { type: "version-patch"; ref: PullRef; head: string; bases: string[] }
  | { type: "review-comment"; ref: PullRef; link: CommentLink }
  | { type: "review-threads"; ref: PullRef }
  | { type: "review-action"; ref: PullRef; action: ReviewAction }
  | { type: "open-options" };

export type Reply<T> = { ok: true; value: T } | { ok: false; code: FailureCode; message: string };

export interface ReplyByType {
  overview: Overview;
  rerequest: null;
  "dismiss-review": null;
  "post-comment": null;
  poke: null;
  "viewed-files": ViewedFiles;
  "set-viewed": null;
  "pending-comments": number | null;
  "submit-review": null;
  "move-pull": null;
  inbox: Inbox;
  everything: Everything;
  versions: VersionHistory;
  "version-patch": VersionPatch;
  "review-comment": CommentPlace;
  "review-threads": ReviewDiscussion;
  "review-action": null;
  "open-options": null;
}

/**
 * Sends a message to the service worker, which holds the token and talks to GitHub.
 * @param message The request.
 * @returns The service worker's reply.
 */
export async function send<M extends Message>(message: M): Promise<Reply<ReplyByType[M["type"]]>> {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch {
    return { ok: false, code: "failed", message: "The extension was updated. Reload the page." };
  }
}
