import { compareFile, diffLines, type FileChange, pairFiles, patchBody, patchHeader, patchLines, type VersionFile } from "./interdiff";

/** A line of GitHub's diff, the way its line anchors name it: `L` for the base side, `R` for the head side. */
export interface LineRef {
  side: "L" | "R";
  line: number;
}

/** Lines of the older version's patch that the current one no longer has, shown after a line of the current diff. */
export interface RemovedLines {
  /** The current diff's line they used to follow, or null when they came before its first line. */
  after: LineRef | null;
  lines: string[];
}

export interface FileMarks {
  path: string;
  change: FileChange;
  /** Lines of the current diff that are new or different since the older version. */
  changed: LineRef[];
  removed: RemovedLines[];
}

const HUNK_NUMBERS = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Works out what to highlight in GitHub's own diff of the current version: which of its lines changed since an older
 * version, and where lines of the older version's patch went missing.
 * @param before The older version's files.
 * @param after The current version's files; its patches must be the ones GitHub shows.
 * @returns The marks per file, for every file either version touches.
 */
export function markChanges(before: VersionFile[], after: VersionFile[]): FileMarks[] {
  return pairFiles(before, after).map(([old, current]) => {
    const { path, change } = compareFile(old, current);
    const marks: FileMarks = { path, change, changed: [], removed: [] };
    if (!current || current.patch === undefined || change === "unchanged" || change === "opaque") return marks;

    const positions = patchPositions(current);
    if (!old || old.patch === undefined) {
      marks.changed = positions.filter((position) => position !== null);
      return marks;
    }

    let index = 0;
    let previous: LineRef | null = null;
    let removed: RemovedLines | null = null;
    for (const line of diffLines(patchLines(old), patchLines(current))) {
      if (line.mark === "-") {
        if (!removed) marks.removed.push((removed = { after: previous, lines: [] }));
        removed.lines.push(line.text);
        continue;
      }
      removed = null;
      const position = positions[index++] ?? null;
      if (line.mark === "+" && position) marks.changed.push(position);
      if (position) previous = position;
    }
    return marks;
  });
}

/**
 * @param file A file of the current version.
 * @returns For each of {@link patchLines}' lines, the diff line GitHub shows for it, or null for headers.
 */
export function patchPositions(file: VersionFile): (LineRef | null)[] {
  let left = 0;
  let right = 0;
  const body = patchBody(file).map((line): LineRef | null => {
    const hunk = HUNK_NUMBERS.exec(line);
    if (hunk) {
      left = Number(hunk[1]);
      right = Number(hunk[2]);
      return null;
    }
    if (line.startsWith("+")) return { side: "R", line: right++ };
    if (line.startsWith("-")) return { side: "L", line: left++ };
    if (line.startsWith("\\")) return null;
    left++;
    return { side: "R", line: right++ };
  });
  return [...patchHeader(file).map(() => null), ...body];
}
