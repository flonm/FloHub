import { icon } from "./dom";
import { send } from "../api/messages";
import { type PullRef, pullKey } from "../core/pull-ref";
import { type DiffStat, diffAnchor, formatDiffStat, matchPath, stateFromCheckbox, type ViewedState } from "../core/viewed";

const TREE = '[role="tree"][aria-label*="file" i]';
const ITEM = '[role="treeitem"]';
const TOGGLE = "flohub-viewed";
const DIFFSTAT = "flohub-diffstat";
const STAT_CHARS = "--flohub-stat-chars";
const ANCHOR_ID = /diff-[0-9a-f]{64}/u;
const VIEWED_NAME = /^(not |mark as |unmark as )?viewed$/iu;
const USER_CONTENT = ".markdown-body, .comment-body, .js-comment-body";
const STATE_LABEL: Record<ViewedState, string> = {
  VIEWED: "Viewed",
  UNVIEWED: "Not viewed",
  DISMISSED: "Changed since you viewed it",
};

const STYLES = `
li[data-flohub-file] { position: relative; }
li[data-flohub-file] > [data-flohub-row] { padding-right: calc(var(${STAT_CHARS}, 0) * 1ch + 40px) !important; }
[data-flohub-viewed="VIEWED"] > [data-flohub-row],
[data-flohub-viewed="VIEWED"] > ${DIFFSTAT} { opacity: 0.55; }
${DIFFSTAT} {
  position: absolute;
  top: 50%;
  right: 32px;
  display: flex;
  gap: 4px;
  transform: translateY(-50%);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  white-space: nowrap;
}
${DIFFSTAT} .added { color: var(--fgColor-success, #1a7f37); }
${DIFFSTAT} .deleted { color: var(--fgColor-danger, #d1242f); }
${TOGGLE} {
  position: absolute;
  top: 50%;
  right: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-top: -8px;
  border: 1px solid var(--borderColor-default, #d1d9e0);
  border-radius: 4px;
  background: var(--bgColor-default, #ffffff);
  color: var(--fgColor-onEmphasis, #ffffff);
  cursor: pointer;
}
${TOGGLE}:hover { border-color: var(--fgColor-muted, #59636e); }
${TOGGLE}[aria-checked="true"] {
  border-color: var(--bgColor-accent-emphasis, #0969da);
  background: var(--bgColor-accent-emphasis, #0969da);
}
${TOGGLE}[data-state="DISMISSED"] { border-color: var(--fgColor-attention, #9a6700); }
${TOGGLE}[data-state="DISMISSED"]::after {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--fgColor-attention, #9a6700);
}
${TOGGLE}[aria-busy="true"] { opacity: 0.5; cursor: progress; }
${TOGGLE} svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
${TOGGLE}:not([aria-checked="true"]) svg { display: none; }
`;

interface Loaded {
  key: string;
  pullRequestId: string;
  states: Map<string, ViewedState>;
  stats: Map<string, DiffStat | null>;
  anchors: Map<string, string>;
  pathAnchors: Map<string, string>;
  byName: Map<string, string[]>;
}

/**
 * Shows the viewer's Viewed mark on every file in the Files changed tree, with a checkbox to change it.
 * When the page's own Viewed control changes, the tree follows it.
 */
export class ViewedTree {
  private loaded: Loaded | null = null;
  private loadingKey: string | null = null;
  private failedKey: string | null = null;
  private generation = 0;
  private readonly busy = new Set<string>();
  /** When the tree last changed each path through the API, so an older refetch cannot undo it. */
  private readonly changedAt = new Map<string, number>();
  /** The last state seen on each file's page control, so a re-rendered control only counts when it changed. */
  private readonly seen = new Map<string, boolean>();

  constructor(private readonly notify: (message: string) => void) {}

  /**
   * Decorates the tree on the current page, fetching the viewed states once per pull request.
   * @param ref The pull request on screen, or null to drop the states.
   */
  sync(ref: PullRef | null): void {
    if (!ref) {
      this.reset();
      return;
    }
    const tree = findTree();
    if (!tree) return;
    const key = pullKey(ref);
    if (this.loaded?.key !== key && this.loadingKey !== key && this.failedKey !== key) void this.load(ref);
    if (this.loaded?.key === key) this.decorate(tree, this.loaded);
  }

  /** @param ref The pull request to fetch the viewed states again for, if they were requested before. */
  refresh(ref: PullRef): void {
    const key = pullKey(ref);
    if ((this.loaded?.key === key || this.failedKey === key) && this.loadingKey !== key) void this.load(ref);
  }

  private reset(): void {
    if (!this.loaded && !this.loadingKey && !this.failedKey) return;
    this.loaded = null;
    this.loadingKey = null;
    this.failedKey = null;
    this.generation++;
    this.busy.clear();
    this.changedAt.clear();
    this.seen.clear();
    for (const element of document.querySelectorAll(`${TOGGLE}, ${DIFFSTAT}`)) element.remove();
    const tree = findTree();
    if (tree instanceof HTMLElement) tree.style.removeProperty(STAT_CHARS);
    for (const element of document.querySelectorAll("[data-flohub-file], [data-flohub-viewed], [data-flohub-row]")) {
      clearDecoration(element);
    }
  }

  private async load(ref: PullRef): Promise<void> {
    const key = pullKey(ref);
    const run = ++this.generation;
    const startedAt = performance.now();
    this.loadingKey = key;
    const reply = await send({ type: "viewed-files", ref });
    if (run !== this.generation) return;
    if (!reply.ok) {
      this.loadingKey = null;
      if (this.loaded?.key !== key && this.failedKey !== key) this.notify(reply.message);
      if (this.loaded?.key !== key) this.failedKey = key;
      return;
    }
    const states = new Map(reply.value.files.map((file) => [file.path, file.viewerViewedState]));
    const previous = this.loaded?.key === key ? this.loaded.states : null;
    for (const [path, at] of this.changedAt) {
      const local = previous?.get(path);
      if (local && (this.busy.has(path) || at >= startedAt)) states.set(path, local);
    }
    const paths = [...states.keys()];
    const anchors = await Promise.all(paths.map(async (path) => [path, await diffAnchor(path)] as const));
    if (run !== this.generation) return;
    this.loadingKey = null;
    this.failedKey = null;
    const byName = new Map<string, string[]>();
    for (const path of paths) {
      const name = path.slice(path.lastIndexOf("/") + 1);
      byName.set(name, [...(byName.get(name) ?? []), path]);
    }
    this.loaded = {
      key,
      pullRequestId: reply.value.pullRequestId,
      states,
      stats: new Map(reply.value.files.map((file) => [file.path, formatDiffStat(file.additions, file.deletions)])),
      anchors: new Map(anchors.map(([path, anchor]) => [anchor, path])),
      pathAnchors: new Map(anchors),
      byName,
    };
    this.redecorate();
  }

  private decorate(tree: Element, loaded: Loaded): void {
    ensureStyles();
    const widest = Math.max(0, ...[...loaded.stats.values()].map((stat) => stat?.width ?? 0));
    if (tree instanceof HTMLElement && tree.style.getPropertyValue(STAT_CHARS) !== String(widest)) {
      tree.style.setProperty(STAT_CHARS, String(widest));
    }
    const headers = new Map<string, Element>();
    for (const header of document.querySelectorAll<HTMLElement>(".file-header[data-path]")) {
      headers.set(header.dataset.path ?? "", header);
    }

    const files = new Map<Element, string>();
    for (const item of tree.querySelectorAll(ITEM)) {
      if (isFolder(item)) continue;
      const path = resolvePath(item, loaded);
      if (path) files.set(item, path);
      else clearDecoration(item);
    }

    for (const [item, path] of files) {
      const control = pageControl(path, loaded, headers);
      if (control && !this.busy.has(path)) this.followControl(control, path, loaded);
      this.decorateFile(item, path, loaded.states.get(path) ?? "UNVIEWED");
      decorateDiffStat(item, loaded.stats.get(path) ?? null);
    }

    for (const folder of tree.querySelectorAll(ITEM)) {
      if (!isFolder(folder)) continue;
      const inside = [...folder.querySelectorAll(ITEM)].flatMap((item) => files.get(item) ?? []);
      const allViewed = inside.length > 0 && inside.every((path) => loaded.states.get(path) === "VIEWED");
      setAttribute(folder, "data-flohub-viewed", allViewed ? "VIEWED" : null);
      const row = rowOf(folder);
      if (row) setAttribute(row, "data-flohub-row", allViewed ? "" : null);
    }
  }

  /**
   * Keeps the tree and the page's Viewed control for one file in step. A control that appears after the tree
   * changed the file through the API may come from the page's stale cache, so the tree clicks it into line.
   * Otherwise the control's state wins whenever it is new or changed.
   */
  private followControl(control: HTMLElement, path: string, loaded: Loaded): void {
    const checked = isChecked(control);
    const before = this.seen.get(path);
    this.seen.set(path, checked);
    if (before === undefined && this.changedAt.has(path)) {
      this.changedAt.delete(path);
      if (checked !== (loaded.states.get(path) === "VIEWED")) control.click();
      return;
    }
    if (before === checked) return;
    loaded.states.set(path, stateFromCheckbox(checked, loaded.states.get(path)));
    this.changedAt.delete(path);
  }

  private decorateFile(item: Element, path: string, state: ViewedState): void {
    const row = rowOf(item);
    if (!row) return;
    setAttribute(item, "data-flohub-file", "");
    setAttribute(item, "data-flohub-viewed", state);
    setAttribute(row, "data-flohub-row", "");

    let toggle = item.querySelector<HTMLElement>(`:scope > ${TOGGLE}`);
    if (!toggle) {
      toggle = document.createElement(TOGGLE);
      toggle.setAttribute("role", "checkbox");
      toggle.append(icon("check"));
      toggle.addEventListener("pointerdown", (event) => event.stopPropagation());
      toggle.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const current = toggle?.dataset.path;
        if (current) void this.toggle(current);
      });
      item.append(toggle);
    }
    const name = path.split("/").at(-1) ?? path;
    const changed = state === "DISMISSED" ? ", changed since you viewed it" : "";
    setAttribute(toggle, "data-path", path);
    setAttribute(toggle, "data-state", state);
    setAttribute(toggle, "aria-checked", String(state === "VIEWED"));
    setAttribute(toggle, "aria-busy", this.busy.has(path) ? "true" : null);
    setAttribute(toggle, "aria-label", `Viewed: ${name}${changed}`);
    setAttribute(toggle, "title", `${STATE_LABEL[state]}. Click to mark as ${state === "VIEWED" ? "not viewed" : "viewed"}.`);
  }

  /**
   * The pull request's files with the viewer's Viewed marks, for U and ⇧U.
   * @param ref The pull request on screen.
   * @returns Each file's path, the id of its diff on the page and its mark; null until they are fetched.
   */
  files(ref: PullRef): { path: string; anchor: string; state: ViewedState }[] | null {
    const { loaded } = this;
    if (loaded?.key !== pullKey(ref)) return null;
    return [...loaded.states]
      .map(([path, state]) => ({ path, anchor: loaded.pathAnchors.get(path) ?? "", state }))
      .filter((file) => file.anchor !== "");
  }

  /** @param path A file to mark as viewed, unless it is already. */
  async markViewed(path: string): Promise<void> {
    if (this.loaded?.states.get(path) !== "VIEWED") await this.toggle(path);
  }

  private async toggle(path: string): Promise<void> {
    const { loaded } = this;
    if (!loaded || this.busy.has(path) || !loaded.states.has(path)) return;
    const viewed = loaded.states.get(path) !== "VIEWED";

    const control = pageControl(path, loaded);
    if (control) {
      this.seen.set(path, isChecked(control));
      if (isChecked(control) !== viewed) control.click();
      this.redecorate();
      return;
    }

    const previous = loaded.states.get(path) ?? "UNVIEWED";
    loaded.states.set(path, viewed ? "VIEWED" : "UNVIEWED");
    this.busy.add(path);
    this.changedAt.set(path, performance.now());
    this.redecorate();
    const reply = await send({ type: "set-viewed", pullRequestId: loaded.pullRequestId, path, viewed });
    const current = this.loaded?.key === loaded.key ? this.loaded : null;
    if (!current) return;
    this.busy.delete(path);
    if (reply.ok) {
      this.changedAt.set(path, performance.now());
    } else {
      current.states.set(path, previous);
      this.changedAt.delete(path);
      this.notify(`Could not mark ${path} as ${viewed ? "viewed" : "not viewed"}: ${reply.message}`);
    }
    this.redecorate();
  }

  private redecorate(): void {
    const tree = findTree();
    if (tree && this.loaded) this.decorate(tree, this.loaded);
  }
}

/** The Files changed tree; other trees on the page are left alone. */
function findTree(): Element | null {
  return document.querySelector(TREE);
}

/** Shows a file's added and deleted line counts left of its Viewed checkbox, right-aligned in a column as wide as the widest count. */
function decorateDiffStat(item: Element, stat: DiffStat | null): void {
  let element = item.querySelector<HTMLElement>(`:scope > ${DIFFSTAT}`);
  if (!stat) {
    element?.remove();
    return;
  }
  if (!element) {
    element = document.createElement(DIFFSTAT);
    element.setAttribute("aria-hidden", "true");
    item.append(element);
  }
  const text = `${stat.added ?? ""} ${stat.deleted ?? ""}`;
  if (element.dataset.text !== text) {
    element.dataset.text = text;
    element.replaceChildren();
    if (stat.added) element.append(Object.assign(document.createElement("span"), { className: "added", textContent: stat.added }));
    if (stat.deleted) element.append(Object.assign(document.createElement("span"), { className: "deleted", textContent: stat.deleted }));
  }
  setAttribute(element, "title", stat.label);
}

function clearDecoration(element: Element): void {
  element.querySelector(`:scope > ${TOGGLE}`)?.remove();
  element.querySelector(`:scope > ${DIFFSTAT}`)?.remove();
  setAttribute(element, "data-flohub-file", null);
  setAttribute(element, "data-flohub-viewed", null);
  const row = rowOf(element);
  if (row) setAttribute(row, "data-flohub-row", null);
  setAttribute(element, "data-flohub-row", null);
}

function ensureStyles(): void {
  if (document.getElementById("flohub-viewed-styles")) return;
  const style = document.createElement("style");
  style.id = "flohub-viewed-styles";
  style.textContent = STYLES;
  document.head.append(style);
}

/** Writes an attribute only when it changes, so decorating never feeds the page's mutation observers. */
function setAttribute(element: Element, name: string, value: string | null): void {
  if (element.getAttribute(name) === value) return;
  // eslint-disable-next-line unicorn/prefer-toggle-attribute -- the value is a string, not a flag
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

/** Classic folders hold their children; React folders carry aria-expanded even when collapsed and empty. */
function isFolder(item: Element): boolean {
  return item.hasAttribute("aria-expanded") || item.querySelector(ITEM) !== null;
}

/** @returns The tree item's visible row: its first child that is neither hidden, a nested group nor ours. */
function rowOf(item: Element): HTMLElement | null {
  for (const child of item.children) {
    if (child instanceof HTMLElement && child.hidden === false && child.getAttribute("role") !== "group" && child.localName !== TOGGLE && child.localName !== DIFFSTAT) {
      return child;
    }
  }
  return null;
}

/**
 * Works out which changed file a tree item stands for, from the most to the least specific hint:
 * the full path GitHub keeps for filtering, a `diff-<sha256>` id or link, an id equal to the path,
 * and last the labels from the root down to the item.
 */
function resolvePath(item: Element, loaded: Loaded): string | null {
  const filterText = item.querySelector(":scope > [data-filterable-item-text]")?.textContent.trim();
  if (filterText && loaded.states.has(filterText)) return filterText;

  const anchorSource = `${item.id} ${item.querySelector(':scope a[href*="#diff-"]')?.getAttribute("href") ?? ""}`;
  const anchor = ANCHOR_ID.exec(anchorSource)?.[0];
  const byAnchor = anchor && loaded.anchors.get(anchor);
  if (byAnchor) return byAnchor;

  if (item.id && loaded.states.has(item.id)) return item.id;

  const labels: string[] = [];
  for (let node: Element | null = item; node; node = node.parentElement?.closest(ITEM) ?? null) {
    const label = labelOf(node);
    if (!label) return null;
    labels.unshift(label);
  }
  return matchPath(labels.join("/"), loaded.byName.get(labels.at(-1) ?? "") ?? []);
}

function labelOf(item: Element): string {
  const labelledBy = item.getAttribute("aria-labelledby")?.split(" ", 1)[0];
  const row = rowOf(item);
  const byId = labelledBy ? document.getElementById(labelledBy) : null;
  const label = byId ?? row?.querySelector('.ActionList-item-label, [class*="TreeView-item-content-text"]') ?? row;
  return label?.textContent.trim() ?? "";
}

/**
 * Finds the page's own Viewed control for a file, when its diff is rendered.
 * @returns A checkbox, a toggle button or a checkbox role element, or null.
 */
function pageControl(path: string, loaded: Loaded, headers?: Map<string, Element>): HTMLElement | null {
  const anchor = loaded.pathAnchors.get(path);
  const header = headers ? headers.get(path) : document.querySelector(`.file-header[data-path="${CSS.escape(path)}"]`);
  const container = (anchor ? document.getElementById(anchor) : null) ?? header?.closest(".file");
  if (!container) return null;
  const classic = container.querySelector<HTMLElement>("input.js-reviewed-checkbox");
  if (classic) return classic;
  const candidates = container.querySelectorAll<HTMLElement>('input[type="checkbox"], button[aria-pressed], [role="checkbox"]');
  return (
    [...candidates].find(
      (candidate) => candidate.localName !== TOGGLE && !candidate.closest(USER_CONTENT) && VIEWED_NAME.test(accessibleText(candidate)),
    ) ?? null
  );
}

function accessibleText(element: HTMLElement): string {
  return (element.getAttribute("aria-label") ?? element.closest("label")?.textContent ?? element.textContent).trim();
}

function isChecked(control: HTMLElement): boolean {
  if (control instanceof HTMLInputElement) return control.checked;
  return control.getAttribute("aria-pressed") === "true" || control.getAttribute("aria-checked") === "true";
}
