type Mark = " " | "-" | "+";

export interface DiffLine {
  mark: Mark;
  text: string;
}

interface Hunk {
  lines: DiffLine[];
}

/** A file in one version of a pull request, as GitHub's compare API lists it. */
export interface VersionFile {
  filename: string;
  previousFilename?: string;
  status: string;
  /** Missing for binary files and diffs too large for GitHub to show; empty for pure renames and empty files. */
  patch?: string;
  sha: string;
}

/**
 * - `changed`: both versions touch the file, differently.
 * - `unchanged`: both versions make the same change.
 * - `added`: only the newer version touches the file.
 * - `dropped`: only the older version touched the file.
 * - `opaque`: GitHub shows no diff for at least one side, and the file's content differs between the versions, which
 *   may only be because the base changed it, so the change can't be compared.
 */
export type FileChange = "changed" | "unchanged" | "added" | "dropped" | "opaque";

export interface FileInterdiff {
  path: string;
  /** The file's path in the older version, when it differs. */
  oldPath: string | null;
  change: FileChange;
  /** Each line is a line of the pull request's patch, marked by how it changed between the versions. */
  hunks: Hunk[];
  added: number;
  removed: number;
}

const CONTEXT = 3;
const MAX_EDITS = 2000;
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@ ?/u;

/**
 * Compares the changes two versions of a pull request make, file by file: a diff of their diffs, like
 * `git range-diff` shows for each commit.
 * @param before The files the older version changes against its base.
 * @param after The files the newer version changes against its base.
 * @returns One entry per file either version touches, in path order.
 */
export function interdiff(before: VersionFile[], after: VersionFile[]): FileInterdiff[] {
  return pairFiles(before, after)
    .map(([old, current]) => compareFile(old, current))
    .toSorted((a, b) => (a.path < b.path ? -1 : (a.path > b.path ? 1 : 0)));
}

/**
 * Pairs each file of one version with the same file in the other: by path, or else through a rename.
 * @param before The older version's files.
 * @param after The newer version's files.
 * @returns The pairs, with null for a file only one version touches.
 */
export function pairFiles(before: VersionFile[], after: VersionFile[]): [VersionFile | null, VersionFile | null][] {
  const unmatched = new Map(before.map((file) => [file.filename, file]));
  const pairs: [VersionFile | null, VersionFile | null][] = [];
  const later: VersionFile[] = [];
  for (const file of after) {
    const old = unmatched.get(file.filename);
    if (old) {
      unmatched.delete(file.filename);
      pairs.push([old, file]);
    } else {
      later.push(file);
    }
  }
  for (const file of later) {
    const old = [...unmatched.values()].find((candidate) => sameOrigin(candidate, file)) ?? null;
    if (old) unmatched.delete(old.filename);
    pairs.push([old, file]);
  }
  for (const old of unmatched.values()) pairs.push([old, null]);
  return pairs;
}

function sameOrigin(old: VersionFile, current: VersionFile): boolean {
  const origin = current.previousFilename ?? current.filename;
  return (old.previousFilename ?? old.filename) === origin || old.filename === origin || current.filename === old.previousFilename;
}

/**
 * @param old The file in the older version, or null when only the newer one touches it.
 * @param current The file in the newer version, or null when only the older one touched it.
 * @returns How the file's change differs between the versions.
 */
export function compareFile(old: VersionFile | null, current: VersionFile | null): FileInterdiff {
  const file = current ?? old;
  if (!file) throw new Error("compareFile needs a file from at least one version");
  const path = file.filename;
  const oldPath = old && current && old.filename !== current.filename ? old.filename : null;
  const result = (change: FileChange, lines: DiffLine[] = []): FileInterdiff => ({
    path,
    oldPath,
    change,
    hunks: toHunks(lines),
    added: lines.filter((line) => line.mark === "+").length,
    removed: lines.filter((line) => line.mark === "-").length,
  });

  if (!old || !current) {
    const mark: Mark = old ? "-" : "+";
    return result(old ? "dropped" : "added", file.patch === undefined ? [] : patchLines(file).map((text) => ({ mark, text })));
  }
  if (old.patch === undefined || current.patch === undefined) {
    const same = old.patch === current.patch && old.sha === current.sha && old.status === current.status;
    return result(same ? "unchanged" : "opaque");
  }
  const lines = diffLines(patchLines(old), patchLines(current));
  return result(lines.some((line) => line.mark !== " ") ? "changed" : "unchanged", lines);
}

/**
 * Turns a file's patch into lines that compare across rebases: hunk headers keep their function context but lose
 * their line numbers, which shift whenever the base changes. A rename, an added or a deleted file gets a header line.
 * @param file The file.
 * @returns The patch's lines.
 */
export function patchLines(file: VersionFile): string[] {
  return [...patchHeader(file), ...patchBody(file).map((line) => normalizeLine(line))];
}

/**
 * @param file The file.
 * @returns The header lines {@link patchLines} starts with: a rename, or that the file is new or deleted.
 */
export function patchHeader(file: VersionFile): string[] {
  if (file.status === "renamed" && file.previousFilename) return [`rename from ${file.previousFilename}`, `rename to ${file.filename}`];
  if (file.status === "added") return ["new file"];
  if (file.status === "removed") return ["deleted file"];
  return [];
}

/**
 * @param file The file.
 * @returns The patch's raw lines, without the empty line a trailing newline leaves.
 */
export function patchBody(file: VersionFile): string[] {
  return (file.patch ?? "").split("\n").filter((line, index, lines) => line !== "" || index < lines.length - 1);
}

function normalizeLine(line: string): string {
  const clean = line.replace(/\r$/u, "");
  return HUNK_HEADER.test(clean) ? clean.replace(HUNK_HEADER, "@@ ").trimEnd() : clean;
}

/**
 * A line diff with Myers' algorithm. Past {@link MAX_EDITS} edits it gives up on a minimal diff and replaces the
 * differing middle wholesale.
 * @param a The old lines.
 * @param b The new lines.
 * @returns Every line of both, marked as kept, removed or added.
 */
export function diffLines(a: string[], b: string[]): DiffLine[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const keep = (lines: string[]) => lines.map((text): DiffLine => ({ mark: " ", text }));
  const middle = myers(a.slice(start, endA), b.slice(start, endB)) ?? [
    ...a.slice(start, endA).map((text): DiffLine => ({ mark: "-", text })),
    ...b.slice(start, endB).map((text): DiffLine => ({ mark: "+", text })),
  ];
  return [...keep(a.slice(0, start)), ...middle, ...keep(a.slice(endA))];
}

// Index arithmetic within bounds the loops check; `?? 0` on every read would hide a real off-by-one.
/* oxlint-disable typescript/no-non-null-assertion */
function myers(a: string[], b: string[]): DiffLine[] | null {
  const n = a.length;
  const m = b.length;
  const limit = Math.min(n + m, MAX_EDITS);
  const offset = limit + 1;
  const v = new Int32Array(2 * limit + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= limit; d++) {
    trace.push(v.slice(offset - d, offset + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(a, b, trace, d);
    }
  }
  return null;
}

function backtrack(a: string[], b: string[], trace: Int32Array[], edits: number): DiffLine[] {
  const lines: DiffLine[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = edits; d > 0; d--) {
    const v = trace[d]!;
    const at = (k: number) => v[k + d]!;
    const k = x - y;
    const previous = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const previousX = at(previous);
    const previousY = previousX - previous;
    while (x > previousX && y > previousY) {
      x--;
      y--;
      lines.push({ mark: " ", text: a[x]! });
    }
    if (previous === k + 1) lines.push({ mark: "+", text: b[--y]! });
    else lines.push({ mark: "-", text: a[--x]! });
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    lines.push({ mark: " ", text: a[x]! });
  }
  return lines.toReversed();
}

function toHunks(lines: DiffLine[]): Hunk[] {
  const hunks: Hunk[] = [];
  const changed = lines.flatMap((line, index) => (line.mark === " " ? [] : index));
  let index = 0;
  while (index < changed.length) {
    const first = changed[index]!;
    let last = first;
    while (index + 1 < changed.length && changed[index + 1]! - last <= 2 * CONTEXT + 1) last = changed[++index]!;
    index++;
    hunks.push({ lines: lines.slice(Math.max(0, first - CONTEXT), Math.min(lines.length, last + CONTEXT + 1)) });
  }
  return hunks;
}
/* oxlint-enable typescript/no-non-null-assertion */
