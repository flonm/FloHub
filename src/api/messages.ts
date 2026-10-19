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

/** The origin the content script runs on: only a tab there may ask for anything that spends the token. */
const GITHUB_ORIGIN = "https://github.com/";

/** What GitHub allows in an owner or repository name; a bare `.`/`..` would make the request path climb. */
const NAME = /^(?!\.{1,2}$)[\w.-]+$/u;
/** A login, or a team as `owner/slug`. */
const REVIEWER = /^[\w.-]+(\/[\w.-]+)?$/u;
/** A commit as the compare path spells it: one safe segment, never a bare `.`/`..` that would climb the path. */
const COMMIT = /^(?!\.{1,2}$)[\w.-]{4,64}$/u;
const MAX_NAME = 100;
const MAX_REVIEWER = 200;
const MAX_ID = 200;
const MAX_PATH = 4096;
const MAX_BODY = 65_536;
const MAX_BASES = 8;
const MAX_AGE_MS = 7 * 86_400_000;
const MAX_SCOPES = 100;
const MOVES = new Set<unknown>(["close", "reopen", "draft", "ready"] satisfies PullMove[]);
const SIDES = new Set<unknown>(["LEFT", "RIGHT"]);
const REVIEW_EVENTS = new Set<unknown>(["APPROVE", "REQUEST_CHANGES", "COMMENT"] satisfies ReviewEvent[]);

/** Messages only the content script on a github.com page may send. */
const FROM_PAGE = new Set<Message["type"]>([
  "overview",
  "rerequest",
  "dismiss-review",
  "post-comment",
  "poke",
  "viewed-files",
  "set-viewed",
  "pending-comments",
  "submit-review",
  "move-pull",
  "versions",
  "version-patch",
  "review-comment",
  "review-threads",
  "review-action",
  "open-options",
]);

/** The parts of `chrome.runtime.MessageSender` the check reads. */
export interface SenderInfo {
  /** The extension that sent the message; only FloHub itself may. */
  id: string;
  /** The page or extension page the message came from. */
  url?: string;
}

/**
 * @param message The request.
 * @param sender Where it came from.
 * @param extensionId FloHub's own id.
 * @returns Whether the sender may send this kind of message at all.
 */
export function maySend(message: Message, sender: SenderInfo, extensionId: string): boolean {
  if (sender.id !== extensionId) return false;
  return FROM_PAGE.has(message.type) ? (sender.url?.startsWith(GITHUB_ORIGIN) ?? false) : true;
}

/**
 * @param ref A pull request reference from a message.
 * @returns Whether it is a well-formed reference the API can be asked about.
 */
export function isValidRef(ref: unknown): ref is PullRef {
  if (!isRecord(ref)) return false;
  return isName(ref.owner) && isName(ref.repo) && typeof ref.number === "number" && Number.isSafeInteger(ref.number) && ref.number > 0;
}

/**
 * @param message The request.
 * @returns Whether every field the service worker acts on has the shape and the bounds it expects.
 */
export function isValidMessage(message: unknown): boolean {
  if (!isRecord(message)) return false;
  switch (message.type) {
    case "overview":
    case "viewed-files":
    case "pending-comments":
    case "versions":
    case "review-threads": {
      return isValidRef(message.ref);
    }
    case "rerequest": {
      return isValidRef(message.ref) && isReviewerName(message.login);
    }
    case "dismiss-review": {
      return isBounded(message.reviewId, MAX_ID) && isBody(message.message);
    }
    case "post-comment": {
      return isValidRef(message.ref) && isBody(message.body);
    }
    case "poke": {
      return isValidRef(message.ref) && isReviewer(message.reviewer);
    }
    case "set-viewed": {
      return isBounded(message.pullRequestId, MAX_ID) && isBounded(message.path, MAX_PATH) && typeof message.viewed === "boolean";
    }
    case "submit-review": {
      return (
        isValidRef(message.ref) &&
        REVIEW_EVENTS.has(message.event) &&
        isBody(message.body)
      );
    }
    case "move-pull": {
      return isBounded(message.pullRequestId, MAX_ID) && MOVES.has(message.move);
    }
    case "version-patch": {
      return isValidRef(message.ref) && isCommit(message.head) && isBases(message.bases);
    }
    case "review-comment": {
      return isValidRef(message.ref) && isRecord(message.link) && (message.link.kind === "comment" || message.link.kind === "thread") && isId(message.link.id);
    }
    case "review-action": {
      return isValidRef(message.ref) && isReviewAction(message.action);
    }
    case "inbox": {
      return message.maxAgeMs === undefined || (typeof message.maxAgeMs === "number" && Number.isFinite(message.maxAgeMs) && message.maxAgeMs >= 0 && message.maxAgeMs <= MAX_AGE_MS);
    }
    case "everything": {
      return Array.isArray(message.scopes) && message.scopes.length <= MAX_SCOPES && message.scopes.every((scope) => isScope(scope));
    }
    case "open-options": {
      return true;
    }
    default: {
      return false;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_NAME && NAME.test(value);
}

function isReviewerName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_REVIEWER && REVIEWER.test(value);
}

function isReviewer(value: unknown): boolean {
  return isRecord(value) && (value.kind === "user" || value.kind === "team") && isReviewerName(value.name);
}

function isBounded(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function isCommit(value: unknown): value is string {
  return typeof value === "string" && COMMIT.test(value);
}

function isBody(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_BODY;
}

/** A number GitHub gives a comment or thread, which the REST path takes as one segment. */
function isId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** An owner, or a repository as `owner/name`, as the inbox's "Everything else" searches them. */
function isScope(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = value.split("/");
  return parts.length <= 2 && parts.every((part) => isName(part));
}

function isReviewAction(action: unknown): boolean {
  if (!isRecord(action)) return false;
  switch (action.kind) {
    case "comment": {
      return (
        (action.mode === "single" || action.mode === "review") &&
        isCommit(action.head) &&
        isBounded(action.path, MAX_PATH) &&
        isBody(action.body) &&
        isId(action.line) &&
        SIDES.has(action.side) &&
        (action.startLine === undefined || isId(action.startLine)) &&
        (action.startSide === undefined || SIDES.has(action.startSide))
      );
    }
    case "reply": {
      return isBounded(action.threadId, MAX_ID) && isId(action.commentId) && isBody(action.body);
    }
    case "resolve": {
      return isBounded(action.threadId, MAX_ID) && typeof action.resolved === "boolean";
    }
    default: {
      return false;
    }
  }
}

function isBases(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= MAX_BASES && value.every((base) => isCommit(base));
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
