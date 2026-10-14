import { describe, expect, test } from "bun:test";
import { diffLines, interdiff, patchLines, type VersionFile } from "./interdiff";

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
  });

  test("shows how a file's change changed", () => {
    const [result] = interdiff(
      [file("a.ts", "@@ -1,3 +1,4 @@\n a\n+b\n c")],
      [file("a.ts", "@@ -1,3 +1,4 @@\n a\n+B\n c")],
    );
    expect(result?.change).toBe("changed");
    expect(result?.hunks[0]?.lines).toEqual([
      { mark: " ", text: "@@" },
      { mark: " ", text: " a" },
      { mark: "-", text: "+b" },
      { mark: "+", text: "+B" },
      { mark: " ", text: " c" },
    ]);
    expect(result).toMatchObject({ added: 1, removed: 1 });
  });

  test("reports files only one version touches", () => {
    const results = interdiff([file("old.ts", "@@ -1 +1 @@\n-x\n+y")], [file("new.ts", "@@ -1 +1 @@\n-p\n+q")]);
    expect(results.map((result) => [result.path, result.change, result.added, result.removed])).toEqual([
      ["new.ts", "added", 3, 0],
      ["old.ts", "dropped", 0, 3],
    ]);
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
    const changed = body.map((line, index) => (index === 10 ? "+changed" : line));
    const [result] = interdiff([file("a.ts", ["@@ -1 +1 @@", ...body].join("\n"))], [file("a.ts", ["@@ -1 +1 @@", ...changed].join("\n"))]);
    expect(result?.hunks).toHaveLength(1);
    expect(result?.hunks[0]?.lines.map((line) => line.text)).toEqual([" line7", " line8", " line9", " line10", "+changed", " line11", " line12", " line13"]);
  });
});

describe("patchLines whitespace", () => {
  test("keeps blank context lines and drops carriage returns", () => {
    expect(patchLines(file("a.ts", "@@ -1,3 +1,3 @@\n a\r\n \n-b\n+c"))).toEqual(["@@", " a", " ", "-b", "+c"]);
  });
});
