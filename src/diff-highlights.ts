import { type FileMarks, type LineRef, markChanges, type RemovedLines } from "./diff-marks";
import { send } from "./messages";
import { type PullRef, pullKey } from "./pull-ref";
import { diffAnchor } from "./viewed";
import { baseCandidates, lastReviewedVersion, type Version } from "./versions";

/** What the highlights show, for the overview bar. */
export interface HighlightStatus {
  /** The version the viewer last reviewed, which the diff is compared with. */
  since: Version;
  current: Version;
  /** Files whose change is new or different since then. */
  changedFiles: number;
  /** Files the pull request no longer changes, which GitHub's diff can't show. */
  droppedFiles: string[];
  hidden: boolean;
}

const CHANGED = "data-flohub-since";
const BADGE = "flohub-since-badge";
const REMOVED = "flohub-removed";
const STYLE_ID = "flohub-since-styles";
const TABS = /^\/[^/]+\/[^/]+\/pull\/\d+\/(files|changes)(\/|$)/;

const STYLES = `
[${CHANGED}] { box-shadow: inset 3px 0 0 var(--fgColor-attention, #9a6700); }
[${CHANGED}-host] { position: relative; }
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
${BADGE}[data-change="changed"], ${BADGE}[data-change="opaque"] { color: var(--fgColor-attention, #9a6700); }
${BADGE}[data-change="added"] { color: var(--fgColor-success, #1a7f37); }
${BADGE}[data-change="unchanged"] { color: var(--fgColor-muted, #59636e); }
${REMOVED} { position: absolute; left: 0; bottom: -7px; z-index: 2; }
${REMOVED}[data-before] { top: -7px; bottom: auto; }
`;

const REMOVED_STYLES = `
:host { font: 12px/1.5 var(--fontStack-sansSerif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif); }
button {
  display: flex;
  align-items: center;
  height: 14px;
  padding: 0 5px;
  border: 0;
  border-radius: 999px;
  background: var(--bgColor-danger-emphasis, #cf222e);
  color: var(--fgColor-onEmphasis, #ffffff);
  font: inherit;
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
}
button:focus-visible { outline: 2px solid var(--focus-outlineColor, #0969da); outline-offset: 1px; }
.panel {
  position: absolute;
  top: 18px;
  left: 0;
  min-width: 320px;
  max-width: 720px;
  max-height: 320px;
  overflow: auto;
  padding: 8px 0;
  border: 1px solid var(--borderColor-default, #d1d9e0);
  border-radius: 6px;
  background: var(--bgColor-default, #ffffff);
  color: var(--fgColor-default, #1f2328);
  box-shadow: var(--shadow-floating-large, 0 8px 24px rgba(140, 149, 159, 0.2));
}
.panel[hidden] { display: none; }
p { margin: 0 12px 6px; color: var(--fgColor-muted, #59636e); }
pre { margin: 0; padding: 0 12px; font: 12px/20px ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre; }
.add { color: var(--fgColor-success, #1a7f37); }
.del { color: var(--fgColor-danger, #d1242f); }
`;

/** Finds the parts of GitHub's rendered diff the highlights attach to. */
interface DiffMarkup {
  /** The cell holding a line's code, for one side of the diff. */
  codeCell(anchor: string, ref: LineRef): HTMLElement | null;
  /** The first code cell of a file's diff, for marks that come before its first line. */
  firstCodeCell(anchor: string): HTMLElement | null;
  /** Where a file's badge goes. */
  fileHeader(anchor: string, path: string): HTMLElement | null;
}

/** GitHub's classic diff: line number cells carry `id="diff-<hash>L12"` and `R12`, followed by their code cell. */
const CLASSIC: DiffMarkup = {
  codeCell(anchor, ref) {
    return nextCodeCell(document.getElementById(`${anchor}${ref.side}${ref.line}`), "blob-code");
  },
  firstCodeCell(anchor) {
    return document.getElementById(anchor)?.querySelector<HTMLElement>("td.blob-code:not(.blob-code-hunk)") ?? null;
  },
  fileHeader(anchor) {
    return document.getElementById(anchor)?.querySelector<HTMLElement>(".file-header .file-info") ?? null;
  },
};

/**
 * GitHub's React diff, split or unified: the file's region has the `diff-<hash>` id, and line number cells carry
 * `data-diff-side` and `data-line-number`, followed by their code cell. Its class names are hashed, so they're avoided.
 */
const REACT: DiffMarkup = {
  codeCell(anchor, ref) {
    const side = ref.side === "L" ? "left" : "right";
    const number = document
      .getElementById(anchor)
      ?.querySelector(`td.new-diff-line-number[data-diff-side="${side}"][data-line-number="${ref.line}"]`);
    return nextCodeCell(number ?? null, "diff-text-cell");
  },
  firstCodeCell(anchor) {
    return document.getElementById(anchor)?.querySelector<HTMLElement>("td.diff-text-cell") ?? null;
  },
  fileHeader(anchor) {
    return document.getElementById(anchor)?.querySelector<HTMLElement>("[data-diff-header-wrapper] h3")?.parentElement ?? null;
  },
};

/** Tries each markup in turn, since GitHub serves either. */
const MARKUP: DiffMarkup = {
  codeCell: (anchor, ref) => CLASSIC.codeCell(anchor, ref) ?? REACT.codeCell(anchor, ref),
  firstCodeCell: (anchor) => CLASSIC.firstCodeCell(anchor) ?? REACT.firstCodeCell(anchor),
  fileHeader: (anchor, path) => CLASSIC.fileHeader(anchor, path) ?? REACT.fileHeader(anchor, path),
};

function nextCodeCell(numberCell: Element | null, className: string): HTMLElement | null {
  let cell = numberCell?.nextElementSibling ?? null;
  while (cell && !cell.classList.contains(className)) cell = cell.nextElementSibling;
  return cell instanceof HTMLElement ? cell : null;
}

interface Loaded {
  key: string;
  since: Version;
  current: Version;
  files: { anchor: string; marks: FileMarks }[];
}

/**
 * Highlights, in GitHub's own Files changed diff, what changed since the version the viewer last reviewed, so
 * comments go through GitHub's own UI. Lines that are new or different get a bar on the left; lines the reviewed
 * version had and the current one dropped get a marker that lists them. Nothing shows until the viewer has reviewed
 * a version older than the current one.
 */
export class DiffHighlights {
  private loaded: Loaded | null = null;
  /** The pull request the last load settled for, even when it found nothing to highlight. */
  private settledKey: string | null = null;
  private loadingKey: string | null = null;
  private generation = 0;
  private hidden = false;

  constructor(private readonly onStatus: (status: HighlightStatus | null) => void) {}

  /**
   * Fetches what to highlight once per pull request, and highlights it on the Files changed tab.
   * @param ref The pull request on screen, or null.
   */
  sync(ref: PullRef | null): void {
    if (!ref) {
      this.reset();
      return;
    }
    const key = pullKey(ref);
    if (this.settledKey !== null && this.settledKey !== key) this.reset();
    if (this.settledKey === null && this.loadingKey !== key) void this.load(ref);
    if (this.loaded && !this.hidden && TABS.test(location.pathname)) this.decorate(this.loaded);
  }

  /** @param ref The pull request to fetch again, if it was fetched before. */
  refresh(ref: PullRef): void {
    if (this.settledKey === pullKey(ref) && this.loadingKey === null) void this.load(ref);
  }

  /** @param hidden Whether to take the highlights off the page, for this pull request. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (hidden) clearPage();
    this.report();
  }

  private reset(): void {
    if (this.settledKey === null && !this.loadingKey) return;
    this.generation++;
    this.loaded = null;
    this.settledKey = null;
    this.loadingKey = null;
    this.hidden = false;
    clearPage();
    this.onStatus(null);
  }

  private async load(ref: PullRef): Promise<void> {
    const key = pullKey(ref);
    const run = ++this.generation;
    this.loadingKey = key;
    const done = (loaded: Loaded | null) => {
      if (run !== this.generation) return;
      this.loadingKey = null;
      const changed = this.loaded?.since.oid !== loaded?.since.oid || this.loaded?.current.oid !== loaded?.current.oid;
      if (changed) clearPage();
      this.loaded = loaded;
      this.settledKey = key;
      this.report();
    };

    const versions = await send({ type: "versions", ref });
    if (!versions.ok) return done(null);
    const since = lastReviewedVersion(versions.value.versions);
    const current = versions.value.versions.at(-1);
    if (!since || !current) return done(null);
    const patch = (version: Version) =>
      send({ type: "version-patch", ref, head: version.oid, bases: baseCandidates(versions.value, version) });
    const [before, after] = await Promise.all([patch(since), patch(current)]);
    if (!before.ok || !after.ok) return done(null);
    const marks = markChanges(before.value.files, after.value.files);
    const anchors = await Promise.all(marks.map((mark) => diffAnchor(mark.path)));
    done({ key, since, current, files: marks.map((mark, index) => ({ anchor: anchors[index]!, marks: mark })) });
  }

  private report(): void {
    const loaded = this.loaded;
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
      hidden: this.hidden,
    });
  }

  private decorate(loaded: Loaded): void {
    ensureStyles();
    const since = `v${loaded.since.number}`;
    for (const { anchor, marks } of loaded.files) {
      if (marks.change === "dropped") continue;
      const header = MARKUP.fileHeader(anchor, marks.path);
      if (header) decorateBadge(header, marks, since);
      for (const ref of marks.changed) {
        const cell = MARKUP.codeCell(anchor, ref);
        if (cell && !cell.hasAttribute(CHANGED)) cell.setAttribute(CHANGED, since);
      }
      marks.removed.forEach((removed, index) => {
        const cell = removed.after ? MARKUP.codeCell(anchor, removed.after) : MARKUP.firstCodeCell(anchor);
        if (cell) decorateRemoved(cell, removed, `${anchor}:${index}`, since);
      });
    }
  }
}

const BADGE_TEXT: Record<FileMarks["change"], string> = {
  changed: "Changed since",
  opaque: "Changed since",
  added: "New since",
  unchanged: "Unchanged since",
  dropped: "",
};

function decorateBadge(header: HTMLElement, marks: FileMarks, since: string): void {
  let badge = header.querySelector<HTMLElement>(`:scope > ${BADGE}`);
  const text = `${BADGE_TEXT[marks.change]} your review (${since})`;
  if (!badge) {
    badge = document.createElement(BADGE);
    header.append(badge);
  }
  if (badge.textContent !== text) badge.textContent = text;
  if (badge.dataset.change !== marks.change) badge.dataset.change = marks.change;
}

function decorateRemoved(cell: HTMLElement, removed: RemovedLines, key: string, since: string): void {
  if (cell.querySelector(`:scope > ${REMOVED}[data-key="${CSS.escape(key)}"]`)) return;
  cell.setAttribute(`${CHANGED}-host`, "");
  const marker = document.createElement(REMOVED);
  marker.dataset.key = key;
  if (!removed.after) marker.dataset.before = "";
  const shadow = marker.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = REMOVED_STYLES;
  const count = removed.lines.length;
  const label = `${count} ${count === 1 ? "line" : "lines"} of the patch you reviewed in ${since} ${count === 1 ? "is" : "are"} gone here`;
  const button = Object.assign(document.createElement("button"), { type: "button", textContent: `−${count}`, title: label });
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-expanded", "false");
  const panel = Object.assign(document.createElement("div"), { className: "panel", hidden: true });
  const intro = Object.assign(document.createElement("p"), { textContent: `In ${since}, the pull request also had:` });
  const pre = document.createElement("pre");
  for (const line of removed.lines) {
    const span = document.createElement("span");
    span.className = line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "";
    span.textContent = `${line}\n`;
    pre.append(span);
  }
  panel.append(intro, pre);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    panel.hidden = !panel.hidden;
    button.setAttribute("aria-expanded", String(!panel.hidden));
  });
  shadow.append(style, button, panel);
  cell.append(marker);
}

function clearPage(): void {
  for (const element of document.querySelectorAll(`${BADGE}, ${REMOVED}`)) element.remove();
  for (const element of document.querySelectorAll(`[${CHANGED}], [${CHANGED}-host]`)) {
    element.removeAttribute(CHANGED);
    element.removeAttribute(`${CHANGED}-host`);
  }
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.append(style);
}
