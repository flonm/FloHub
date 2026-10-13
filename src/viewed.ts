/** GitHub's per-viewer review mark on a changed file. DISMISSED means the file changed after it was marked. */
export type ViewedState = "VIEWED" | "UNVIEWED" | "DISMISSED";

export interface ViewedFile {
  path: string;
  viewerViewedState: ViewedState;
  additions: number;
  deletions: number;
}

export interface DiffStat {
  /** "+12", or null when the file adds no lines. */
  added: string | null;
  /** "−3", or null when the file deletes no lines. */
  deleted: string | null;
  /** The counts spelled out, for a tooltip. */
  label: string;
  /** The characters the visible counts take up, to reserve room for them. */
  width: number;
}

export interface ViewedFiles {
  pullRequestId: string;
  files: ViewedFile[];
}

/**
 * @param additions The lines the file adds.
 * @param deletions The lines the file deletes.
 * @returns The file's line counts for display, or null when it changes no lines (a binary file or a pure rename).
 */
export function formatDiffStat(additions: number, deletions: number): DiffStat | null {
  if (additions === 0 && deletions === 0) return null;
  const added = additions > 0 ? `+${additions.toLocaleString("en-US")}` : null;
  const deleted = deletions > 0 ? `\u2212${deletions.toLocaleString("en-US")}` : null;
  const label = `${count(additions, "addition")}, ${count(deletions, "deletion")}`;
  return { added, deleted, label, width: [added, deleted].filter(Boolean).join(" ").length };
}

function count(value: number, noun: string): string {
  return `${value.toLocaleString("en-US")} ${noun}${value === 1 ? "" : "s"}`;
}

/**
 * @param path A changed file's path.
 * @returns The id GitHub gives the file's diff and uses in `#diff-…` links: "diff-" plus the path's SHA-256 in hex.
 */
export async function diffAnchor(path: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(path));
  return `diff-${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Matches a path rebuilt from file tree labels against the pull request's changed files.
 * The rebuilt path can lack a leading part when the tree hides it, so a unique suffix match also counts.
 * @param candidate The tree labels from the root down to the file, joined with "/".
 * @param paths The changed files.
 * @returns The changed file, or null when none or several match.
 */
export function matchPath(candidate: string, paths: Iterable<string>): string | null {
  const suffix = `/${candidate}`;
  let match: string | null = null;
  for (const path of paths) {
    if (path === candidate) return path;
    if (path.endsWith(suffix)) {
      if (match !== null) return null;
      match = path;
    }
  }
  return match;
}

/**
 * Combines the page's own Viewed checkbox with the API state. The checkbox is newer when the two disagree,
 * but it cannot show DISMISSED, so an unchecked box keeps that state.
 * @param checked Whether the page's checkbox is checked.
 * @param known The last state the API or the page reported.
 * @returns The state to show.
 */
export function stateFromCheckbox(checked: boolean, known: ViewedState | undefined): ViewedState {
  if (checked) return "VIEWED";
  return known === "DISMISSED" ? "DISMISSED" : "UNVIEWED";
}
