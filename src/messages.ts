import type { FailureCode, Overview } from "./github";
import type { PullRef } from "./pull-ref";
import type { Inbox } from "./inbox";
import type { ViewedFiles } from "./viewed";
import type { ReviewEvent } from "./shortcuts";

export type Message =
  | { type: "overview"; ref: PullRef }
  | { type: "rerequest"; ref: PullRef; login: string }
  | { type: "poke"; ref: PullRef; reviewer: { kind: "user" | "team"; name: string } }
  | { type: "viewed-files"; ref: PullRef }
  | { type: "set-viewed"; pullRequestId: string; path: string; viewed: boolean }
  | { type: "pending-comments"; ref: PullRef }
  | { type: "submit-review"; ref: PullRef; event: ReviewEvent; body: string }
  | { type: "inbox" }
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
