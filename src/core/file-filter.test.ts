import { describe, expect, test } from "bun:test";
import { emptyFilter, extensionCounts, extensionOf, type FileFilter, narrowsMenu, NO_EXTENSION, showsFile } from "./file-filter";

function filter(changes: Partial<FileFilter>): FileFilter {
  return { ...emptyFilter(), ...changes };
}

describe("extensionOf", () => {
  test.each([
    ["src/ui/bar.ts", ".ts"],
    ["docs/README.MD", ".md"],
    ["archive.tar.gz", ".gz"],
    ["Makefile", NO_EXTENSION],
    ["config/.gitignore", NO_EXTENSION],
    ["a.dir/LICENSE", NO_EXTENSION],
  ])("names %s's extension %s", (path, extension) => {
    expect(extensionOf(path)).toBe(extension);
  });
});

describe("extensionCounts", () => {
  test("counts each extension, alphabetically, with files without one last", () => {
    expect(extensionCounts(["src/b.ts", "Makefile", "a.css", "src/a.ts", "README.md"])).toEqual([
      { extension: ".css", count: 1 },
      { extension: ".md", count: 1 },
      { extension: ".ts", count: 2 },
      { extension: NO_EXTENSION, count: 1 },
    ]);
  });

  test("no files have no extensions", () => {
    expect(extensionCounts([])).toEqual([]);
  });
});

describe("showsFile", () => {
  test("an empty filter shows every file, viewed or not", () => {
    expect(showsFile("src/a.ts", emptyFilter(), true)).toBe(true);
  });

  test("the text matches anywhere in the path, in any case, ignoring the spaces around it", () => {
    expect(showsFile("src/api/Version-Cache.ts", filter({ query: " api/version " }), false)).toBe(true);
    expect(showsFile("src/core/versions.ts", filter({ query: "cache" }), false)).toBe(false);
  });

  test("a hidden extension hides its files", () => {
    const hidden = filter({ hiddenExtensions: new Set([".ts", NO_EXTENSION]) });
    expect(showsFile("src/a.ts", hidden, false)).toBe(false);
    expect(showsFile("Makefile", hidden, false)).toBe(false);
    expect(showsFile("README.md", hidden, false)).toBe(true);
  });

  test("hiding viewed files hides only the files marked as viewed", () => {
    expect(showsFile("src/a.ts", filter({ hideViewed: true }), true)).toBe(false);
    expect(showsFile("src/a.ts", filter({ hideViewed: true }), false)).toBe(true);
  });
});

describe("narrowsMenu", () => {
  test("only the menu's choices mark its button, not the text", () => {
    expect(narrowsMenu(filter({ query: "a" }))).toBe(false);
    expect(narrowsMenu(filter({ hideViewed: true }))).toBe(true);
    expect(narrowsMenu(filter({ hiddenExtensions: new Set([".ts"]) }))).toBe(true);
  });
});
