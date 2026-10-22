import { describe, expect, test } from "bun:test";
import { markChanges, patchPositions } from "./diff-marks";
import type { VersionFile } from "./interdiff";

const file = (filename: string, patch: string | undefined, extra: Partial<VersionFile> = {}): VersionFile => ({
  filename,
  status: "modified",
  patch,
  sha: `sha-${filename}-${patch?.length ?? 0}`,
  ...extra,
});

describe("patchPositions", () => {
  test("numbers added lines on the head side, deleted ones on the base side, context by its head line", () => {
    expect(patchPositions(file("a.ts", "@@ -10,3 +20,3 @@ fn\n ctx\n-old\n+new\n\\ No newline at end of file\n@@ -30 +40 @@\n+x"))).toEqual([
      null,
      { side: "R", line: 20 },
      { side: "L", line: 11 },
      { side: "R", line: 21 },
      null,
      null,
      { side: "R", line: 40 },
    ]);
  });

  test("leaves the header lines of a new file unnumbered", () => {
    expect(patchPositions(file("a.ts", "@@ -0,0 +1 @@\n+x", { status: "added" }))).toEqual([null, null, { side: "R", line: 1 }]);
  });
});

describe("markChanges", () => {
  test("marks the lines whose change is new, wherever the rebase moved them", () => {
    const [marks] = markChanges(
      [file("a.ts", "@@ -1,3 +1,4 @@\n a\n+b\n c")],
      [file("a.ts", "@@ -50,3 +50,5 @@\n a\n+b\n+b2\n c")],
    );
    expect(marks).toEqual({ path: "a.ts", change: "changed", changed: [{ side: "R", line: 52 }], removed: [] });
  });

  test("places lines the current version dropped after the line they followed", () => {
    const [marks] = markChanges(
      [file("a.ts", "@@ -1,3 +1,5 @@\n a\n+b\n+c\n d\n e")],
      [file("a.ts", "@@ -1,3 +1,3 @@\n a\n d\n e")],
    );
    expect(marks?.changed).toEqual([]);
    expect(marks?.removed).toEqual([{ after: { side: "R", line: 1 }, lines: ["+b", "+c"] }]);
  });

  test("marks a changed deletion on the base side", () => {
    const [marks] = markChanges([file("a.ts", "@@ -1,2 +1,1 @@\n a\n-b")], [file("a.ts", "@@ -1,3 +1,1 @@\n a\n-b\n-c")]);
    expect(marks?.changed).toEqual([{ side: "L", line: 3 }]);
  });

  test("marks every line of a file the older version did not touch, and nothing of unchanged files", () => {
    const marks = markChanges(
      [file("same.ts", "@@ -1 +1 @@\n-x\n+y")],
      [file("new.ts", "@@ -1 +1 @@\n-p\n+q"), file("same.ts", "@@ -9 +9 @@\n-x\n+y")],
    );
    expect(marks.find((mark) => mark.path === "new.ts")).toMatchObject({
      change: "added",
      changed: [
        { side: "L", line: 1 },
        { side: "R", line: 1 },
      ],
    });
    expect(marks.find((mark) => mark.path === "same.ts")).toMatchObject({ change: "unchanged", changed: [], removed: [] });
  });

  test("keeps files the current version no longer touches, without lines", () => {
    expect(markChanges([file("gone.ts", "@@ -1 +1 @@\n-x\n+y")], [])).toEqual([
      { path: "gone.ts", change: "dropped", changed: [], removed: [] },
    ]);
  });
});

/** @returns a.json as a version's patch has it. */
function version(patch: string): VersionFile {
  return { filename: "a.json", status: "modified", sha: patch, patch };
}

describe("markChanges and context", () => {

  test("a context line or hunk header only one patch shows is neither changed nor removed", () => {
    const older = version("@@ -1,6 +1,7 @@\n a\n b\n c\n+x\n d\n e\n f");
    const current = version("@@ -2,4 +2,5 @@\n b\n c\n+x\n d\n@@ -20,3 +21,4 @@\n p\n+y\n q");
    const [marks] = markChanges([older], [current]);
    expect(marks?.changed).toEqual([{ side: "R", line: 22 }]);
    expect(marks?.removed).toEqual([]);
  });

  test("a base line the older version removed and the current one keeps is highlighted as back", () => {
    const [marks] = markChanges([version("@@ -1,3 +1,3 @@\n a\n-x\n+x,\n b")], [version("@@ -1,3 +1,3 @@\n a\n x\n b")]);
    expect(marks?.changed).toEqual([{ side: "R", line: 2 }]);
    expect(marks?.removed.flatMap((group) => group.lines)).toEqual(["+x,"]);
  });
});
