import { describe, expect, test } from "bun:test";
import {
  diffLines,
  diffstat,
  fileVerdict,
  headerLabels,
  type InterdiffLine,
  interdiff,
  isWholeFileHunk,
  type LineKind,
  lineNumbers,
  patchLines,
  splitLine,
  uniformKind,
  type VersionFile,
  versionDiff,
  wordDiff,
} from "./interdiff";

const file = (filename: string, patch: string | undefined, extra: Partial<VersionFile> = {}): VersionFile => ({
  filename,
  status: "modified",
  patch,
  sha: `sha-${filename}-${patch?.length ?? 0}`,
  ...extra,
});
const blob = (sha: string) => file("logo.png", undefined, { sha });

/** Applies a diff's kept and added lines, which must give back the new side. */
const newSide = (lines: { mark: string; text: string }[]) => lines.filter((line) => line.mark !== "-").map((line) => line.text);
const oldSide = (lines: { mark: string; text: string }[]) => lines.filter((line) => line.mark !== "+").map((line) => line.text);

describe("diffLines", () => {
  test("keeps equal input", () => {
    expect(diffLines(["a", "b"], ["a", "b"]).every((line) => line.mark === " ")).toBe(true);
  });

  test("finds a minimal edit", () => {
    const lines = diffLines(["a", "b", "c", "a", "b", "b", "a"], ["c", "b", "a", "b", "a", "c"]);
    expect(lines.filter((line) => line.mark !== " ")).toHaveLength(5);
    expect(oldSide(lines)).toEqual(["a", "b", "c", "a", "b", "b", "a"]);
    expect(newSide(lines)).toEqual(["c", "b", "a", "b", "a", "c"]);
  });

  test("handles empty sides", () => {
    expect(diffLines([], ["x"])).toEqual([{ mark: "+", text: "x" }]);
    expect(diffLines(["x"], [])).toEqual([{ mark: "-", text: "x" }]);
    expect(diffLines([], [])).toEqual([]);
  });

  test("reconstructs both sides of random edits", () => {
    let seed = 7;
    const random = () => (seed = (seed * 48_271) % 2_147_483_647) / 2_147_483_647;
    for (let round = 0; round < 50; round++) {
      const a = Array.from({ length: Math.floor(random() * 30) }, () => String(Math.floor(random() * 5)));
      const b = Array.from({ length: Math.floor(random() * 30) }, () => String(Math.floor(random() * 5)));
      const lines = diffLines(a, b);
      expect(oldSide(lines)).toEqual(a);
      expect(newSide(lines)).toEqual(b);
    }
  });

  test("falls back to replacing the middle when the edit is huge", () => {
    const a = Array.from({ length: 3000 }, (_, index) => `a${index}`);
    const b = Array.from({ length: 3000 }, (_, index) => `b${index}`);
    const lines = diffLines(["same", ...a, "end"], ["same", ...b, "end"]);
    expect(lines[0]).toEqual({ mark: " ", text: "same" });
    expect(lines.at(-1)).toEqual({ mark: " ", text: "end" });
    expect(oldSide(lines)).toEqual(["same", ...a, "end"]);
    expect(newSide(lines)).toEqual(["same", ...b, "end"]);
  });
});

describe("patchLines", () => {
  test("drops hunk line numbers but keeps the function context", () => {
    expect(patchLines(file("a.ts", "@@ -10,6 +12,7 @@ function run() {\n line\n+added"))).toEqual([
      "@@ function run() {",
      " line",
      "+added",
    ]);
    expect(patchLines(file("a.ts", "@@ -1 +1 @@\n-x\n+y"))).toEqual(["@@", "-x", "+y"]);
  });

  test("names renames, new and deleted files", () => {
    expect(patchLines(file("b.ts", undefined, { status: "renamed", previousFilename: "a.ts" }))).toEqual(["rename from a.ts", "rename to b.ts"]);
    expect(patchLines(file("b.ts", "@@ -0,0 +1 @@\n+x", { status: "added" }))[0]).toBe("new file");
  });
});

describe("interdiff", () => {
  test("ignores a rebase that only moved the hunks", () => {
    const [result] = interdiff(
      [file("a.ts", "@@ -10,3 +10,4 @@ class A\n a\n+b\n c")],
      [file("a.ts", "@@ -40,3 +40,4 @@ class A\n a\n+b\n c")],
    );
    expect(result).toMatchObject({ path: "a.ts", change: "unchanged", hunks: [], added: 0, removed: 0 });
    expect(result?.lines.map((line) => line.display)).toEqual(["@@ -40,3 +40,4 @@ class A", " a", "+b", " c"]);
  });

  test("shows how a file's change changed", () => {
    const [result] = interdiff(
      [file("a.ts", "@@ -1,3 +1,4 @@\n a\n+b\n c")],
      [file("a.ts", "@@ -1,3 +1,4 @@\n a\n+B\n c")],
    );
    expect(result?.change).toBe("changed");
    expect(result?.hunks[0]?.lines.map(({ mark, text, left, right }) => ({ mark, text, left, right }))).toEqual([
      { mark: " ", text: "@@", left: null, right: null },
      { mark: " ", text: " a", left: 1, right: 1 },
      { mark: "-", text: "+b", left: null, right: 2 },
      { mark: "+", text: "+B", left: null, right: 2 },
      { mark: " ", text: " c", left: 2, right: 3 },
    ]);
    expect(result).toMatchObject({ added: 1, removed: 1 });
  });

  test("reports files only one version touches", () => {
    const results = interdiff([file("old.ts", "@@ -1 +1 @@\n-x\n+y")], [file("new.ts", "@@ -1 +1 @@\n-p\n+q")]);
    expect(results.map((result) => [result.path, result.change, result.added, result.removed])).toEqual([
      ["new.ts", "added", 3, 0],
      ["old.ts", "dropped", 0, 3],
    ]);
    expect(results.map((result) => result.status)).toEqual([
      { before: null, after: "modified" },
      { before: "modified", after: null },
    ]);
  });

  test("keeps the new, deleted and renamed lines out of the diff, but counts them", () => {
    const [result] = interdiff([file("a.ts", "@@ -1 +1 @@\n-x\n+y")], [file("a.ts", "@@ -0,0 +1 @@\n+y", { status: "added" })]);
    expect(result?.header).toEqual([{ mark: "+", text: "new file" }]);
    expect(result?.lines.map((line) => line.text)).toEqual(["@@", "-x", "+y"]);
    expect(result).toMatchObject({ change: "changed", added: 1, removed: 1 });
  });

  test("a header that changed alone still changes the file", () => {
    const [result] = interdiff([file("a.ts", "@@ -1 +1 @@\n+y")], [file("a.ts", "@@ -1 +1 @@\n+y", { status: "added" })]);
    expect(result).toMatchObject({ change: "changed", hunks: [], added: 1, removed: 0 });
  });

  test("highlights the words that differ between a replaced line and its replacement", () => {
    const [result] = interdiff(
      [file("a.ts", "@@ -1,1 +1,1 @@\n+adopt(branch)\n+keep()")],
      [file("a.ts", "@@ -1,1 +1,1 @@\n+adopt(branch, equivalent)\n+keep()")],
    );
    const [removed, added] = result?.hunks[0]?.lines.filter((line) => line.mark !== " ") ?? [];
    expect(removed?.segments).toEqual([{ text: "adopt(branch)", changed: false }]);
    expect(added?.segments).toEqual([
      { text: "adopt(branch", changed: false },
      { text: ", equivalent", changed: true },
      { text: ")", changed: false },
    ]);
  });

  test("pairs a replaced line with the most similar replacement, not the next one", () => {
    const [result] = interdiff(
      [file("a.ts", "@@ -1,1 +1,2 @@\n const RETRIES = 3;\n+const BACKOFF_MS = 500;")],
      [file("a.ts", "@@ -1,1 +1,3 @@\n const RETRIES = 3;\n+const LIMIT = 9;\n+const BACKOFF_MS = 250;")],
    );
    const words = (result?.lines ?? []).map((line) => [
      `${line.mark}${line.text}`,
      line.segments?.filter((segment) => segment.changed).map((segment) => segment.text),
    ]);
    expect(words).toEqual([
      [" @@", undefined],
      ["  const RETRIES = 3;", undefined],
      ["-+const BACKOFF_MS = 500;", ["500"]],
      ["++const LIMIT = 9;", undefined],
      ["++const BACKOFF_MS = 250;", ["250"]],
    ]);
  });

  test("marks files GitHub shows no diff for", () => {
    expect(interdiff([blob("1")], [blob("2")])[0]?.diffless).toBe(true);
    expect(interdiff([file("a.ts", "@@ -1 +1 @@\n+x")], [file("a.ts", "@@ -1 +1 @@\n+y")])[0]?.diffless).toBe(false);
  });

  test("pairs a file renamed differently in each version", () => {
    const results = interdiff(
      [file("b.ts", "", { status: "renamed", previousFilename: "a.ts" })],
      [file("c.ts", "", { status: "renamed", previousFilename: "a.ts" })],
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ path: "c.ts", oldPath: "b.ts", change: "changed" });
  });

  test("compares files without a diff by blob", () => {
    expect(interdiff([blob("1")], [blob("1")])[0]?.change).toBe("unchanged");
    expect(interdiff([blob("1")], [blob("2")])[0]?.change).toBe("opaque");
  });

  test("keeps three lines of context around each change", () => {
    const body = Array.from({ length: 20 }, (_, index) => ` line${index}`);
    // The newer version replaces line10, so its patch has it as a removed line where the older one has context.
    const changed = [...body.slice(0, 10), "-line10", "+changed", ...body.slice(11)];
    const [result] = interdiff([file("a.ts", ["@@ -1 +1 @@", ...body].join("\n"))], [file("a.ts", ["@@ -1 +1 @@", ...changed].join("\n"))]);
    expect(result?.hunks).toHaveLength(1);
    expect(result?.hunks[0]?.start).toBe(8);
    expect(result?.lines).toHaveLength(22);
    expect(result?.hunks[0]?.lines.map((line) => line.text)).toEqual([" line7", " line8", " line9", "-line10", "+changed", " line11", " line12", " line13"]);
  });
});

describe("patchLines whitespace", () => {
  test("keeps blank context lines and drops carriage returns", () => {
    expect(patchLines(file("a.ts", "@@ -1,3 +1,3 @@\n a\r\n \n-b\n+c"))).toEqual(["@@", " a", " ", "-b", "+c"]);
  });
});

describe("lineNumbers", () => {
  test("numbers each side from the hunk header, as GitHub's diff does", () => {
    expect(lineNumbers(["@@ -10,3 +20,3 @@ f()", " a", "-b", "+c", String.raw`\ No newline at end of file`, " d"])).toEqual([
      { left: null, right: null },
      { left: 10, right: 20 },
      { left: 11, right: null },
      { left: null, right: 21 },
      { left: null, right: null },
      { left: 12, right: 22 },
    ]);
  });
});

describe("splitLine", () => {
  test.each<[string, LineKind, string]>([
    [" a", " ", "a"],
    ["+b", "+", "b"],
    ["-c", "-", "c"],
    [String.raw`\ No newline at end of file`, "\\", " No newline at end of file"],
    ["@@ -1 +1 @@ f()", "hunk", "@@ -1 +1 @@ f()"],
  ])("%p is a %p line", (text, kind, code) => {
    expect(splitLine(text)).toEqual({ kind, code });
  });
});

describe("wordDiff", () => {
  test("splits two similar lines into shared and differing runs", () => {
    expect(wordDiff("const a = 1;", "const a = 2;")).toEqual([
      [
        { text: "const a = ", changed: false },
        { text: "1", changed: true },
        { text: ";", changed: false },
      ],
      [
        { text: "const a = ", changed: false },
        { text: "2", changed: true },
        { text: ";", changed: false },
      ],
    ]);
  });

  test("gives up on lines that share too little", () => {
    expect(wordDiff("return nil", "log.Printf(branch, err)")).toBeNull();
  });

  test("an identical line has no changed runs", () => {
    expect(wordDiff("x()", "x()")).toEqual([[{ text: "x()", changed: false }], [{ text: "x()", changed: false }]]);
  });
});

describe("headerLabels", () => {
  test("names where a renamed file came from, but not where it went, which its path shows", () => {
    expect(
      headerLabels([
        { mark: " ", text: "rename from a.ts" },
        { mark: " ", text: "rename to b.ts" },
      ]),
    ).toEqual([{ label: "Renamed from a.ts", mark: " " }]);
    expect(
      headerLabels([
        { mark: "-", text: "rename to b.ts" },
        { mark: "+", text: "rename to c.ts" },
      ]),
    ).toEqual([]);
  });

  test("leaves saying a file is new or deleted to its verdict", () => {
    expect(headerLabels([{ mark: "+", text: "new file" }])).toEqual([]);
    expect(headerLabels([{ mark: "-", text: "deleted file" }])).toEqual([]);
  });
});

describe("fileVerdict", () => {
  test.each([
    ["added", null, "added", "New file", "success"],
    ["added", null, "removed", "Deleted", "danger"],
    ["added", null, "modified", "Newly changed", "success"],
    ["dropped", "added", null, "Deleted", "danger"],
    ["dropped", "removed", null, "Restored", "success"],
    ["dropped", "modified", null, "No longer changed", "danger"],
    ["changed", "modified", "removed", "Deleted", "danger"],
    ["changed", "removed", "modified", "Restored", "success"],
    ["changed", "added", "added", "Changed", "accent"],
    ["changed", "removed", "removed", "Changed", "accent"],
    ["opaque", "modified", "modified", "Can't compare", "muted"],
    ["unchanged", "modified", "modified", "Unchanged", "muted"],
  ] as const)("a %s file that was %p before and %p after reads %p", (change, before, after, label, tone) => {
    expect(fileVerdict({ change, status: { before, after } })).toEqual({ label, tone });
  });
});

const patchLine = (display: string): InterdiffLine => ({ mark: "-", text: display, display, left: null, right: null });

describe("uniformKind", () => {
  test("a new file's lines are all added, hunk headers and the no-newline note aside", () => {
    expect(uniformKind([patchLine("@@ -0,0 +1,2 @@"), patchLine("+a"), patchLine("+b"), patchLine(String.raw`\ No newline at end of file`)])).toBe("+");
  });

  test("a deleted file's lines are all removed", () => {
    expect(uniformKind([patchLine("-a"), patchLine("-b")])).toBe("-");
  });

  test("a patch with context or both kinds has none", () => {
    expect(uniformKind([patchLine("+a"), patchLine(" b")])).toBeNull();
    expect(uniformKind([patchLine("+a"), patchLine("-b")])).toBeNull();
    expect(uniformKind([patchLine(" a")])).toBeNull();
    expect(uniformKind([])).toBeNull();
  });
});

describe("isWholeFileHunk", () => {
  test.each([
    ["@@ -0,0 +1,59 @@", true],
    ["@@ -0,0 +1 @@", true],
    ["@@ -1,12 +0,0 @@", true],
    ["@@ -0,0 +1,3 @@ fn", true],
    ["@@ -1,4 +1,5 @@", false],
    ["@@ -10,0 +11,2 @@", false],
  ])("%p only says the file is new or deleted: %p", (display, whole) => {
    expect(isWholeFileHunk(display)).toBe(whole);
  });
});

describe("diffstat", () => {
  test.each([
    [0, 0, ["none", "none", "none", "none", "none"]],
    [1, 1, ["add", "del", "none", "none", "none"]],
    [4, 0, ["add", "add", "add", "add", "none"]],
    [100, 1, ["add", "add", "add", "add", "del"]],
    [1, 100, ["add", "del", "del", "del", "del"]],
    [30, 20, ["add", "add", "add", "del", "del"]],
  ])("%p added and %p removed fill the squares in proportion", (added, removed, squares) => {
    expect(diffstat(added, removed)).toEqual(squares as ReturnType<typeof diffstat>);
  });
});

describe("versionDiff", () => {
  const modified = { filename: "src/a.ts", status: "modified", sha: "a1", patch: "@@ -1,3 +1,3 @@\n keep\n-old\n+new\n tail" };

  test("shows one version's own changes as a plain diff, marked by what the pull request does", () => {
    const [diff] = versionDiff([modified]);
    expect(diff?.lines.map((line) => `${line.mark}${line.left ?? ""}/${line.right ?? ""}`)).toEqual([" /", " 1/1", "-2/", "+/2", " 3/3"]);
    expect([diff?.added, diff?.removed, diff?.change]).toEqual([1, 1, "changed"]);
    expect(diff?.hunks).toHaveLength(1);
  });

  test("a file the version adds or deletes reads as new or deleted", () => {
    const [added] = versionDiff([{ ...modified, status: "added", patch: "@@ -0,0 +1 @@\n+new" }]);
    expect(fileVerdict(added!).label).toBe("New file");
    const [removed] = versionDiff([{ ...modified, status: "removed", patch: "@@ -1 +0,0 @@\n-old" }]);
    expect(fileVerdict(removed!).label).toBe("Deleted");
  });
});

describe("a kept line remembers where the older version had it", () => {
  test("so a comment on the older version finds it, though the newer one numbers it differently", () => {
    const before = { filename: "a.ts", status: "modified", sha: "a1", patch: "@@ -10,2 +10,3 @@\n keep\n+added\n tail" };
    const after = { filename: "a.ts", status: "modified", sha: "a2", patch: "@@ -20,2 +20,4 @@\n+first\n keep\n+added\n tail" };
    const [compared] = interdiff([before], [after]);
    const kept = compared?.lines.find((line) => line.display === "+added");
    expect([kept?.mark, kept?.right, kept?.origin?.right]).toEqual([" ", 22, 11]);
    expect(compared?.lines.find((line) => line.display === "+first")?.origin).toBeUndefined();
  });
});

describe("context lines are not changes", () => {
  // Both versions add x. The newer one also adds y further down, so GitHub cuts its hunks differently: its first
  // hunk shows fewer lines around x, and a second hunk starts.
  const older = file("a.ts", "@@ -1,6 +1,7 @@\n a\n b\n c\n+x\n d\n e\n f");
  const newer = file("a.ts", "@@ -2,4 +2,5 @@\n b\n c\n+x\n d\n@@ -20,3 +21,4 @@\n p\n+y\n q");

  test("a context line or hunk header only one version's patch shows is no change between the versions", () => {
    const [compared] = interdiff([older], [newer]);
    const changed = compared?.lines.filter((line) => line.mark !== " ").map((line) => `${line.mark}${line.display}`);
    expect(changed).toEqual(["++y"]);
    expect([compared?.added, compared?.removed]).toEqual([1, 0]);
  });

  test("the older version's context the newer one leaves out isn't shown, so the rows keep the newer numbering", () => {
    const [compared] = interdiff([older], [newer]);
    expect(compared?.lines.map((line) => line.display)).not.toContain(" a");
    expect(compared?.lines.find((line) => line.display === "+x")?.right).toBe(4);
  });
});
