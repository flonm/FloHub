import { BASE, commentVersion, type SavedRange, type Version, type VersionHistory } from "./versions";

/** Where a review comment sits, as GitHub's API describes it. */
export interface CommentPlace {
  path: string;
  /** The commit the comment was written on. */
  originalCommit: string;
  originalLine: number | null;
  originalStartLine: number | null;
  /** The lines in the current diff, or null when the comment is outdated. */
  line: number | null;
  startLine: number | null;
  side: "LEFT" | "RIGHT";
  createdAt: string;
}

/** A line to scroll to, in the numbers of the version it is looked up in. */
interface TargetLine {
  path: string;
  line: number;
  startLine?: number;
  side: "LEFT" | "RIGHT";
}

/** A range for the versions view, and the commented line in it. */
export interface JumpTarget {
  range: SavedRange;
  line?: TargetLine;
}

/** The ways to look at the code a comment is on. */
export interface CommentJump {
  /** The version the comment was written on, and whether it is the comment's own commit or only the nearest version. */
  version: Version;
  exact: boolean;
  /** How the code changed since the comment, from its version to the current head; null when that is the head. */
  since: JumpTarget | null;
  /** The code as the comment saw it: its version against the base branch. */
  at: JumpTarget;
  /** The commented lines in the current diff; null when the comment is outdated. */
  current: TargetLine | null;
}

/**
 * Works out what the comment's "show the code" choices show. A comment names its lines as the version it was written
 * on numbers them, so both version views look the lines up there.
 * @param versions The pull request's versions, oldest first.
 * @param comment Where the comment sits.
 * @param now The current time, which stamps the ranges.
 * @returns The choices, or null when the pull request has no versions.
 */
export function commentJump(versions: Version[], comment: CommentPlace, now: number): CommentJump | null {
  const found = commentVersion(versions, comment.originalCommit, comment.createdAt);
  if (!found) return null;
  const { version, exact } = found;
  const lines = (line: number | null, startLine: number | null): TargetLine | undefined =>
    line === null
      ? undefined
      : {
          path: comment.path,
          line,
          ...(startLine !== null && startLine !== line && { startLine }),
          side: comment.side,
        };
  // The nearest version may number the lines differently, so only the comment's own version gets them.
  const original = exact ? lines(comment.originalLine, comment.originalStartLine) : undefined;
  const target = (range: SavedRange): JumpTarget => ({ range, ...(original && { line: original }) });
  return {
    version,
    exact,
    since: version.current ? null : target({ from: version.oid, to: "", toCurrent: true, at: now }),
    at: target({ from: BASE, to: version.oid, toCurrent: version.current, at: now }),
    current: lines(comment.line, comment.startLine) ?? null,
  };
}

/** What a comments-panel link to the code names: a comment by its number, or, for an outdated one, its thread. */
export type CommentLink = { kind: "comment"; id: number } | { kind: "thread"; id: number };

/**
 * Reads the comment a link from GitHub's comments panel to the code points at. A current comment links to
 * `…/pull/<n>/changes#r<comment>`; an outdated one to the single-commit view, `…/changes/<commit>?…#r<thread>`, under
 * its thread's number instead.
 * @param href The link's href.
 * @param base The page's URL, for a relative href.
 * @returns What the link names, or null for any other link.
 */
export function parseCommentLink(href: string, base: string): CommentLink | null {
  const url = new URL(href, base);
  const fragment = /^#r(\d+)$/u.exec(url.hash);
  const tab = /\/pull\/\d+\/(?:changes|files)(\/[\da-f]{7,40})?\/?$/u.exec(url.pathname);
  if (!fragment?.[1] || !tab) return null;
  const id = Number(fragment[1]);
  if (!Number.isSafeInteger(id)) return null;
  return { kind: tab[1] ? "thread" : "comment", id };
}

/**
 * Reads a review thread's number out of its GraphQL id, which GitHub links an outdated comment by. The id is
 * `PRRT_` and the base64url of a MessagePack array that ends in the number.
 * @param nodeId The thread's GraphQL id, like `PRRT_kwDOVHGhw86uyVQ3`.
 * @returns The thread's number, or null for an id of another shape.
 */
export function threadNumber(nodeId: string): number | null {
  const match = /^PRRT_([\w-]+)$/u.exec(nodeId);
  if (!match?.[1]) return null;
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(match[1].replaceAll("-", "+").replaceAll("_", "/")), (char) => char.codePointAt(0) ?? 0);
  } catch {
    return null;
  }
  // A fixarray's marker is 0x90 plus its length; each entry is a positive fixint or a uint of 1, 2, 4 or 8 bytes.
  const [head] = bytes;
  if (head === undefined || head < 0x90 || head > 0x9F) return null;
  const sizes: Record<number, number> = { 0xCC: 1, 0xCD: 2, 0xCE: 4, 0xCF: 8 };
  let at = 1;
  let last: number | null = null;
  for (let index = 0; index < head - 0x90; index++) {
    const marker = bytes[at];
    if (marker === undefined) return null;
    const size = marker <= 0x7F ? 0 : sizes[marker];
    if (size === undefined || at + size >= bytes.length) return null;
    last = size === 0 ? marker : bytes.slice(at + 1, at + 1 + size).reduce((value, byte) => value * 256 + byte, 0);
    at += 1 + size;
  }
  return last !== null && Number.isSafeInteger(last) ? last : null;
}

/**
 * The versions to work out a comment's choices from: the stored ones answer at once, but only while they still know
 * the comment's commit as an older version. A stored history from before the author pushed again still calls the
 * comment's version the head, which would leave nothing to show since.
 * @param stored The versions stored on an earlier visit, if any.
 * @param commit The commit the comment was written on.
 * @returns Whether the stored versions will do.
 */
export function storedVersionsWillDo(stored: VersionHistory | null, commit: string): stored is VersionHistory {
  const version = stored?.versions.find((each) => each.oid === commit);
  return version !== undefined && !version.current;
}
