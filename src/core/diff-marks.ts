import { compareFile, type FileChange, type InterdiffOptions, lineNumbers, pairFiles, patchBody, patchHeader, type VersionFile } from "./interdiff";

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

/**
 * Works out what to highlight in GitHub's own diff of the current version: which of its lines changed since an older
 * version, and where lines of the older version's patch went missing.
 * @param before The older version's files.
 * @param after The current version's files; its patches must be the ones GitHub shows.
 * @param options Whether both versions' patches are against the same base.
 * @returns The marks per file, for every file either version touches.
 */
export function markChanges(before: VersionFile[], after: VersionFile[], options: InterdiffOptions = {}): FileMarks[] {
  return pairFiles(before, after).map(([old, current]) => {
    const { path, change, lines } = compareFile(old, current, options);
    const marks: FileMarks = { path, change, changed: [], removed: [] };
    if (current?.patch === undefined || change === "unchanged" || change === "opaque") return marks;

    const positions = patchPositions(current);
    if (old?.patch === undefined) {
      marks.changed = positions.filter((position) => position !== null);
      return marks;
    }

    // The versions view's rows, each with its row of the current patch, when GitHub's diff shows it. A row is a change
    // when it changes the code between the versions, so lines only one patch shows as context are none; a line only
    // the older code has, which GitHub's diff doesn't show, is listed after the line it followed.
    const header = patchHeader(current).length;
    let previous: LineRef | null = null;
    let removed: RemovedLines | null = null;
    for (const line of lines) {
      const position = line.newerIndex === null || line.newerIndex === undefined ? null : (positions[header + line.newerIndex] ?? null);
      if (!position) {
        if (line.effect !== "-") continue;
        if (!removed) marks.removed.push((removed = { after: previous, lines: [] }));
        removed.lines.push(line.text);
        continue;
      }
      removed = null;
      if (line.effect !== " ") marks.changed.push(position);
      previous = position;
    }
    return marks;
  });
}

/**
 * @param file A file of the current version.
 * @returns For each of {@link patchLines}' lines, the diff line GitHub shows for it, or null for headers.
 */
export function patchPositions(file: VersionFile): (LineRef | null)[] {
  const body = lineNumbers(patchBody(file)).map(({ left, right }): LineRef | null => {
    if (right !== null) return { side: "R", line: right };
    return left === null ? null : { side: "L", line: left };
  });
  return [...patchHeader(file).map(() => null), ...body];
}
