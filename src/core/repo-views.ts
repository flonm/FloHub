import { type Inbox, type InboxCategory, inboxCategories, type InboxGroup, type InboxSection, SECTION_CATEGORIES } from "./inbox";
import { applyMarks, type InboxMarks } from "./inbox-marks";
import type { RepoRef } from "./pull-ref";

/**
 * The inbox's views FloHub adds to the sidebar of a repository's pull request list, where GitHub's own search can't
 * tell why a pull request waits.
 */
export type RepoView = "your-turn" | "rerequested" | "their-turn" | "reviewed";

/** What a view shows: its sidebar label, the popup section it comes from and the categories it draws. */
export interface RepoViewSpec {
  title: string;
  section: InboxSection;
  categories: readonly InboxCategory[];
}

/** The views in the sidebar's order. Re-requested shows under Your turn as well, since it's the most pressing part of it. */
export const REPO_VIEWS: Record<RepoView, RepoViewSpec> = {
  "your-turn": { title: "Your turn", section: "you", categories: SECTION_CATEGORIES.you },
  rerequested: { title: "Re-requested", section: "you", categories: ["rerequested"] },
  "their-turn": { title: "Their turn", section: "them", categories: SECTION_CATEGORIES.them },
  reviewed: { title: "Reviewed by others", section: "reviewed", categories: SECTION_CATEGORIES.reviewed },
};

export const REPO_VIEWS_IN_ORDER = Object.keys(REPO_VIEWS) as RepoView[];

const HASH_PREFIX = "#flohub=";

/**
 * The open view lives in the address's fragment, which GitHub's router leaves alone, so a reload keeps it and any of
 * GitHub's own links drops it.
 * @param hash The address's fragment, with its `#`.
 * @returns The view it names, or null for GitHub's own list.
 */
export function viewFromHash(hash: string): RepoView | null {
  if (!hash.startsWith(HASH_PREFIX)) return null;
  const name = hash.slice(HASH_PREFIX.length);
  return Object.hasOwn(REPO_VIEWS, name) ? (name as RepoView) : null;
}

/**
 * @param view A view.
 * @returns The fragment that opens it.
 */
export function hashFor(view: RepoView): string {
  return `${HASH_PREFIX}${view}`;
}

/**
 * @param inbox The whole inbox.
 * @param ref A repository.
 * @returns The inbox with only that repository's pull requests, its review count redone.
 */
export function repoInbox(inbox: Inbox, ref: RepoRef): Inbox {
  const name = `${ref.owner}/${ref.repo}`.toLowerCase();
  const keep = (groups: InboxGroup[]) => groups.filter((entry) => entry.repo.toLowerCase() === name);
  const review = keep(inbox.review);
  return {
    ...inbox,
    review,
    mine: keep(inbox.mine),
    ...(inbox.waiting && { waiting: keep(inbox.waiting) }),
    ...(inbox.other && { other: keep(inbox.other) }),
    reviewCount: review.reduce((sum, entry) => sum + entry.pulls.length, 0),
  };
}

/**
 * @param inbox The inbox, already narrowed to one repository.
 * @param marks The viewer's marks.
 * @param now The current time in epoch milliseconds.
 * @returns How many pull requests each view shows, leaving out the snoozed ones as the popup's counts do.
 */
export function repoViewCounts(inbox: Inbox, marks: InboxMarks, now: number): Record<RepoView, number> {
  const categories = inboxCategories(inbox);
  const count = (category: InboxCategory) =>
    applyMarks(categories[category], marks, now).groups.reduce((sum, entry) => sum + entry.pulls.length, 0);
  return Object.fromEntries(
    REPO_VIEWS_IN_ORDER.map((view) => [view, REPO_VIEWS[view].categories.reduce((sum, category) => sum + count(category), 0)]),
  ) as Record<RepoView, number>;
}

/** GitHub's own sidebar lists, each under `/<owner>/<repo>/pulls/<list>/<login>`. */
const SIDEBAR_LISTS = new Set(["authored", "assigned", "involves", "review-requested"]);

/**
 * @param pathname A link's path.
 * @param ref The repository whose pull request list shows the link.
 * @returns Whether it's one of the sidebar's own lists, which FloHub's views go below.
 */
export function isSidebarList(pathname: string, ref: RepoRef): boolean {
  const [, owner, repo, pulls, list, login, ...rest] = pathname.split("/");
  return (
    owner?.toLowerCase() === ref.owner.toLowerCase() &&
    repo?.toLowerCase() === ref.repo.toLowerCase() &&
    pulls === "pulls" &&
    list !== undefined &&
    SIDEBAR_LISTS.has(list) &&
    Boolean(login) &&
    rest.length === 0
  );
}
