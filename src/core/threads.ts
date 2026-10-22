import { type FileInterdiff, type InterdiffLine, splitLine } from "./interdiff";

/** A comment in a review thread. */
export interface ThreadComment {
  id: number;
  author: string | null;
  avatarUrl: string | null;
  /** GitHub's rendering of the comment, to rebuild with `renderRichText`. */
  html: string;
  createdAt: string;
  url: string;
  /** Whether the comment is a draft in the viewer's pending review, which only the viewer sees. */
  pending: boolean;
  /** How the author is related to the repository, as GitHub labels it: OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR, … */
  association: string | null;
  /** The commit the comment was written on. */
  originalCommit: string | null;
}

/** A review thread on a pull request's diff, as GitHub's API describes it. */
export interface ReviewThread {
  /** The thread's GraphQL id. */
  id: string;
  path: string;
  resolved: boolean;
  outdated: boolean;
  /** The lines in the current diff, or null when the thread is outdated. */
  line: number | null;
  startLine: number | null;
  /** The lines in the diff of the commit the thread was started on. */
  originalLine: number | null;
  originalStartLine: number | null;
  side: "LEFT" | "RIGHT";
  /** Who resolved the thread, while it's resolved. */
  resolvedBy: string | null;
  comments: ThreadComment[];
}

/** The versions on screen, by commit. */
export interface Compared {
  /** The older version, or null when the newer one shows against the base branch. */
  older: string | null;
  newer: string;
  /** Whether the newer version is the pull request's head, where a thread's current lines apply. */
  newerIsHead: boolean;
}

/** Where a thread goes in a file's diff: under its last line, with its first line for a thread on several. */
export interface Placement {
  thread: ReviewThread;
  first: number;
  last: number;
  /**
   * The version whose lines the thread is on, which a side-by-side diff shows as its left (older) or right (newer)
   * column. In a version against the base branch that is GitHub's own side: L the base, R the head.
   */
  column: "older" | "newer";
}

/** Which version's numbers a row carries for a side, or null when the row isn't in that version. */
type Numbering = (line: InterdiffLine, side: "LEFT" | "RIGHT") => number | null;

/** A row of the newer version: in a plain diff every row, else a kept or newly added one, numbered as it has it. */
const newerRows =
  (plain: boolean): Numbering =>
  (line, side) =>
    plain || line.mark !== "-" ? (side === "LEFT" ? line.left : line.right) : null;

/** A row of the older version: a kept or since removed one, numbered as the older version had it. */
const olderRows: Numbering = (line, side) => {
  if (line.mark === "+") return null;
  return (side === "LEFT" ? line.origin?.left : line.origin?.right) ?? null;
};

/**
 * Places a file's review threads in its diff. A thread names its lines as the commit it was started on numbers them,
 * so it goes where that version's lines are on screen: on the newer version's rows, on the older version's, or, when
 * the newer version is the head and the thread isn't outdated, at its current lines. A thread placed by an earlier
 * rule isn't placed again.
 * @param file The file's diff on screen.
 * @param threads The pull request's threads.
 * @param compared The versions on screen.
 * @returns The threads placed in the file, and the file's threads that have no line on screen.
 */
export function placeThreads(
  file: FileInterdiff,
  threads: ReviewThread[],
  compared: Compared,
): { placed: Placement[]; elsewhere: ReviewThread[] } {
  const placed: Placement[] = [];
  const elsewhere: ReviewThread[] = [];
  for (const thread of threads) {
    const placement = placeThread(file, thread, compared);
    if (placement) placed.push(placement);
    else if (thread.path === file.path || thread.path === file.oldPath) elsewhere.push(thread);
  }
  return { placed, elsewhere };
}

/**
 * @param file The file's diff on screen.
 * @param thread One of the pull request's threads.
 * @param compared The versions on screen.
 * @returns Where the thread goes in the file, by the first rule that finds its line, or null.
 */
function placeThread(file: FileInterdiff, thread: ReviewThread, compared: Compared): Placement | null {
  const plain = compared.older === null;
  const started = thread.comments[0]?.originalCommit ?? null;
  const named = (path: string) => thread.path === path;
  // In a plain diff both sides are the version's: the base's lines on the left, its own on the right.
  const newer = plain && thread.side === "LEFT" ? "older" : "newer";
  const rules: { applies: boolean; numbering: Numbering; line: number | null; startLine: number | null; column: Placement["column"] }[] = [
    {
      applies: started === compared.newer && named(file.path),
      numbering: newerRows(plain),
      line: thread.originalLine,
      startLine: thread.originalStartLine,
      column: newer,
    },
    {
      applies: !plain && started === compared.older && named(file.oldPath ?? file.path),
      numbering: olderRows,
      line: thread.originalLine,
      startLine: thread.originalStartLine,
      column: "older",
    },
    {
      applies: compared.newerIsHead && !thread.outdated && named(file.path),
      numbering: newerRows(plain),
      line: thread.line,
      startLine: thread.startLine,
      column: newer,
    },
  ];
  for (const rule of rules) {
    if (!rule.applies || rule.line === null) continue;
    const at = (number: number) => file.lines.findIndex((line) => rule.numbering(line, thread.side) === number);
    const last = at(rule.line);
    if (last < 0) continue;
    const first = rule.startLine === null ? last : at(rule.startLine);
    return { thread, first: first < 0 || first > last ? last : first, last, column: rule.column };
  }
  return null;
}

/** The lines a new review comment is on, as GitHub's API takes them. */
export interface NewCommentLines {
  line: number;
  side: "LEFT" | "RIGHT";
  startLine?: number;
  startSide?: "LEFT" | "RIGHT";
}

/**
 * @param line A row of the diff on screen.
 * @param plain Whether the diff is a version against the base branch, where every row is the version's.
 * @returns The side and number a new comment on the row names, or null for a row GitHub's current diff doesn't have:
 * a hunk header, a "no newline" note, or a line only the older version has.
 */
export function commentableLine(line: InterdiffLine, plain: boolean): { side: "LEFT" | "RIGHT"; line: number } | null {
  const { kind } = splitLine(line.display);
  // Only a row GitHub's diff of the head shows can take a comment.
  const inHead = line.newerIndex === undefined ? plain || line.mark !== "-" : line.newerIndex !== null;
  if (kind === "hunk" || kind === "\\" || !inHead) return null;
  const number = kind === "-" ? line.left : line.right;
  return number === null ? null : { side: kind === "-" ? "LEFT" : "RIGHT", line: number };
}

/**
 * @param lines A file's rows on screen.
 * @param from One end of the rows the comment is on.
 * @param to The other end.
 * @param plain Whether the diff is a version against the base branch.
 * @returns The lines to comment on, or null when an end can't take a comment or the rows span more than one hunk,
 * which GitHub rejects.
 */
export function commentRange(lines: InterdiffLine[], from: number, to: number, plain: boolean): NewCommentLines | null {
  const [first, last] = from <= to ? [from, to] : [to, from];
  const start = lines[first];
  const end = lines[last];
  const startAt = start && commentableLine(start, plain);
  const endAt = end && commentableLine(end, plain);
  // GitHub takes a range only within one hunk.
  const acrossHunks = lines.slice(first, last + 1).some((line) => splitLine(line.display).kind === "hunk");
  if (!startAt || !endAt || acrossHunks) return null;
  if (first === last) return endAt;
  return { ...endAt, startLine: startAt.line, startSide: startAt.side };
}

/** How a new comment can be posted: on its own or starting a review, into the pending review, or not here at all. */
export type PostingMode = "fresh" | "review" | "blocked";

/**
 * Mirrors GitHub's own choice: without a pending review a comment goes out on its own or starts one; with one, it
 * joins it. A pending review on an older commit would pin the comment's lines to that commit, so it has to be
 * submitted first.
 * @param pending The viewer's pending review, if any.
 * @param head The pull request's head commit.
 * @returns How a new comment can be posted.
 */
export function postingMode(pending: { commit: string } | null, head: string): PostingMode {
  if (!pending) return "fresh";
  return pending.commit === head ? "review" : "blocked";
}

/** The review threads, and what posting to them needs: the pull request's id and the viewer's pending review. */
export interface ReviewDiscussion {
  threads: ReviewThread[];
  /** The pull request's GraphQL id. */
  pullRequestId: string;
  /** The pull request's head commit now, which a new comment's lines have to be on. */
  head: string;
  /** The pull request's author, whose comments GitHub labels Author. */
  author: string | null;
  /** The viewer's pending review, which only the viewer sees, and the commit it was started on. */
  pending: { id: string; commit: string } | null;
}

/** Something the viewer does to the review from the versions view. */
export type ReviewAction =
  | ({ kind: "comment"; mode: "single" | "review"; head: string; path: string; body: string } & NewCommentLines)
  | { kind: "reply"; threadId: string; commentId: number; body: string }
  | { kind: "resolve"; threadId: string; resolved: boolean };
