import { el, icon, type IconName } from "./dom";
import { REPO_PULLS_STYLES } from "./bar-styles";
import { type InboxViewActions, type InboxViewState, renderInbox, updatedLabel } from "./inbox-view";
import type { RepoRef } from "../core/pull-ref";
import { hashFor, isSidebarList, REPO_VIEWS, REPO_VIEWS_IN_ORDER, type RepoView } from "../core/repo-views";

/** What the views on a repository's pull request list show. */
export interface RepoPullsState {
  /** The view the address opens, or null while GitHub's own list shows. */
  view: RepoView | null;
  /** How many pull requests each view holds, or null until the inbox is there. */
  counts: Record<RepoView, number> | null;
  /** The inbox narrowed to the repository, as the list draws it; its `view` is set from the one above. */
  inbox: Omit<InboxViewState, "view">;
}

const VIEW_ICONS: Record<RepoView, IconName> = {
  "your-turn": "target",
  rerequested: "sync",
  "their-turn": "clock",
  reviewed: "people",
};

/** Marks GitHub's own list while a view hides it. */
const HIDDEN_MARK = "data-flohub-hidden";
const HIDDEN = "[data-flohub-hidden]";
/** GitHub's list of pull requests, with its open and closed tabs and its toolbar. */
const GITHUB_LIST = '[id$="-list-view-container"]';

/**
 * @param view The view that's open, or null.
 * @param counts How many pull requests each view holds, or null while they load.
 * @returns The sidebar's group of FloHub's views, each a link to its fragment.
 */
function renderViewLinks(view: RepoView | null, counts: Record<RepoView, number> | null): HTMLElement {
  const nav = el("nav", { class: "views", "aria-labelledby": "flohub-views-title" });
  const list = el("ul");
  for (const name of REPO_VIEWS_IN_ORDER) {
    const link = el("a", { class: "view-link", href: hashFor(name), "data-view": name });
    if (name === view) link.setAttribute("aria-current", "page");
    link.append(icon(VIEW_ICONS[name]), el("span", { class: "view-name" }, REPO_VIEWS[name].title));
    if (counts) {
      const count = el("span", { class: "view-count" }, String(counts[name]));
      if (counts[name] > 0) count.dataset.some = "";
      link.append(count);
    }
    const item = el("li");
    item.append(link);
    list.append(item);
  }
  nav.append(el("h2", { class: "views-title", id: "flohub-views-title" }, "FloHub"), list);
  return nav;
}

/**
 * @param view The open view.
 * @param state What the list shows.
 * @param actions What the rows do.
 * @returns The list that stands in for GitHub's while a view is open.
 */
function renderViewList(view: RepoView, state: RepoPullsState["inbox"], actions: InboxViewActions): HTMLElement {
  const spec = REPO_VIEWS[view];
  // A region rather than a section, which the popup's styles pad as one of its own.
  const box = el("div", { class: "list", role: "region", "aria-labelledby": "flohub-list-title" });
  const header = el("div", { class: "list-header" });
  header.append(el("h2", { class: "list-title", id: "flohub-list-title" }, spec.title));
  if (state.inbox) {
    const updated = updatedLabel(state.inbox.fetchedAt, state.now ?? Date.now());
    header.append(el("span", { class: "list-updated" }, updated));
  }
  box.append(header, ...renderInbox({ ...state, view: spec }, actions));
  return box;
}

/**
 * FloHub's views on a repository's pull request list: a group of links below the sidebar's own lists, and, while one
 * is open, its list in place of GitHub's. Both live in shadow roots inside GitHub's React page, so a re-render that
 * drops them only means mounting them again on the next sync.
 */
export class RepoPullsViews {
  readonly links = el("div", { "data-flohub": "repo-views" });
  readonly list = el("div", { "data-flohub": "repo-list" });
  private readonly linksBody = el("div");
  private readonly listBody = el("div");
  /** GitHub's sidebar link FloHub took the current mark from while a view is open. */
  private unmarked: Element | null = null;

  constructor(private readonly actions: InboxViewActions) {
    for (const [host, body] of [
      [this.links, this.linksBody],
      [this.list, this.listBody],
    ] as const) {
      host.attachShadow({ mode: "open" }).append(el("style", {}, REPO_PULLS_STYLES), body);
    }
  }

  /**
   * Draws what the views show, without touching GitHub's page.
   * @param state What to show.
   */
  render(state: RepoPullsState): void {
    this.linksBody.replaceChildren(renderViewLinks(state.view, state.counts));
    this.listBody.replaceChildren(...(state.view ? [renderViewList(state.view, state.inbox, this.actions)] : []));
  }

  /**
   * Puts the views where they go on GitHub's page, once it has the spots for them; cheap enough for every change to
   * the page.
   * @param ref The repository.
   * @param open Whether a view stands in for GitHub's list.
   */
  place(ref: RepoRef, open: boolean): void {
    if (!this.links.isConnected) findSidebarList(ref)?.after(this.links);
    this.markCurrent(open);
    if (!open) {
      this.showGithubList();
      return;
    }
    ensureHiddenStyle();
    const githubList = document.querySelector(GITHUB_LIST);
    if (!githubList) return;
    if (githubList.previousElementSibling !== this.list) githubList.before(this.list);
    if (!githubList.hasAttribute(HIDDEN_MARK)) githubList.setAttribute(HIDDEN_MARK, "");
  }

  /** Takes FloHub's views off the page and gives GitHub's list back. */
  remove(): void {
    this.markCurrent(false);
    this.showGithubList();
    this.links.remove();
  }

  private showGithubList(): void {
    this.list.remove();
    for (const hidden of document.querySelectorAll(HIDDEN)) hidden.removeAttribute(HIDDEN_MARK);
  }

  /**
   * GitHub keeps marking its own list as the current one while a view stands in for it, so FloHub takes the mark away
   * and gives it back after.
   * @param open Whether a view is open.
   */
  private markCurrent(open: boolean): void {
    if (!open) {
      if (this.unmarked?.getAttribute("aria-current") === "false") this.unmarked.setAttribute("aria-current", "page");
      this.unmarked = null;
      return;
    }
    const current = this.links.parentElement?.querySelector('a[aria-current="page"]');
    if (!current) return;
    current.setAttribute("aria-current", "false");
    this.unmarked = current;
  }
}

/**
 * @param ref The repository.
 * @returns The list in GitHub's sidebar that holds its own lists, like "Review requests", or null when the page has
 *   no sidebar, as for a visitor who isn't signed in.
 */
function findSidebarList(ref: RepoRef): Element | null {
  const link = [...document.querySelectorAll<HTMLAnchorElement>('a[href*="/pulls/"]')].find((candidate) =>
    isSidebarList(new URL(candidate.href, location.href).pathname, ref),
  );
  return link?.closest("ul") ?? null;
}

function ensureHiddenStyle(): void {
  if (document.getElementById("flohub-hidden")) return;
  document.head.append(Object.assign(document.createElement("style"), { id: "flohub-hidden", textContent: `${HIDDEN} { display: none !important; }` }));
}
