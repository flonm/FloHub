import type { FileInterdiff } from "./interdiff";
import { placeThreads, type ReviewThread } from "./threads";
import type { TurnThread } from "./turn";

/**
 * Whether the pull request's author has addressed an open thread yet:
 * - `changed`: the lines it comments on changed since its first comment was written.
 * - `untouched`: they didn't, and the author hasn't answered.
 * - `replied`: they didn't, but the author answered after the comment.
 */
export type ThreadProgress = "changed" | "untouched" | "replied";

/** What tells whether a thread's lines changed: the head, and where the versions view has them, diffs to it. */
export interface ProgressBasis {
  /** The pull request's head commit. */
  head: string;
  /**
   * Each version's diff to the head, file by file, by the version's commit: what `interdiff` gives for the version's
   * patch and the head's. A thread started on a version that has none falls back on GitHub's `outdated` flag.
   */
  sinceVersion?: ReadonlyMap<string, readonly FileInterdiff[]>;
}

/**
 * Tells whether the pull request's author has addressed a thread: changed the lines it comments on since its first
 * comment, or answered it. The lines count as changed when the diff from the comment's version to the head shows a
 * difference on them, or a line put between them. Without that diff, or when the diff doesn't show the lines, GitHub's
 * `outdated` flag decides: an outdated thread's line no longer stands as it was.
 * @param thread A review thread.
 * @param author The pull request's author.
 * @param basis The head, and the diffs from earlier versions to it.
 * @returns The thread's progress, or null for one there's nothing to address on: resolved, only drafts so far, or
 * started by the author.
 */
export function threadProgress(thread: ReviewThread, author: string | null, basis: ProgressBasis): ThreadProgress | null {
  // A draft comment is only the viewer's so far: the author can't have seen it.
  const [first, ...replies] = thread.comments.filter((comment) => !comment.pending);
  if (thread.resolved || !first || (author !== null && first.author === author)) return null;
  const answered = author !== null && replies.some((reply) => reply.author === author);
  const untouched = answered ? "replied" : "untouched";
  const started = first.originalCommit;
  // Written on the head, the lines can't have changed since.
  if (started === basis.head) return untouched;
  const changed = started === null ? null : changedSince(thread, started, basis);
  return (changed ?? thread.outdated) ? "changed" : untouched;
}

/**
 * @param thread A review thread.
 * @param started The commit its first comment was written on.
 * @param basis The head, and the diffs from earlier versions to it.
 * @returns Whether the thread's lines differ between the version and the head, or null when the diff can't say: there
 * is none for the version, or it doesn't show the lines, as for a file GitHub shows no diff of.
 */
function changedSince(thread: ReviewThread, started: string, basis: ProgressBasis): boolean | null {
  const compared = { older: started, newer: basis.head, newerIsHead: false };
  const files = basis.sinceVersion?.get(started) ?? [];
  for (const file of files) {
    // Placed on the version's rows, by the numbers the comment names, as the versions view draws it.
    const [placement] = placeThreads(file, [thread], compared).placed;
    if (placement) return file.lines.slice(placement.first, placement.last + 1).some((line) => line.effect !== " ");
  }
  return null;
}

/** How many of a pull request's open threads are in each state of progress. */
export type ProgressCounts = Record<ThreadProgress, number>;

/**
 * @param threads The pull request's review threads.
 * @param author The pull request's author.
 * @param basis The head, and the diffs from earlier versions to it.
 * @returns How many threads are in each state; resolved ones and those with nothing to address count in none.
 */
export function progressCounts(threads: readonly ReviewThread[], author: string | null, basis: ProgressBasis): ProgressCounts {
  const counts: ProgressCounts = { changed: 0, untouched: 0, replied: 0 };
  for (const each of threads) {
    const progress = threadProgress(each, author, basis);
    if (progress) counts[progress]++;
  }
  return counts;
}

/**
 * @param progress A thread's progress.
 * @param yours Whether the viewer started the thread.
 * @returns How the thread's badge reads.
 */
export function progressLabel(progress: ThreadProgress, yours: boolean): string {
  const comment = yours ? "your comment" : "the comment";
  switch (progress) {
    case "changed": {
      return `Code changed since ${comment}`;
    }
    case "untouched": {
      return `Untouched since ${comment}`;
    }
    case "replied": {
      return "Replied, code untouched";
    }
  }
}

/**
 * Tells a thread's progress from what the bar's overview has, without any diff: GitHub's outdated flag says whether
 * its line changed, and the last few speakers whether the author answered.
 * @param thread A thread as the turn reads it.
 * @param author The pull request's author.
 * @returns The thread's progress, or null for one there's nothing to address on, as {@link threadProgress} has it.
 */
export function roughProgress(thread: TurnThread, author: string | null): ThreadProgress | null {
  if (thread.resolved || thread.starter === null || thread.starter === author) return null;
  if (thread.outdated === true) return "changed";
  const speakers = thread.recentSpeakers ?? [thread.lastSpeaker];
  return author !== null && speakers.includes(author) ? "replied" : "untouched";
}
