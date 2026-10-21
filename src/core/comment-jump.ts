import { BASE, commentVersion, type SavedRange, type Version } from "./versions";

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
