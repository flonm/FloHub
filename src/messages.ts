import type { FailureCode, Overview } from "./github";
import type { PullRef } from "./pull-ref";

export type Message =
  | { type: "overview"; ref: PullRef }
  | { type: "rerequest"; ref: PullRef; login: string }
  | { type: "open-options" };

export type Reply<T> = { ok: true; value: T } | { ok: false; code: FailureCode; message: string };

export interface ReplyByType {
  overview: Overview;
  rerequest: null;
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
