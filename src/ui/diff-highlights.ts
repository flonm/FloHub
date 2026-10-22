import { type FileMarks, markChanges, type RemovedLines } from "../core/diff-marks";
import { send } from "../api/messages";
import { isWholeFilesTab, type PullRef, pullKey } from "../core/pull-ref";
import { diffAnchor } from "../core/viewed";
import { baseCandidates, lastReviewedVersion, type Version } from "../core/versions";

/** What the highlights show, for the overview bar. */
export interface HighlightStatus {
  /** The version the viewer last reviewed, which the diff is compared with. */
  since: Version;
  current: Version;
  /** Files whose change is new or different since then. */
  changedFiles: number;
  /** Files the pull request no longer changes, which GitHub's diff can't show. */
  droppedFiles: string[];
  /** Whether GitHub cut a version's file list off, so files past the cut weren't compared. */
  truncated: boolean;
  hidden: boolean;
}

/** The commits the highlights depend on, from the overview. They're fetched again only when one of these changes. */
export interface HighlightSource {
  head: string;
  base: string;
  /** The commit of the viewer's latest review, or null when they haven't reviewed. */
  reviewed: string | null;
}

const CHANGED = "data-flohub-since";
const HOST = "data-flohub-since-host";
const BADGE = "flohub-since-badge";
const REMOVED = "flohub-removed";
const STYLE_ID = "flohub-since-styles";
const CACHE = "sinceCache";
const MAX_CACHED_PULLS = 20;
/** Line number cells: classic ones carry `id="diff-<hash>L12"`, React ones `data-diff-side` and `data-line-number`. */
const LINE_NUMBERS = "td.blob-num[id], td.new-diff-line-number[data-diff-side][data-line-number]";

const STYLES = `
[${CHANGED}] { box-shadow: inset 3px 0 0 var(--fgColor-attention, #9a6700); }
[${HOST}] { position: relative; padding-right: 28px !important; }
${BADGE} {
  display: inline-flex;
  align-items: center;
  margin-left: 8px;
  padding: 0 8px;
  border: 1px solid currentColor;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  line-height: 18px;
  white-space: nowrap;
}
${BADGE}[data-change="changed"] { color: var(--fgColor-attention, #9a6700); }
${BADGE}[data-change="added"] { color: var(--fgColor-success, #1a7f37); }
${BADGE}[data-change="unchanged"], ${BADGE}[data-change="opaque"] { color: var(--fgColor-muted, #59636e); }
${REMOVED} { position: absolute; right: 2px; bottom: 0; z-index: 2; }
${REMOVED}[data-before] { top: 0; bottom: auto; }
`;

const REMOVED_STYLES = `
:host { font: 12px/1.5 var(--fontStack-sansSerif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif); }
button {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}
.pill {
  padding: 0 5px;
  border-radius: 999px;
  background: var(--bgColor-danger-emphasis, #cf222e);
  color: var(--fgColor-onEmphasis, #ffffff);
  font-size: 10px;
  font-weight: 700;
  line-height: 14px;
}
button:focus-visible { outline: 2px solid var(--focus-outlineColor, #0969da); outline-offset: -2px; border-radius: 6px; }
.panel {
  position: fixed;
  inset: auto;
  margin: 0;
  width: max-content;
  min-width: 320px;
  max-width: min(720px, calc(100vw - 16px));
  max-height: 320px;
  overflow: auto;
  padding: 8px 0;
  border: 1px solid var(--borderColor-default, #d1d9e0);
  border-radius: 6px;
  background: var(--bgColor-default, #ffffff);
  color: var(--fgColor-default, #1f2328);
  box-shadow: var(--shadow-floating-large, 0 8px 24px rgba(140, 149, 159, 0.2));
}
p { margin: 0 12px 6px; color: var(--fgColor-muted, #59636e); }
pre { margin: 0; padding: 0 12px; font: 12px/20px ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre; }
.add { color: var(--fgColor-success, #1a7f37); }
.del { color: var(--fgColor-danger, #d1242f); }
`;

interface Loaded {
  /** The pull request and the commits the marks were computed from; see {@link loadKey}. */
  key: string;
  since: Version;
  current: Version;
  truncated: boolean;
  files: { anchor: string; marks: FileMarks }[];
}

/** What one file's last decoration left on the page, to tell whether GitHub re-rendered it since. */
interface Decorated {
  container: Element;
  rows: number;
  elements: Element[];
}

/**
 * Highlights, in GitHub's own Files changed diff, what changed since the version the viewer last reviewed, so
 * comments go through GitHub's own UI. Lines that are new or different get a bar on the left; lines the reviewed
 * version had and the current one dropped get a marker that lists them. Nothing shows until the viewer has reviewed
 * a version older than the current one.
 */
export class DiffHighlights {
  private loaded: Loaded | null = null;
  /** The key of the last load, settled or in flight, even when it found nothing to highlight. */
  private wanted: string | null = null;
  private generation = 0;
  private hidden = false;
  private readonly decorated = new Map<string, Decorated>();

  constructor(private readonly onStatus: (status: HighlightStatus | null) => void) {}

  /**
   * Highlights the marks on the whole pull request's Files changed tab. Cheap when nothing changed on the page.
   * @param ref The pull request on screen, or null.
   */
  sync(ref: PullRef | null): void {
    if (!ref || (this.wanted !== null && !this.wanted.startsWith(`${pullKey(ref)}|`))) {
      this.reset();
      return;
    }
    if (this.loaded && !this.hidden && isWholeFilesTab(location.pathname)) this.decorate(this.loaded);
  }

  /**
   * Loads the marks, unless they were loaded for the same commits before: from memory, or from storage.
   * @param ref The pull request.
   * @param source The commits from the overview.
   */
  update(ref: PullRef, source: HighlightSource): void {
    if (!source.reviewed || source.reviewed === source.head) {
      this.generation++;
      this.settle(loadKey(ref, source), null);
      return;
    }
    const key = loadKey(ref, source);
    if (key === this.wanted) return;
    this.wanted = key;
    void this.load(ref, key);
  }

  /** @param hidden Whether to take the highlights off the page, for this pull request. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (hidden) this.clear();
    this.report();
  }

  private reset(): void {
    if (this.wanted === null && !this.loaded) return;
    this.generation++;
    this.wanted = null;
    this.loaded = null;
    this.hidden = false;
    this.clear();
    this.onStatus(null);
  }

  private settle(key: string, loaded: Loaded | null): void {
    this.wanted = key;
    if (this.loaded?.key !== loaded?.key) this.clear();
    this.loaded = loaded;
    this.report();
  }

  private async load(ref: PullRef, key: string): Promise<void> {
    const run = ++this.generation;
    const cached = await readCache(pullKey(ref));
    if (run !== this.generation) return;
    if (cached?.key === key) {
      this.settle(key, cached);
      return;
    }
    const loaded = await compute(ref, key);
    if (run !== this.generation) return;
    this.settle(key, loaded);
    if (loaded) void writeCache(pullKey(ref), loaded);
  }

  private report(): void {
    const { loaded } = this;
    if (!loaded) {
      this.onStatus(null);
      return;
    }
    const differing = loaded.files.filter(({ marks }) => marks.change !== "unchanged");
    this.onStatus({
      since: loaded.since,
      current: loaded.current,
      changedFiles: differing.filter(({ marks }) => marks.change !== "dropped").length,
      droppedFiles: differing.filter(({ marks }) => marks.change === "dropped").map(({ marks }) => marks.path),
      truncated: loaded.truncated,
      hidden: this.hidden,
    });
  }

  private clear(): void {
    this.decorated.clear();
    for (const element of document.querySelectorAll(`${BADGE}, ${REMOVED}`)) element.remove();
    for (const element of document.querySelectorAll(`[${CSS.escape(CHANGED)}], [${CSS.escape(HOST)}]`)) {
      element.removeAttribute(CHANGED);
      element.removeAttribute("aria-description");
      element.removeAttribute(HOST);
    }
  }

  /**
   * Marks each file whose diff GitHub rendered or re-rendered since the last pass. A file is skipped while its region,
   * its row count and every mark on it are as left, so a pass over an unchanged page costs one check per file.
   */
  private decorate(loaded: Loaded): void {
    ensureStyles();
    const since = `v${loaded.since.number}`;
    for (const { anchor, marks } of loaded.files) {
      if (marks.change === "dropped") continue;
      const container = document.getElementById(anchor);
      if (!container) continue;
      const rows = container.getElementsByTagName("tr").length;
      const previous = this.decorated.get(anchor);
      if (previous?.container === container && previous.rows === rows && previous.elements.every((element) => element.isConnected)) {
        continue;
      }
      this.decorated.set(anchor, { container, rows, elements: decorateFile(container, anchor, marks, since) });
    }
  }
}

function loadKey(ref: PullRef, source: HighlightSource): string {
  return `${pullKey(ref)}|${source.reviewed}|${source.head}|${source.base}`;
}

async function compute(ref: PullRef, key: string): Promise<Loaded | null> {
  const versions = await send({ type: "versions", ref });
  if (!versions.ok) return null;
  const since = lastReviewedVersion(versions.value.versions);
  const current = versions.value.versions.at(-1);
  if (!since || !current) return null;
  const patch = async (version: Version) =>
    send({ type: "version-patch", ref, head: version.oid, bases: baseCandidates(versions.value, version) });
  const [before, after] = await Promise.all([patch(since), patch(current)]);
  if (!before.ok || !after.ok) return null;
  // Past GitHub's file limit, a file only one version lists may just be cut off from the other's list.
  const truncated = before.value.truncated || after.value.truncated;
  const marks = markChanges(before.value.files, after.value.files, { sameBase: before.value.mergeBase === after.value.mergeBase }).filter(
    (mark) => !truncated || (mark.change !== "added" && mark.change !== "dropped"),
  );
  const files = await Promise.all(marks.map(async (mark) => ({ anchor: await diffAnchor(mark.path), marks: mark })));
  return { key, since, current, truncated, files };
}

/**
 * Marks one file's rendered diff, looking each line up in one index of its line number cells.
 * @returns Every element the marks live on, to check later whether GitHub replaced them.
 */
function decorateFile(container: Element, anchor: string, marks: FileMarks, since: string): Element[] {
  const elements: Element[] = [];
  const header = container.querySelector<HTMLElement>(":scope .file-header .file-info, :scope [data-diff-header-wrapper] h3");
  if (header) elements.push(decorateBadge(header.tagName === "H3" ? (header.parentElement ?? header) : header, marks, since));

  const cells = indexCodeCells(container, anchor);
  const description = `Changed since your review (${since})`;
  for (const ref of marks.changed) {
    const cell = cells.get(`${ref.side}${ref.line}`);
    if (!cell) continue;
    if (cell.getAttribute(CHANGED) !== since) cell.setAttribute(CHANGED, since);
    if (cell.getAttribute("aria-description") !== description) cell.setAttribute("aria-description", description);
    elements.push(cell);
  }
  for (const [index, removed] of marks.removed.entries()) {
    const cell = removed.after ? cells.get(`${removed.after.side}${removed.after.line}`) : cells.values().next().value;
    if (cell) elements.push(decorateRemoved(cell, removed, `${anchor}:${index}`, since));
  }
  return elements;
}

/** @returns Each rendered line's code cell, keyed like `R12` or `L3`. */
function indexCodeCells(container: Element, anchor: string): Map<string, HTMLElement> {
  const cells = new Map<string, HTMLElement>();
  for (const number of container.querySelectorAll<HTMLElement>(LINE_NUMBERS)) {
    const side = number.dataset.diffSide;
    const key = side
      ? `${side === "left" ? "L" : "R"}${number.dataset.lineNumber}`
      : (number.id.startsWith(anchor) ? number.id.slice(anchor.length) : null);
    if (!key || cells.has(key)) continue;
    let cell = number.nextElementSibling;
    while (cell && !cell.classList.contains("blob-code") && !cell.classList.contains("diff-text-cell")) cell = cell.nextElementSibling;
    if (cell instanceof HTMLElement) cells.set(key, cell);
  }
  return cells;
}

const BADGE_TEXT: Record<FileMarks["change"], string> = {
  changed: "Changed since your review",
  opaque: "Can't compare with your review",
  added: "New since your review",
  unchanged: "Unchanged since your review",
  dropped: "",
};

function decorateBadge(header: HTMLElement, marks: FileMarks, since: string): HTMLElement {
  let badge = header.querySelector<HTMLElement>(`:scope > ${BADGE}`);
  const text = `${BADGE_TEXT[marks.change]} (${since})`;
  if (!badge) {
    badge = document.createElement(BADGE);
    header.append(badge);
  }
  if (badge.textContent !== text) badge.textContent = text;
  if (badge.dataset.change !== marks.change) badge.dataset.change = marks.change;
  return badge;
}

/**
 * Adds a marker for lines the reviewed version had here. Its list opens as a popover, so GitHub's scroll containers
 * can't cut it off, and it closes on Escape or a click elsewhere.
 */
function decorateRemoved(cell: HTMLElement, removed: RemovedLines, key: string, since: string): Element {
  const existing = cell.querySelector(`:scope > ${REMOVED}[data-key="${CSS.escape(key)}"]`);
  if (existing) return existing;
  cell.setAttribute(HOST, "");
  const marker = document.createElement(REMOVED);
  marker.dataset.key = key;
  if (!removed.after) marker.dataset.before = "";
  const shadow = marker.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = REMOVED_STYLES;
  const count = removed.lines.length;
  const label = `${count} ${count === 1 ? "line" : "lines"} of the patch you reviewed in ${since} ${count === 1 ? "is" : "are"} gone here`;
  const button = Object.assign(document.createElement("button"), { type: "button", title: label });
  button.append(Object.assign(document.createElement("span"), { className: "pill", textContent: `−${count}` }));
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-expanded", "false");
  const panel = Object.assign(document.createElement("div"), { className: "panel" });
  panel.popover = "auto";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", label);
  const intro = Object.assign(document.createElement("p"), { textContent: `In ${since}, the pull request also had:` });
  const pre = document.createElement("pre");
  for (const line of removed.lines) {
    const span = document.createElement("span");
    span.className = line.startsWith("+") ? "add" : (line.startsWith("-") ? "del" : "");
    span.textContent = `${line}\n`;
    pre.append(span);
  }
  panel.append(intro, pre);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    panel.togglePopover();
  });
  panel.addEventListener("toggle", (event) => {
    const open = event.newState === "open";
    button.setAttribute("aria-expanded", String(open));
    if (!open) return;
    const anchor = button.getBoundingClientRect();
    const width = panel.offsetWidth;
    panel.style.left = `${Math.max(8, Math.min(anchor.right - width, innerWidth - width - 8))}px`;
    const below = anchor.bottom + 4;
    panel.style.top = `${below + panel.offsetHeight > innerHeight - 8 ? Math.max(8, anchor.top - panel.offsetHeight - 4) : below}px`;
  });
  shadow.append(style, button, panel);
  cell.append(marker);
  return marker;
}

async function readCache(pull: string): Promise<Loaded | null> {
  try {
    const stored = await chrome.storage.local.get(CACHE);
    return (stored[CACHE] as Record<string, { at: number; loaded: Loaded }> | undefined)?.[pull]?.loaded ?? null;
  } catch {
    return null;
  }
}

/** Keeps the marks of the {@link MAX_CACHED_PULLS} most recently loaded pull requests. */
async function writeCache(pull: string, loaded: Loaded): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(CACHE);
    const cache = { ...(stored[CACHE] as Record<string, { at: number; loaded: Loaded }> | undefined), [pull]: { at: Date.now(), loaded } };
    const kept = Object.entries(cache)
      .toSorted(([, a], [, b]) => b.at - a.at)
      .slice(0, MAX_CACHED_PULLS);
    await chrome.storage.local.set({ [CACHE]: Object.fromEntries(kept) });
  } catch {
    // The cache only saves API calls; without it the marks load again next time.
  }
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.append(style);
}
