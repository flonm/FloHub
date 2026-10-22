type Mark = " " | "-" | "+";

export interface DiffLine {
  mark: Mark;
  text: string;
}

/** A run of text in a line, and whether it differs from the line it pairs with in the other version. */
export interface Segment {
  text: string;
  changed: boolean;
}

/**
 * A line of the pull request's patch. Its mark says which version's patch it comes from: the older one's only, the
 * newer one's only, or both.
 */
export interface InterdiffLine extends DiffLine {
  /**
   * What the difference between the versions does to the code, as GitHub's diff of one version against the other
   * shows it: + the newer version's code has the line and the older one's doesn't, − the reverse, blank both have it.
   * The older version's patch adding a line means it's gone from the newer code; the older patch removing a base line
   * the newer one keeps means it's back.
   */
  effect: Mark;
  /** The line as the version it comes from has it: hunk headers keep their line numbers. */
  display: string;
  /** The line's number in the base side of the file, as GitHub's diff numbers it; null where it has none. */
  left: number | null;
  /** The line's number in the head side of the file; null where it has none. */
  right: number | null;
  /** For a line that replaced, or was replaced by, a similar one: its code split by what differs from the other. */
  segments?: Segment[];
  /**
   * The line's numbers in the older version's diff, where it has the line: a kept line shows the newer version's
   * numbers, but a comment on the older version names the older ones.
   */
  origin?: { left: number | null; right: number | null };
}

/** A run of changed lines with their context, as a slice of the file's lines. */
interface Hunk {
  /** Where the hunk starts in the file's lines. */
  start: number;
  lines: InterdiffLine[];
}

/** What a line of a patch is: a kept, added or removed line, the no-newline note, or a hunk header. */
export type LineKind = " " | "+" | "-" | "\\" | "hunk";

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
  /** The lines that say the file is new, deleted or renamed, marked by how they changed between the versions. */
  header: DiffLine[];
  /** Every line of the patch, of either version, marked by how it changed between the versions. */
  lines: InterdiffLine[];
  /** The changed lines with their context. */
  hunks: Hunk[];
  added: number;
  removed: number;
  /** GitHub shows no diff for the file in a version that touches it (binary, or too large). */
  diffless: boolean;
  /** The file's status in each version, like "modified" or "added"; null for a version that doesn't touch it. */
  status: { before: string | null; after: string | null };
}

const CONTEXT = 3;
const MAX_EDITS = 2000;
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@ ?/u;
const MARKERS: Record<string, LineKind> = { " ": " ", "+": "+", "-": "-", "\\": "\\" };
const HUNK_NUMBERS = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u;
/** Below this share of unchanged text, two lines are too different for word highlights to help. */
const MIN_WORD_OVERLAP = 0.5;
/** How many added lines a removed line looks ahead for its most similar replacement. */
const PAIR_WINDOW = 8;

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
 * @param mark Which version's patch the line comes from: − the older one's only, + the newer one's only.
 * @param kind What the pull request does to the line.
 * @returns What that does to the code between the versions: a line only one patch adds is in only that version's
 * code, and a base line only one patch removes is in only the other version's.
 */
function effectOf(mark: Mark, kind: LineKind): Mark {
  if (mark === " " || (kind !== "+" && kind !== "-")) return " ";
  if (kind === "+") return mark;
  return mark === "+" ? "-" : "+";
}

/**
 * One version's own changes against its base, as a plain diff: each line is marked by what the pull request does to
 * it, as GitHub's Files changed tab shows the version.
 * @param files The files the version changes against its base.
 * @returns One entry per file, in path order.
 */
export function versionDiff(files: VersionFile[]): FileInterdiff[] {
  return files
    .map((file) => {
      const plain = compareFile(null, file);
      // The lines are this call's own copies, so marking them in place is safe.
      const lines = plain.lines.map((line) => {
        const { kind } = splitLine(line.display);
        const mark: Mark = kind === "+" || kind === "-" ? kind : " ";
        return Object.assign(line, { mark, effect: mark, origin: { left: line.left, right: line.right } });
      });
      const changed = lines.filter((line) => line.effect !== " ");
      return {
        ...plain,
        change: file.status === "added" || file.status === "removed" ? ("added" as const) : ("changed" as const),
        header: plain.header.map((line) => Object.assign(line, { mark: " " as const })),
        lines,
        // The patch is GitHub's diff of the version, context and all, so none of it folds away.
        hunks: lines.length > 0 ? [{ start: 0, lines }] : [],
        added: changed.filter((line) => line.effect === "+").length,
        removed: changed.filter((line) => line.effect === "-").length,
      };
    })
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
  const header = diffLines(old ? patchHeader(old) : [], current ? patchHeader(current) : []);
  const result = (change: FileChange, lines: InterdiffLine[] = []): FileInterdiff => {
    const marked = [...header.map((line) => line.mark), ...lines.map((line) => line.effect)].filter((effect) => effect !== " ");
    return {
      path: file.filename,
      oldPath: old && current && old.filename !== current.filename ? old.filename : null,
      change,
      header,
      lines,
      hunks: toHunks(lines),
      added: marked.filter((effect) => effect === "+").length,
      removed: marked.filter((effect) => effect === "-").length,
      diffless: [old, current].some((side) => side !== null && side.patch === undefined),
      status: { before: old?.status ?? null, after: current?.status ?? null },
    };
  };

  if (!old || !current) {
    const mark: Mark = old ? "-" : "+";
    return result(
      old ? "dropped" : "added",
      patchRows(patchBody(file)).map((row) => Object.assign(row, { mark, effect: effectOf(mark, splitLine(row.display).kind) })),
    );
  }
  if (old.patch === undefined || current.patch === undefined) {
    const same = old.patch === current.patch && old.sha === current.sha && old.status === current.status;
    return result(same ? "unchanged" : "opaque");
  }
  const lines = interdiffLines(patchBody(old), patchBody(current));
  const changed = header.some((line) => line.mark !== " ") || lines.some((line) => line.effect !== " ");
  return result(changed ? "changed" : "unchanged", lines);
}

/**
 * Diffs two versions' patch lines, numbered as each version's diff numbers them, with word highlights where a line
 * replaced a similar one.
 * @param before The older version's raw patch lines.
 * @param after The newer version's raw patch lines.
 * @returns Every line of both, marked as kept, removed or added.
 */
function interdiffLines(before: string[], after: string[]): InterdiffLine[] {
  const oldRows = patchRows(before);
  const newRows = patchRows(after);
  let x = 0;
  let y = 0;
  // A base line is the same line whether a patch keeps it as context or removes it, so they're compared alike: one
  // patch removing it and the other keeping it is then one row, the line being in only one version's code.
  const diff = diffLines(
    oldRows.map((row) => baseLineKey(row.text)),
    newRows.map((row) => baseLineKey(row.text)),
  );
  // Each row with the hunk it's in, in each patch that has it, to tell whether the other patch covers its place.
  let oldHunk = 0;
  let newHunk = 0;
  const entries = diff.map(({ mark }) => {
    const old = mark === "+" ? undefined : oldRows[x++];
    const current = mark === "-" ? undefined : newRows[y++];
    if (old && splitLine(old.display).kind === "hunk") oldHunk++;
    if (current && splitLine(current.display).kind === "hunk") newHunk++;
    return { mark, old, current, oldHunk: old ? oldHunk : null, newHunk: current ? newHunk : null };
  });
  /**
   * Whether the other version's patch shows the place of a row only one patch has: its rows just before and after
   * are in one hunk. A base line it shows there would be in it, as context or removed.
   */
  const covered = (index: number, side: "oldHunk" | "newHunk") => {
    const prior = entries.slice(0, index).findLast((entry) => entry[side] !== null);
    const next = entries.slice(index + 1).find((entry) => entry[side] !== null);
    return prior !== undefined && prior[side] === next?.[side];
  };
  const lines: InterdiffLine[] = [];
  for (const [index, { mark, old, current }] of entries.entries()) {
    // A kept line shows as the newer version has it.
    const row = current ?? old;
    if (!row) continue;
    const { kind } = splitLine(row.display);
    if (mark === " " && old) {
      const was = splitLine(old.display).kind;
      lines.push(Object.assign(row, { mark, effect: matchedEffect(was, kind), origin: { left: old.left, right: old.right } }));
      continue;
    }
    // Which lines a patch shows around its changes, and where its hunks start, depends on where its changes are:
    // a context line or hunk header only one patch shows is no change in what the pull request does. The older
    // patch's are left out, so the rows keep the newer version's numbering; the newer patch's stay as context.
    if (kind === " " || kind === "hunk") {
      if (mark === "+") lines.push(Object.assign(row, { mark: " " as const, effect: " " as const }));
      continue;
    }
    // A base line only one patch removes is in the other version's code, unless that version's patch shows the
    // place without it: then its base lacks the line too, and the line is in neither version's code.
    const absentFromOtherBase = kind === "-" && covered(index, mark === "-" ? "newHunk" : "oldHunk");
    if (absentFromOtherBase && mark === "-") continue;
    const effect = absentFromOtherBase ? " " : effectOf(mark, kind);
    lines.push(Object.assign(row, { mark, effect }, old && { origin: { left: old.left, right: old.right } }));
  }
  pairReplacements(lines);
  return lines;
}

/**
 * @param was What the older patch does to a base line.
 * @param kind What the newer patch does to it.
 * @returns What that does to the code between the versions: removed by only one patch, it's in only the other
 * version's code.
 */
function matchedEffect(was: LineKind, kind: LineKind): Mark {
  if (was === kind) return " ";
  if (was === "-") return "+";
  return kind === "-" ? "-" : " ";
}

/**
 * @param text A patch line, normalized for comparing.
 * @returns What it's compared by: an added line by its code and its marker, a base line, kept or removed, by its
 * code alone.
 */
function baseLineKey(text: string): string {
  return text.startsWith("-") ? ` ${text.slice(1)}` : text;
}

/**
 * @param body A file's raw patch lines.
 * @returns Each line normalized for comparing, as shown, and numbered.
 */
function patchRows(body: string[]): Omit<InterdiffLine, "mark" | "effect">[] {
  const numbers = lineNumbers(body);
  return body.map((line, index) => ({
    text: normalizeLine(line),
    display: clean(line),
    left: numbers[index]?.left ?? null,
    right: numbers[index]?.right ?? null,
  }));
}

/**
 * @param text A raw line of a patch.
 * @returns What kind of line it is, and its code without the leading marker. A hunk header is all code.
 */
export function splitLine(text: string): { kind: LineKind; code: string } {
  const kind = MARKERS[text.slice(0, 1)];
  return kind ? { kind, code: text.slice(1) } : { kind: "hunk", code: text };
}

/**
 * Splits two similar lines into runs of what they share and what differs, word by word.
 * @param before The older line's code.
 * @param after The newer line's code.
 * @returns The runs of each, or null when they share too little for highlights to help.
 */
export function wordDiff(before: string, after: string): [Segment[], Segment[]] | null {
  return wordRuns(before, after)?.segments ?? null;
}

/**
 * @param before The older line's code.
 * @param after The newer line's code.
 * @returns The runs of each and how much text they share, or null when they share too little.
 */
function wordRuns(before: string, after: string): { segments: [Segment[], Segment[]]; shared: number } | null {
  const diff = diffLines(tokens(before), tokens(after));
  const shared = diff.filter((token) => token.mark === " ").reduce((length, token) => length + token.text.length, 0);
  if (shared < MIN_WORD_OVERLAP * Math.max(before.length, after.length)) return null;
  const runs = (skip: Mark) => {
    const segments: Segment[] = [];
    for (const token of diff) {
      if (token.mark === skip) continue;
      const changed = token.mark !== " ";
      const last = segments.at(-1);
      if (last?.changed === changed) last.text += token.text;
      else segments.push({ text: token.text, changed });
    }
    return segments;
  };
  return { segments: [runs("+"), runs("-")], shared };
}

function tokens(text: string): string[] {
  return text.match(/\w+|\s+|[^\w\s]/gu) ?? [];
}

/**
 * @param body A file's raw patch lines.
 * @returns For each line, its number on the base and on the head side of the file, as GitHub's diff numbers them.
 */
export function lineNumbers(body: string[]): { left: number | null; right: number | null }[] {
  let left = 0;
  let right = 0;
  return body.map((line) => {
    const hunk = HUNK_NUMBERS.exec(line);
    if (hunk) {
      left = Number(hunk[1]);
      right = Number(hunk[2]);
      return { left: null, right: null };
    }
    if (line.startsWith("+")) return { left: null, right: right++ };
    if (line.startsWith("-")) return { left: left++, right: null };
    if (line.startsWith("\\")) return { left: null, right: null };
    return { left: left++, right: right++ };
  });
}

/** How a file's verdict reads: as an addition, a removal, a change, or neither. */
export type Tone = "success" | "danger" | "accent" | "muted";

/**
 * Says what happened to a file between the versions, from where it ends up: a file the older version added and the
 * newer one leaves alone is deleted, not merely "no longer changed".
 * @param file The file's interdiff.
 * @returns Its verdict and how it reads.
 */
export function fileVerdict(file: Pick<FileInterdiff, "change" | "status">): { label: string; tone: Tone } {
  const { before, after } = file.status;
  switch (file.change) {
    case "added": {
      if (after === "added") return { label: "New file", tone: "success" };
      if (after === "removed") return { label: "Deleted", tone: "danger" };
      return { label: "Newly changed", tone: "success" };
    }
    case "dropped": {
      if (before === "added") return { label: "Deleted", tone: "danger" };
      if (before === "removed") return { label: "Restored", tone: "success" };
      return { label: "No longer changed", tone: "danger" };
    }
    case "changed": {
      if (after === "removed" && before !== "removed") return { label: "Deleted", tone: "danger" };
      if (before === "removed" && after !== "removed") return { label: "Restored", tone: "success" };
      return { label: "Changed", tone: "accent" };
    }
    case "opaque": {
      return { label: "Can't compare", tone: "muted" };
    }
    case "unchanged": {
      return { label: "Unchanged", tone: "muted" };
    }
  }
}

/**
 * Describes where a renamed file came from, for its file header. That a file is new or deleted is its verdict's to
 * say, and where each version renamed it to its path's to show (`old → new`).
 * @param header The header lines, marked by how they changed between the versions.
 * @returns A label per rename origin.
 */
export function headerLabels(header: DiffLine[]): { label: string; mark: Mark }[] {
  const labels: { label: string; mark: Mark }[] = [];
  for (const { mark, text } of header) {
    if (text.startsWith("rename from ")) labels.push({ label: `Renamed from ${text.slice("rename from ".length)}`, mark });
  }
  return labels;
}

/**
 * @param lines A file's lines.
 * @returns The one kind every code line of the pull request's patch has, when it's all added or all removed lines,
 * like a new file's; null when the patch mixes them.
 */
export function uniformKind(lines: InterdiffLine[]): "+" | "-" | null {
  const kinds = new Set(lines.map((line) => splitLine(line.display).kind).filter((kind) => kind !== "hunk" && kind !== "\\"));
  const [only] = kinds;
  return kinds.size === 1 && (only === "+" || only === "-") ? only : null;
}

/**
 * @param display A hunk header.
 * @returns Whether it only says the file is new or deleted, like `@@ -0,0 +1,59 @@`, which tells nothing.
 */
export function isWholeFileHunk(display: string): boolean {
  return /^@@ -0,0 \+\d+(?:,\d+)? @@|^@@ -\d+(?:,\d+)? \+0,0 @@/u.test(display);
}

/**
 * Splits a file's line counts into GitHub's five diffstat squares.
 * @param added Lines added.
 * @param removed Lines removed.
 * @returns Five squares, added ones first, then removed ones, then neutral ones.
 */
export function diffstat(added: number, removed: number): ("add" | "del" | "none")[] {
  const total = added + removed;
  const scale = total <= 5 ? 1 : 5 / total;
  let adds = added > 0 ? Math.max(1, Math.round(added * scale)) : 0;
  const dels = removed > 0 ? Math.max(1, Math.min(5 - adds, Math.round(removed * scale))) : 0;
  adds = Math.min(adds, 5 - dels);
  return [...Array.from({ length: adds }, () => "add" as const), ...Array.from({ length: dels }, () => "del" as const), ...Array.from({ length: 5 - adds - dels }, () => "none" as const)];
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

function clean(line: string): string {
  return line.replace(/\r$/u, "");
}

function normalizeLine(line: string): string {
  const text = clean(line);
  return HUNK_HEADER.test(text) ? text.replace(HUNK_HEADER, "@@ ").trimEnd() : text;
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

function toHunks(lines: InterdiffLine[]): Hunk[] {
  const hunks: Hunk[] = [];
  const changed = lines.flatMap((line, index) => (line.effect === " " ? [] : index));
  let index = 0;
  while (index < changed.length) {
    const first = changed[index]!;
    let last = first;
    while (index + 1 < changed.length && changed[index + 1]! - last <= 2 * CONTEXT + 1) last = changed[++index]!;
    index++;
    const start = Math.max(0, first - CONTEXT);
    hunks.push({ start, lines: lines.slice(start, Math.min(lines.length, last + CONTEXT + 1)) });
  }
  return hunks;
}
/**
 * Gives each removed line that's followed by added ones word highlights against the most similar of them, keeping
 * the pairs in order.
 * @param lines The lines, changed in place.
 */
function pairReplacements(lines: InterdiffLine[]): void {
  let index = 0;
  while (index < lines.length) {
    if (lines[index]!.effect !== "-") {
      index++;
      continue;
    }
    const removedStart = index;
    while (index < lines.length && lines[index]!.effect === "-") index++;
    const addedStart = index;
    while (index < lines.length && lines[index]!.effect === "+") index++;
    let next = addedStart;
    for (let removed = removedStart; removed < addedStart && next < index; removed++) {
      const before = splitLine(lines[removed]!.display);
      if (before.kind === "hunk") continue;
      let best: { at: number; segments: [Segment[], Segment[]]; shared: number } | null = null;
      for (let added = next; added < Math.min(index, next + PAIR_WINDOW); added++) {
        const after = splitLine(lines[added]!.display);
        if (after.kind === "hunk") continue;
        const words = wordRuns(before.code, after.code);
        if (words && (!best || words.shared > best.shared)) best = { at: added, ...words };
      }
      if (!best) continue;
      [lines[removed]!.segments, lines[best.at]!.segments] = best.segments;
      next = best.at + 1;
    }
  }
}
/* oxlint-enable typescript/no-non-null-assertion */
