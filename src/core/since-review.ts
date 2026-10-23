import type { FileInterdiff } from "./interdiff";
import { formatRangeParam, reviewPath, type Version } from "./versions";
import { formatDiffStat } from "./viewed";

/** The URL parameter the versions view keeps its range in, as content.ts reads and writes it. */
export const VERSIONS_PARAM = "flohub-versions";

/** How many files a poke names before it sums up the rest. */
const MAX_POKE_FILES = 3;

/** A reviewer's approval or change request that still counts, and how far the pull request has moved past it. */
export interface StandingVerdict {
  verdict: "approved" | "changes_requested";
  /** The version the verdict was given on. */
  version: Version;
  /** The current head. */
  current: Version;
  /**
   * How many versions were pushed since. Plain pushes nobody reviewed and no force push replaced leave no trace, so
   * this is a lower bound.
   */
  behind: number;
}

/**
 * Finds a reviewer's standing verdict: their latest approval or change request. A later plain comment doesn't
 * replace it, as on the reviewer rows; a dismissal ends it, and an earlier verdict doesn't come back.
 * @param versions Oldest first.
 * @param login The reviewer.
 * @returns The verdict and its version, or null when they never gave one, it was dismissed, or there are no versions.
 */
export function standingVerdict(versions: Version[], login: string): StandingVerdict | null {
  const current = versions.at(-1);
  if (!current) return null;
  const latest = reviewPath(versions, login).findLast(({ review }) => review.verdict !== "commented");
  if (!latest || latest.review.dismissed) return null;
  const { verdict } = latest.review;
  const version = versions[latest.version - 1];
  if (!version || (verdict !== "approved" && verdict !== "changes_requested")) return null;
  return { verdict, version, current, behind: current.number - version.number };
}

/**
 * @param standing The reviewer's standing verdict.
 * @returns What the reviewer row adds when the verdict is on an older version, like "approved v26 · 2 versions
 * ago", or null when it is on the current one.
 */
export function staleLabel(standing: StandingVerdict | null): string | null {
  if (!standing || standing.behind <= 0) return null;
  const said = standing.verdict === "approved" ? "approved" : "requested changes on";
  return `${said} v${standing.version.number} · ${plural(standing.behind, "version")} ago`;
}

/**
 * The range of what a reviewer hasn't seen, as the versions view's From and To take it.
 * @param standing The reviewer's standing verdict.
 * @returns The version they gave it on and the current one, or null when it is on the current one or there is none.
 */
export function unseenRange(standing: StandingVerdict | null): { from: number; to: number } | null {
  if (!standing || standing.behind <= 0) return null;
  return { from: standing.version.number, to: standing.current.number };
}

/**
 * @param pullUrl The pull request's URL, like `https://github.com/octocat/hello/pull/7`.
 * @param older The older compared version.
 * @param newer The newer compared version.
 * @returns A link that opens the Files changed tab with the versions view on the range. The range names commits, so it
 * survives versions being renumbered, and a newer side that is the head follows later pushes.
 */
export function versionsRangeUrl(pullUrl: string, older: Version, newer: Version): string {
  return `${pullUrl.replace(/\/+$/u, "")}/changes?${VERSIONS_PARAM}=${formatRangeParam(older, newer)}`;
}

/** A file the range changes, with its line counts. */
export interface RangeFileStat {
  path: string;
  additions: number;
  deletions: number;
}

/**
 * @param diff The versions view's comparison of the range.
 * @returns The files the range changes, leaving out those both versions change the same way.
 */
export function rangeFileStats(diff: FileInterdiff[]): RangeFileStat[] {
  return diff.filter((file) => file.change !== "unchanged").map((file) => ({ path: file.path, additions: file.added, deletions: file.removed }));
}

/**
 * Writes the comment that asks a reviewer to look again at what changed since their verdict.
 * @param login The reviewer.
 * @param standing Their standing verdict.
 * @param files The files changed since, or null when the comparison isn't known, which leaves only the version count.
 * @param url A link to the range in the versions view.
 * @returns The comment in Markdown, or null when the verdict is on the current version.
 */
export function pokeMessage(login: string, standing: StandingVerdict, files: RangeFileStat[] | null, url: string): string | null {
  if (standing.behind <= 0) return null;
  const since = standing.verdict === "approved" ? "Since your approval on" : "Since you requested changes on";
  // FloHub numbers the versions itself, which nobody reading the comment on GitHub can look up: the commit says it.
  const opening = `@${login} ${since} v${standing.version.number} (\`${standing.version.oid.slice(0, 7)}\`)`;
  const link = `[See what changed](${url})`;
  if (!files) return `${opening}, ${plural(standing.behind, "version")} ${standing.behind === 1 ? "was" : "were"} pushed. ${link}`;
  if (files.length === 0) return `${opening}: ${plural(standing.behind, "version")} pushed, with no file changes. ${link}`;
  const stat = formatDiffStat(
    files.reduce((sum, file) => sum + file.additions, 0),
    files.reduce((sum, file) => sum + file.deletions, 0),
  );
  const lines = stat ? ` (${[stat.added, stat.deleted].filter(Boolean).join(" ")})` : "";
  const named = files.slice(0, MAX_POKE_FILES).map((file) => code(file.path));
  const rest = files.length - named.length;
  const list = rest > 0 ? `${named.join(", ")} and ${rest} more` : named.join(", ");
  return `${opening}: ${plural(files.length, "file")} changed${lines}: ${list}. ${link}`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** @returns The text as inline code, with a longer fence when it holds a backtick itself. */
function code(text: string): string {
  return text.includes("`") ? `\`\` ${text} \`\`` : `\`${text}\``;
}
