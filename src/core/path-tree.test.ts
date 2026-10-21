import { describe, expect, test } from "bun:test";
import { buildPathTree, filesInOrder, type PathNode } from "./path-tree";

/** @returns The tree as indented lines, folders ending in "/". */
function outline(nodes: PathNode<string>[], depth = 0): string[] {
  return nodes.flatMap((node) => {
    const line = `${"  ".repeat(depth)}${node.name}${node.kind === "folder" ? "/" : ""}`;
    return node.kind === "folder" ? [line, ...outline(node.children, depth + 1)] : line;
  });
}

function tree(paths: string[]): PathNode<string>[] {
  return buildPathTree(paths, (path) => path);
}

describe("buildPathTree", () => {
  test("lists folders before files, each sorted by name", () => {
    expect(outline(tree(["README.md", "cmd/rebase.go", "cmd/adopt.go", "build.ts", "api/client.go"]))).toEqual([
      "api/",
      "  client.go",
      "cmd/",
      "  adopt.go",
      "  rebase.go",
      "build.ts",
      "README.md",
    ]);
  });

  test("merges a folder that only holds one other folder into it", () => {
    expect(outline(tree(["src/ui/bar.ts", "src/ui/dom.ts", "src/core/stack.ts", "docs/guide/intro/start.md"]))).toEqual([
      "docs/guide/intro/",
      "  start.md",
      "src/",
      "  core/",
      "    stack.ts",
      "  ui/",
      "    bar.ts",
      "    dom.ts",
    ]);
  });

  test("keeps a merged folder's full path for linking", () => {
    const [folder] = tree(["docs/guide/intro/start.md"]);
    expect(folder).toMatchObject({ kind: "folder", name: "docs/guide/intro", path: "docs/guide/intro" });
  });

  test("does not merge a folder that also holds files", () => {
    expect(outline(tree(["src/index.ts", "src/ui/bar.ts"]))).toEqual(["src/", "  ui/", "    bar.ts", "  index.ts"]);
  });

  test("puts a file before its test, ignoring case like GitHub", () => {
    expect(outline(tree(["git/gitops_test.go", "git/gitops.go", "git/Mock.go"]))).toEqual(["git/", "  gitops.go", "  gitops_test.go", "  Mock.go"]);
  });

  test("keeps files at the top level and returns nothing for no files", () => {
    expect(outline(tree(["b.md", "a.md"]))).toEqual(["a.md", "b.md"]);
    expect(tree([])).toEqual([]);
  });
});

describe("filesInOrder", () => {
  test("reads the files top to bottom, as the tree shows them", () => {
    expect(filesInOrder(tree(["README.md", "src/ui/dom.ts", "cmd/rebase.go", "src/ui/bar.ts", "src/core/stack.ts"]))).toEqual([
      "cmd/rebase.go",
      "src/core/stack.ts",
      "src/ui/bar.ts",
      "src/ui/dom.ts",
      "README.md",
    ]);
  });
});
