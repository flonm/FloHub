import type { FailureCode, Overview, VersionPatch } from "./github";
import type { CommentPlace } from "../core/comment-jump";
import type { PullRef } from "../core/pull-ref";
import type { Inbox } from "../core/inbox";
import type { ViewedFiles } from "../core/viewed";
import type { ReviewEvent } from "../core/shortcuts";
import type { VersionHistory } from "../core/versions";

export type Message =
  | { type: "overview"; ref: PullRef }
  | { type: "rerequest"; ref: PullRef; login: string }
  | { type: "poke"; ref: PullRef; reviewer: { kind: "user" | "team"; name: string } }
  | { type: "viewed-files"; ref: PullRef }
  | { type: "set-viewed"; pullRequestId: string; path: string; viewed: boolean }
  | { type: "pending-comments"; ref: PullRef }
  | { type: "submit-review"; ref: PullRef; event: ReviewEvent; body: string }
  /** `maxAgeMs` lets a stored inbox that young answer without asking GitHub. */
  | { type: "inbox"; maxAgeMs?: number }
  | { type: "versions"; ref: PullRef }
  | { type: "version-patch"; ref: PullRef; head: string; bases: string[] }
  | { type: "review-comment"; ref: PullRef; id: number }
  | { type: "open-options" };

export type Reply<T> = { ok: true; value: T } | { ok: false; code: FailureCode; message: string };

export interface ReplyByType {
  overview: Overview;
  rerequest: null;
  poke: null;
  "viewed-files": ViewedFiles;
  "set-viewed": null;
  "pending-comments": number | null;
  "submit-review": null;
  inbox: Inbox;
  versions: VersionHistory;
  "version-patch": VersionPatch;
  "review-comment": CommentPlace;
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
