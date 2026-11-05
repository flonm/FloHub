/**
 * The file tree's filter, as GitHub's Files changed page has it: a text that narrows the files to the paths containing
 * it, and a menu that hides files by extension or hides the files the viewer marked as viewed.
 */

/** What GitHub's menu calls a file whose name has no extension. */
export const NO_EXTENSION = "No extension";

export interface FileFilter {
  /** Text a path must contain, in any case; empty shows every path. */
  query: string;
  /** Extensions whose files are hidden, as {@link extensionOf} names them. */
  hiddenExtensions: ReadonlySet<string>;
  /** Whether files the viewer marked as viewed are hidden. */
  hideViewed: boolean;
}

/** @returns A filter that shows every file. */
export function emptyFilter(): FileFilter {
  return { query: "", hiddenExtensions: new Set(), hideViewed: false };
}

/**
 * @param path A file's path.
 * @returns Its extension with the dot, in lower case, or {@link NO_EXTENSION}. A dotfile like `.gitignore` has none.
 */
export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : NO_EXTENSION;
}

/**
 * @param paths The files' paths.
 * @returns Each extension the files have, with how many have it: in alphabetical order, files without one last.
 */
export function extensionCounts(paths: readonly string[]): { extension: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const path of paths) {
    const extension = extensionOf(path);
    counts.set(extension, (counts.get(extension) ?? 0) + 1);
  }
  return [...counts]
    .map(([extension, count]) => ({ extension, count }))
    .toSorted((a, b) => {
      const last = Number(a.extension === NO_EXTENSION) - Number(b.extension === NO_EXTENSION);
      return last === 0 ? a.extension.localeCompare(b.extension) : last;
    });
}

/**
 * @param path The file's path.
 * @param filter The filter.
 * @param viewed Whether the viewer marked the file as viewed.
 * @returns Whether the filter shows the file.
 */
export function showsFile(path: string, filter: FileFilter, viewed: boolean): boolean {
  if (filter.hideViewed && viewed) return false;
  if (filter.hiddenExtensions.has(extensionOf(path))) return false;
  const query = filter.query.trim().toLowerCase();
  return query === "" || path.toLowerCase().includes(query);
}

/**
 * @param filter The filter.
 * @returns Whether it hides anything, which GitHub shows by marking its menu's button.
 */
export function narrowsMenu(filter: FileFilter): boolean {
  return filter.hiddenExtensions.size > 0 || filter.hideViewed;
}
