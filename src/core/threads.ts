import type { FileInterdiff, InterdiffLine } from "./interdiff";

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
  const rules: { applies: boolean; numbering: Numbering; line: number | null; startLine: number | null }[] = [
    { applies: started === compared.newer && named(file.path), numbering: newerRows(plain), line: thread.originalLine, startLine: thread.originalStartLine },
    {
      applies: !plain && started === compared.older && named(file.oldPath ?? file.path),
      numbering: olderRows,
      line: thread.originalLine,
      startLine: thread.originalStartLine,
    },
    { applies: compared.newerIsHead && !thread.outdated && named(file.path), numbering: newerRows(plain), line: thread.line, startLine: thread.startLine },
  ];
  for (const rule of rules) {
    if (!rule.applies || rule.line === null) continue;
    const at = (number: number) => file.lines.findIndex((line) => rule.numbering(line, thread.side) === number);
    const last = at(rule.line);
    if (last < 0) continue;
    const first = rule.startLine === null ? last : at(rule.startLine);
    return { thread, first: first < 0 || first > last ? last : first, last };
  }
  return null;
}
