interface FolderNode<T> {
  kind: "folder";
  /** The folder's name, or several names joined by "/" when a folder holds nothing but one other folder. */
  name: string;
  /** The folder's full path. */
  path: string;
  children: PathNode<T>[];
}

interface FileNode<T> {
  kind: "file";
  name: string;
  item: T;
}

export type PathNode<T> = FolderNode<T> | FileNode<T>;

/**
 * Arranges files by folder, the way GitHub's file tree does: folders before files, each sorted by name, and a folder
 * that holds nothing but one other folder merged into it, so `src/ui` takes one row instead of two.
 * @param items The files.
 * @param pathOf Reads an item's path, like "src/ui/bar.ts".
 * @returns The top level of the tree.
 */
export function buildPathTree<T>(items: readonly T[], pathOf: (item: T) => string): PathNode<T>[] {
  const root: FolderNode<T> = { kind: "folder", name: "", path: "", children: [] };
  for (const item of items) {
    const parts = pathOf(item).split("/");
    const name = parts.pop() ?? "";
    let folder = root;
    for (const part of parts) {
      const path = folder.path ? `${folder.path}/${part}` : part;
      let next = folder.children.find((child): child is FolderNode<T> => child.kind === "folder" && child.name === part);
      if (!next) {
        next = { kind: "folder", name: part, path, children: [] };
        folder.children.push(next);
      }
      folder = next;
    }
    folder.children.push({ kind: "file", name, item });
  }
  return arrange(root.children);
}

/**
 * @param nodes A tree from {@link buildPathTree}.
 * @returns Its files from top to bottom, the order the tree shows them in.
 */
export function filesInOrder<T>(nodes: readonly PathNode<T>[]): T[] {
  return nodes.flatMap((node) => (node.kind === "file" ? [node.item] : filesInOrder(node.children)));
}

function arrange<T>(nodes: PathNode<T>[]): PathNode<T>[] {
  const merged = nodes.map((node) => (node.kind === "folder" ? compress(node) : node));
  return merged.toSorted((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return byName(a.name, b.name);
  });
}

/** Orders names by their characters, ignoring case, so `stack.go` comes before `stack_test.go` as on GitHub. */
function byName(a: string, b: string): number {
  const [left, right] = [a.toLowerCase(), b.toLowerCase()];
  if (left === right) return a < b ? -1 : (a > b ? 1 : 0);
  return left < right ? -1 : 1;
}

function compress<T>(folder: FolderNode<T>): FolderNode<T> {
  let current = folder;
  let { name } = folder;
  for (let inner = soleFolder(current); inner; inner = soleFolder(current)) {
    current = inner;
    name += `/${inner.name}`;
  }
  return { kind: "folder", name, path: current.path, children: arrange(current.children) };
}

function soleFolder<T>(folder: FolderNode<T>): FolderNode<T> | null {
  const [first, second] = folder.children;
  return first?.kind === "folder" && second === undefined ? first : null;
}
