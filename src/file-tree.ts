import { icon } from "./dom";
import { send } from "./messages";
import { type PullRef, pullKey } from "./pull-ref";
import { diffAnchor, matchPath, stateFromCheckbox, type ViewedState } from "./viewed";

const TREE = '[role="tree"]';
const ITEM = '[role="treeitem"]';
const TOGGLE = "flohub-viewed";
const ANCHOR_ID = /diff-[0-9a-f]{64}/;
const USER_CONTENT = ".markdown-body, .comment-body, .js-comment-body";
const STATE_LABEL: Record<ViewedState, string> = {
  VIEWED: "Viewed",
  UNVIEWED: "Not viewed",
  DISMISSED: "Changed since you viewed it",
};

const STYLES = `
li[data-flohub-file] { position: relative; }
li[data-flohub-file] > [data-flohub-row] { padding-right: 32px !important; }
[data-flohub-viewed="VIEWED"] > [data-flohub-row] { opacity: 0.55; }
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
  anchors: Map<string, string>;
  pathAnchors: Map<string, string>;
}

/**
 * Shows the viewer's Viewed mark on every file in the Files changed tree, with a checkbox to change it.
 * The page's own checkbox wins whenever it is rendered, so both stay in step.
 */
export class ViewedTree {
  private loaded: Loaded | null = null;
  private loadingKey: string | null = null;
  private failedKey: string | null = null;
  private generation = 0;
  private readonly busy = new Set<string>();

  constructor(private readonly notify: (message: string) => void) {}

  /**
   * Decorates the tree on the current page, fetching the viewed states once per pull request.
   * @param ref The pull request on screen, or null to drop the states.
   */
  sync(ref: PullRef | null): void {
    const tree = ref && document.querySelector(TREE);
    if (!ref || !tree) {
      if (!ref) this.reset();
      return;
    }
    const key = pullKey(ref);
    if (this.loaded?.key !== key && this.loadingKey !== key && this.failedKey !== key) void this.load(ref);
    if (this.loaded?.key === pullKey(ref)) this.decorate(tree, this.loaded);
  }

  /** @param ref The pull request to fetch the viewed states again for, if they were requested before. */
  refresh(ref: PullRef): void {
    const key = pullKey(ref);
    if ((this.loaded?.key === key || this.failedKey === key) && this.loadingKey !== key) void this.load(ref);
  }

  private reset(): void {
    this.loaded = null;
    this.loadingKey = null;
    this.failedKey = null;
    this.generation++;
    this.busy.clear();
  }

  private async load(ref: PullRef): Promise<void> {
    const key = pullKey(ref);
    const run = ++this.generation;
    this.loadingKey = key;
    const reply = await send({ type: "viewed-files", ref });
    if (run !== this.generation) return;
    this.loadingKey = null;
    if (!reply.ok) {
      if (this.loaded?.key !== key) {
        this.failedKey = key;
        this.notify(reply.message);
      }
      return;
    }
    this.failedKey = null;
    const states = new Map(reply.value.files.map((file) => [file.path, file.viewerViewedState]));
    for (const path of this.busy) {
      const pending = this.loaded?.states.get(path);
      if (pending) states.set(path, pending);
    }
    const paths = [...states.keys()];
    const anchors = await Promise.all(paths.map(diffAnchor));
    if (run !== this.generation) return;
    this.loaded = {
      key,
      pullRequestId: reply.value.pullRequestId,
      states,
      anchors: new Map(anchors.map((anchor, index) => [anchor, paths[index] as string])),
      pathAnchors: new Map(paths.map((path, index) => [path, anchors[index] as string])),
    };
    const tree = document.querySelector(TREE);
    if (tree) this.decorate(tree, this.loaded);
  }

  private decorate(tree: Element, loaded: Loaded): void {
    ensureStyles();
    const files = new Map<Element, string>();
    for (const item of tree.querySelectorAll(ITEM)) {
      if (isFolder(item)) continue;
      const path = resolvePath(item, loaded);
      if (path) files.set(item, path);
    }

    for (const [item, path] of files) {
      const checkbox = pageCheckbox(path, loaded);
      if (checkbox && !this.busy.has(path)) {
        loaded.states.set(path, stateFromCheckbox(isChecked(checkbox), loaded.states.get(path)));
      }
      this.decorateFile(item, path, loaded.states.get(path) ?? "UNVIEWED");
    }

    for (const folder of tree.querySelectorAll(ITEM)) {
      if (!isFolder(folder)) continue;
      const inside = [...folder.querySelectorAll(ITEM)].filter((item) => files.has(item));
      const allViewed =
        inside.length > 0 && inside.every((item) => loaded.states.get(files.get(item) as string) === "VIEWED");
      setAttribute(folder, "data-flohub-viewed", allViewed ? "VIEWED" : null);
      const row = rowOf(folder);
      if (row) setAttribute(row, "data-flohub-row", allViewed ? "" : null);
    }
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
    setAttribute(toggle, "data-path", path);
    setAttribute(toggle, "data-state", state);
    setAttribute(toggle, "aria-checked", String(state === "VIEWED"));
    setAttribute(toggle, "aria-busy", this.busy.has(path) ? "true" : null);
    setAttribute(toggle, "aria-label", `Viewed: ${name}`);
    setAttribute(toggle, "title", `${STATE_LABEL[state]}. Click to mark as ${state === "VIEWED" ? "not viewed" : "viewed"}.`);
  }

  private async toggle(path: string): Promise<void> {
    const loaded = this.loaded;
    if (!loaded || this.busy.has(path)) return;
    const viewed = loaded.states.get(path) !== "VIEWED";

    const checkbox = pageCheckbox(path, loaded);
    if (checkbox) {
      if (isChecked(checkbox) !== viewed) checkbox.click();
      this.redecorate();
      return;
    }

    const previous = loaded.states.get(path);
    loaded.states.set(path, viewed ? "VIEWED" : "UNVIEWED");
    this.busy.add(path);
    this.redecorate();
    const reply = await send({ type: "set-viewed", pullRequestId: loaded.pullRequestId, path, viewed });
    this.busy.delete(path);
    if (this.loaded !== loaded) return;
    if (!reply.ok) {
      if (previous) loaded.states.set(path, previous);
      else loaded.states.delete(path);
      this.notify(`Could not mark ${path} as ${viewed ? "viewed" : "not viewed"}: ${reply.message}`);
    }
    this.redecorate();
  }

  private redecorate(): void {
    const tree = document.querySelector(TREE);
    if (tree && this.loaded) this.decorate(tree, this.loaded);
  }
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
    if (child instanceof HTMLElement && !child.hidden && child.getAttribute("role") !== "group" && child.localName !== TOGGLE) {
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
  const filterText = item.querySelector(":scope > [data-filterable-item-text]")?.textContent?.trim();
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
  return matchPath(labels.join("/"), loaded.states.keys());
}

function labelOf(item: Element): string {
  const labelledBy = item.getAttribute("aria-labelledby")?.split(" ")[0];
  const row = rowOf(item);
  const label =
    (labelledBy && document.getElementById(labelledBy)) ||
    row?.querySelector('.ActionList-item-label, [class*="TreeView-item-content-text"]') ||
    row;
  return label?.textContent?.trim() ?? "";
}

/**
 * Finds the page's own Viewed control for a file, when its diff is rendered.
 * @returns A checkbox, a toggle button or a checkbox role element, or null.
 */
function pageCheckbox(path: string, loaded: Loaded): HTMLElement | null {
  const anchor = loaded.pathAnchors.get(path);
  const container =
    (anchor && document.getElementById(anchor)) ||
    document.querySelector(`.file-header[data-path="${CSS.escape(path)}"]`)?.closest(".file");
  if (!container) return null;
  const classic = container.querySelector<HTMLElement>("input.js-reviewed-checkbox");
  if (classic) return classic;
  const candidates = container.querySelectorAll<HTMLElement>('input[type="checkbox"], button[aria-pressed], [role="checkbox"]');
  return (
    [...candidates].find(
      (candidate) => candidate.localName !== TOGGLE && !candidate.closest(USER_CONTENT) && /\bviewed\b/i.test(accessibleText(candidate)),
    ) ?? null
  );
}

function accessibleText(element: HTMLElement): string {
  return element.getAttribute("aria-label") ?? element.closest("label")?.textContent ?? element.textContent ?? "";
}

function isChecked(control: HTMLElement): boolean {
  if (control instanceof HTMLInputElement) return control.checked;
  return control.getAttribute("aria-pressed") === "true" || control.getAttribute("aria-checked") === "true";
}
