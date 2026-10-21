import { formatAge } from "../core/age";
import { el, icon } from "./dom";
import type { VersionPatch } from "../api/github";
import { samePatch } from "../api/version-cache";
import {
  diffstat,
  type FileInterdiff,
  fileVerdict,
  headerLabels,
  type InterdiffLine,
  interdiff,
  isWholeFileHunk,
  splitLine,
  uniformKind,
  versionDiff,
} from "../core/interdiff";
import { buildPathTree, filesInOrder, type PathNode } from "../core/path-tree";
import { type Compared, placeThreads, type ReviewThread } from "../core/threads";
import { renderThread, THREAD_STYLES } from "./review-thread";
import { highlightLines, languageFor, overlay, type Token } from "../core/syntax";
import {
  BASE,
  baseCandidates,
  carryRange,
  rangeToSave,
  restoreRange,
  type SavedRange,
  type Version,
  type VersionHistory,
} from "../core/versions";

/** A line a review comment is on, as GitHub's API names it. */
export interface CommentLine {
  path: string;
  /** The last line the comment covers. */
  line: number;
  /** The first line, for a comment on several. */
  startLine?: number;
  /** LEFT for the base side of the diff, RIGHT for the head side. */
  side: "LEFT" | "RIGHT";
}

/** Where scrolling to a commented line got: to the line, only to its file, or nowhere because the diff lacks it. */
type Revealed = "line" | "file" | "unchanged" | "missing";
type Reveal = (line: CommentLine) => Revealed;
/** Puts the review threads at their lines, in place of the ones shown before. */
type PlaceThreads = (threads: ReviewThread[], compared: Compared) => void;

export interface VersionsViewRequest {
  /** Names the pull request: opening the same one again shows what the view showed last, refreshed. */
  key: string;
  number: number;
  /** The repository's URL, like https://github.com/owner/repo. */
  repoUrl: string;
  /** Resolves to the versions fetched last time, shown while they are fetched again, or to null. */
  cachedVersions?: () => Promise<VersionHistory | null>;
  /** Resolves to the pull request's versions; rejects with a message to show. */
  versions: () => Promise<VersionHistory>;
  /** Resolves to the pull request's review threads, shown at their lines; rejects with a message to show. */
  threads?: () => Promise<ReviewThread[]>;
  /** Resolves to what a version changes; rejects with a message to show. */
  patch: (history: VersionHistory, version: Version) => Promise<VersionPatch>;
  /** Resolves to the range the viewer last compared on this pull request, or to null. */
  savedRange?: () => Promise<SavedRange | null>;
  /** Remembers a range the viewer picked. */
  saveRange?: (range: SavedRange) => void;
  /** Called with each pair of versions the view starts comparing; the older one is null for the base branch. */
  onShow?: (older: Version | null, newer: Version) => void;
  /** Called when the viewer closes the view. */
  onClose?: () => void;
}


const VIEW_STYLES = `
:host {
  --vd-fg: var(--fgColor-default, #1f2328);
  --vd-muted: var(--fgColor-muted, #59636e);
  --vd-bg: var(--bgColor-default, #ffffff);
  --vd-bg-muted: var(--bgColor-muted, #f6f8fa);
  --vd-border: var(--borderColor-default, #d1d9e0);
  --vd-success: var(--fgColor-success, #1a7f37);
  --vd-danger: var(--fgColor-danger, #d1242f);
  --vd-accent: var(--fgColor-accent, #0969da);
  --vd-done: var(--fgColor-done, #8250df);
  --vd-attention: var(--fgColor-attention, #9a6700);
  --vd-attention-bg: var(--bgColor-attention-muted, #fff8c5);
  --vd-add-bg: var(--diffBlob-additionLine-bgColor, #dafbe1);
  --vd-add-num-bg: var(--diffBlob-additionNum-bgColor, #d1f8d9);
  --vd-del-bg: var(--diffBlob-deletionLine-bgColor, #ffebe9);
  --vd-del-num-bg: var(--diffBlob-deletionNum-bgColor, #ffcecb);
  --vd-hunk-bg: var(--diffBlob-hunkLine-bgColor, #ddf4ff);
  --vd-hunk-num-bg: var(--diffBlob-hunkNum-bgColor-rest, #b6e3ff);
  --vd-add-word: var(--diffBlob-additionWord-bgColor, #aceebb);
  --vd-del-word: var(--diffBlob-deletionWord-bgColor, rgba(255, 129, 130, 0.4));
  --vd-syntax-keyword: var(--color-prettylights-syntax-keyword, #cf222e);
  --vd-syntax-string: var(--color-prettylights-syntax-string, #0a3069);
  --vd-syntax-comment: var(--color-prettylights-syntax-comment, #59636e);
  --vd-syntax-constant: var(--color-prettylights-syntax-constant, #0550ae);
  --vd-syntax-entity: var(--color-prettylights-syntax-entity, #6639ba);
  --vd-syntax-variable: var(--color-prettylights-syntax-variable, #953800);
  --vd-syntax-regexp: var(--color-prettylights-syntax-string-regexp, #116329);
  --vd-neutral-square: var(--borderColor-neutral-muted, rgba(175, 184, 193, 0.4));
  --vd-mono: var(--fontStack-monospace, ui-monospace, SFMono-Regular, Menlo, monospace);
  --vd-focus: var(--focus-outlineColor, #0969da);
  --vd-shadow: var(--shadow-floating-xlarge, 0 12px 48px rgba(31, 35, 40, 0.3));
  font: 14px/1.5 var(--fontStack-sansSerif, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif);
  color: var(--vd-fg);
}
* { box-sizing: border-box; }
:host { display: block; }
:host([data-mode="docked"]) {
  box-sizing: border-box;
  position: sticky;
  top: var(--flohub-top, 0px);
  flex: 1 1 100%;
  width: 100%;
  min-width: 0;
  height: calc(100vh - var(--flohub-top, 0px));
  padding: 16px 0 8px;
}
:host([data-mode="docked"]) main, :host([data-mode="docked"]) nav.files { overscroll-behavior: auto; }
:host([data-mode="floating"]) { position: fixed; z-index: 100; inset: 72px 16px 16px; box-shadow: var(--vd-shadow); border-radius: 12px; }
.surface {
  display: flex;
  flex-direction: column;
  height: 100%;
  border: 1px solid var(--vd-border);
  border-radius: 12px;
  background: var(--vd-bg);
  color: var(--vd-fg);
  overflow: hidden;
}
header { display: flex; flex-direction: column; gap: 10px; padding: 16px; border-bottom: 1px solid var(--vd-border); }
.title-row { display: flex; align-items: center; gap: 8px; }
h2 { margin: 0; font-size: 16px; }
.close { margin-left: auto; }
.controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.controls label { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; }
select {
  max-width: min(440px, 80vw);
  min-height: 32px;
  padding: 0 8px;
  border: 1px solid var(--vd-border);
  border-radius: 6px;
  background: var(--vd-bg);
  color: inherit;
  font: inherit;
  font-weight: 400;
}
.arrow { color: var(--vd-muted); }
.summary, .hint { margin: 0; color: var(--vd-muted); font-size: 12px; }
.summary strong { color: var(--vd-fg); }
.error { margin: 0; color: var(--vd-danger); }
.error:empty { display: none; }
.notice { margin: 0; color: var(--vd-attention); }
.notice:empty { display: none; }
.line.target { box-shadow: inset 4px 0 0 var(--vd-attention); }
.line.target .code { background: var(--vd-attention-bg); }
.body { flex: 1; min-height: 0; display: flex; }
main { position: relative; flex: 1; min-width: 0; overflow: auto; overscroll-behavior: contain; padding: 16px; display: flex; flex-direction: column; gap: 12px; container-type: inline-size; }
main.hide-threads :is(.thread-row, .elsewhere) { display: none; }
.elsewhere { padding: 0 6px; border: 1px solid var(--vd-border); border-radius: 2em; color: var(--vd-muted); font-size: 12px; font-weight: 400; }
.files .comment-count { display: inline-flex; align-items: center; gap: 2px; color: var(--vd-muted); }
.files .comment-count svg { width: 12px; height: 12px; }
.files.hide-threads .comment-count { display: none; }

nav.files { position: relative; flex: none; width: 280px; overflow: auto; overscroll-behavior: contain; padding: 8px; border-right: 1px solid var(--vd-border); font-size: 12px; }
nav.files:empty { display: none; }
.files-head { display: flex; align-items: center; gap: 8px; padding: 4px 8px 8px; color: var(--vd-muted); font-weight: 600; }
.files-head .counts { margin-left: auto; }
.files ul { margin: 0; padding: 0; list-style: none; }
.files ul[hidden] { display: none; }
.files button {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 28px;
  padding: 0 8px 0 calc(8px + var(--depth, 0) * 16px);
  border: 0;
  border-radius: 6px;
  font-weight: 400;
  text-align: left;
}
.files .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.files .folder { color: var(--vd-muted); }
.files .folder svg { width: 12px; height: 12px; transform: rotate(180deg); transition: transform 120ms; }
.files .folder[aria-expanded="false"] svg { transform: rotate(90deg); }
.files .file[aria-current] { background: var(--vd-bg-muted); font-weight: 600; box-shadow: inset 2px 0 0 var(--vd-accent); }
.files .mark { flex: none; width: 8px; height: 8px; border-radius: 2px; background: currentColor; }
.counts { flex: none; display: inline-flex; gap: 4px; font: 600 11px var(--vd-mono); }
.counts .add { color: var(--vd-success); }
.counts .del { color: var(--vd-danger); }
@media (max-width: 760px) { nav.files { display: none; } }
.message { color: var(--vd-muted); }
button {
  min-height: 32px;
  padding: 0 14px;
  border: 1px solid var(--vd-border);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
button:hover { background: var(--vd-bg-muted); }
a { color: var(--vd-accent); }
:focus-visible { outline: 2px solid var(--vd-focus); outline-offset: 2px; }

details.file { border: 1px solid var(--vd-border); border-radius: 6px; }
details.file > summary {
  position: sticky;
  top: -16px;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px 6px 0 0;
  background: var(--vd-bg-muted);
  cursor: pointer;
  list-style: none;
}
details.file > summary::-webkit-details-marker { display: none; }
details.file[open] > summary { border-bottom: 1px solid var(--vd-border); }
details.file:not([open]) > summary { border-radius: 6px; }
svg { flex: none; fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
.chevron { color: var(--vd-muted); transform: rotate(90deg); transition: transform 120ms; }
details.file[open] > summary .chevron { transform: rotate(180deg); }
.path { font: 600 12px var(--vd-mono); word-break: break-all; }
.old-path { color: var(--vd-muted); font-weight: 400; }
.copy { display: inline-flex; align-items: center; justify-content: center; min-height: 24px; padding: 0 4px; border-color: transparent; color: var(--vd-muted); }
.copy:hover { color: var(--vd-accent); }
.badge { padding: 0 8px; border: 1px solid currentColor; border-radius: 999px; font-size: 12px; font-weight: 600; }
.chip { padding: 0 6px; border-radius: 6px; background: var(--vd-bg); font-size: 12px; color: var(--vd-muted); }
.chip[data-mark="+"] { background: var(--vd-add-word); color: var(--vd-fg); }
.chip[data-mark="-"] { background: var(--vd-del-word); color: var(--vd-fg); }
.stat { display: inline-flex; align-items: center; gap: 8px; margin-left: auto; font: 600 12px var(--vd-mono); }
.stat .add { color: var(--vd-success); }
.stat .del { color: var(--vd-danger); }
.squares { display: inline-flex; gap: 1px; }
.squares span { width: 8px; height: 8px; border-radius: 2px; background: var(--vd-neutral-square); }
.squares .add { background: var(--vd-success); }
.squares .del { background: var(--vd-danger); }
.view { font-size: 12px; text-decoration: none; }
.view:hover { text-decoration: underline; }
[data-tone="success"] { color: var(--vd-success); }
[data-tone="danger"] { color: var(--vd-danger); }
[data-tone="accent"] { color: var(--vd-accent); }
[data-tone="muted"] { color: var(--vd-muted); }
.note { margin: 0; padding: 8px 12px; color: var(--vd-muted); font-size: 12px; }

.legend:empty { display: none; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 0; color: var(--vd-muted); font-size: 12px; }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.legend i { width: 12px; height: 12px; border-radius: 3px; }
.legend .new i { background: var(--vd-add-word); }
.legend .gone i { background: var(--vd-del-word); }
.legend kbd { font: 600 12px var(--vd-mono); }
.wrap-toggle { margin-left: auto; font-weight: 400 !important; font-size: 12px; }
.wrap-toggle + .wrap-toggle { margin-left: 0; }

.diff { overflow-x: auto; font: 12px/20px var(--vd-mono); }
.line { display: flex; min-width: max-content; }
.line[hidden] { display: none; }
.num {
  flex: none;
  width: 48px;
  padding: 0 8px;
  text-align: right;
  color: var(--vd-muted);
  user-select: none;
}
.sign { flex: none; width: 20px; text-align: center; user-select: none; }
.marker { flex: none; width: 22px; padding-left: 8px; font-weight: 600; user-select: none; }
.marker { color: var(--vd-muted); }
.diff[data-uniform] .marker, .diff[data-plain] .marker { display: none; }
.diff[data-uniform="+"] .num:nth-child(2), .diff[data-uniform="-"] .num:nth-child(3) { display: none; }
.diff[data-uniform] .expander .num { width: 68px; }
.code { flex: 1; padding-right: 16px; white-space: pre; }
.wrap .line { min-width: 0; }
.wrap .code { white-space: pre-wrap; overflow-wrap: anywhere; }
.line[data-kind="hunk"] .code, .line[data-kind="\\\\"] .code { color: var(--vd-muted); }
.line[data-kind="hunk"][data-outer=" "] { background: var(--vd-hunk-bg); }
.line[data-kind="hunk"][data-outer=" "] :is(.sign, .num) { background: var(--vd-hunk-num-bg); }
.line[data-outer="+"] { background: var(--vd-add-bg); }
.line[data-outer="+"] :is(.sign, .num) { background: var(--vd-add-num-bg); }
.line[data-outer="-"] { background: var(--vd-del-bg); }
.line[data-outer="-"] :is(.sign, .num) { background: var(--vd-del-num-bg); }
.line[data-outer="+"] .word { border-radius: 3px; background: var(--vd-add-word); }
.line[data-outer="-"] .word { border-radius: 3px; background: var(--vd-del-word); }
.tok-keyword { color: var(--vd-syntax-keyword); }
.tok-string { color: var(--vd-syntax-string); }
.tok-comment { color: var(--vd-syntax-comment); }
.tok-number, .tok-constant { color: var(--vd-syntax-constant); }
.tok-function { color: var(--vd-syntax-entity); }
.tok-type { color: var(--vd-syntax-variable); }
.tok-regexp { color: var(--vd-syntax-regexp); }
.expander {
  display: flex;
  width: 100%;
  min-height: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: var(--vd-hunk-bg);
  color: var(--vd-muted);
  font: inherit;
  font-weight: 400;
  text-align: left;
}
.expander .num { display: flex; justify-content: center; align-items: center; width: 116px; background: var(--vd-hunk-num-bg); }
.expander .code { padding-left: 8px; }
.expander:hover, .expander:hover .num { background: var(--vd-accent); color: var(--vd-bg); }

details.unchanged > summary { color: var(--vd-muted); cursor: pointer; }
details.unchanged ul { margin: 6px 0 0; padding-left: 20px; font: 12px/20px var(--vd-mono); color: var(--vd-muted); }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; user-select: none; }
${THREAD_STYLES}
@media (prefers-reduced-motion: reduce) { .chevron, .files .folder svg { transition: none; } }
`;

/** How long after docking the view keeps scrolling to its sticky place while the page above it grows. */
const ALIGN_MS = 3000;
/** Marks the element the view is docked in, so the page's own file tree and diff beside it hide. */
const DOCKED = "data-flohub-versions";
/** Hides GitHub's file tree and diff while the view takes their place. */
const PAGE_STYLES = `
[${DOCKED}] > :has(> [data-component="SplitPageLayout.Pane"]),
[${DOCKED}] > [data-component="SplitPageLayout.Content"] { display: none !important; }
`;

/** Where the view goes on GitHub's Files changed page: in place of its file tree and diff, under its sticky toolbar. */
interface Dock {
  parent: Element;
  before: Element;
  /** How far below the top of the window the page's file tree sticks, which the view sticks at too. */
  top: number;
}

/**
 * @param root The page.
 * @returns Where the view takes the place of the file tree and diff, or null on a page without GitHub's split layout.
 */
function findDock(root: ParentNode): Dock | null {
  const content = root.querySelector('[data-component="SplitPageLayout.Content"]');
  const parent = content?.parentElement;
  if (!content || !parent?.closest("#diff-comparison-viewer-container")) return null;
  const pane = [...parent.children].find((child) => child.querySelector(':scope > [data-component="SplitPageLayout.Pane"]'));
  const before = pane ?? content;
  // A sticky element's top is in pixels; "auto" leaves the view at the top of the window.
  const top = Number(getComputedStyle(before).top.replace(/px$/u, ""));
  return { parent, before, top: Number.isFinite(top) ? top : 0 };
}

/** Shows the page's own file tree and diff again. */
function undock(): void {
  for (const docked of document.querySelectorAll(`[${CSS.escape(DOCKED)}]`)) docked.removeAttribute(DOCKED);
}

/**
 * Shows how a pull request's own changes differ between two of its versions. It takes the place of GitHub's file tree
 * and diff on the Files changed page, so the page's header, toolbar and comments stay usable beside it; elsewhere it
 * floats over the page.
 */
export class VersionsView {
  readonly host: HTMLElement;
  private readonly surface: HTMLElement;
  private generation = 0;
  /** The pull request the view shows, and how to fetch its versions again when it opens on it once more. */
  private shown: { key: string; revalidate: () => Promise<void> } | null = null;
  private onClose: (() => void) | undefined;
  /** Until when the view keeps scrolling the page to its sticky place, while the page above it still grows. */
  private alignUntil = 0;
  /** Shows a range, and a line in it, once the view has its versions. */
  private target: ((range: SavedRange, line?: CommentLine) => void) | null = null;

  constructor() {
    this.host = document.createElement("flohub-versions");
    const shadow = this.host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = VIEW_STYLES;
    this.surface = el("section", { class: "surface", "aria-labelledby": "versions-title" });
    shadow.append(style, this.surface);
    for (const type of ["keydown", "keyup", "keypress"]) {
      shadow.addEventListener(type, (event) => event.stopPropagation());
    }
    shadow.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key === "Escape" && !(event as KeyboardEvent).defaultPrevented) this.dismiss();
    });
  }

  /** @returns Whether the view is on the page. */
  get isOpen(): boolean {
    return this.host.isConnected;
  }

  /**
   * Puts the view back in its place when the page re-rendered around it, or moves it there once the page has one.
   * Opening the view does it too.
   */
  place(): void {
    const dock = findDock(document);
    if (dock) {
      const moved = this.host.parentElement !== dock.parent || this.host.dataset.mode !== "docked";
      if (moved) {
        dock.parent.setAttribute(DOCKED, "");
        dock.before.before(this.host);
      }
      this.host.dataset.mode = "docked";
      this.host.style.setProperty("--flohub-top", `${dock.top}px`);
      // Below the page's header the view would reach past the window; scrolled up to its sticky place, it fits. The
      // header may still grow after the view docks (the bar mounts, GitHub renders lazily), so it keeps that place a
      // little longer, until the viewer scrolls themselves.
      if (moved) {
        this.alignUntil = Date.now() + ALIGN_MS;
        const stop = () => {
          this.alignUntil = 0;
        };
        for (const type of ["wheel", "touchstart", "keydown"]) addEventListener(type, stop, { once: true, passive: true });
      }
      const below = this.host.getBoundingClientRect().top - dock.top;
      if (Date.now() < this.alignUntil && below > 0) scrollBy({ top: below });
    } else if (!this.host.isConnected || this.host.dataset.mode !== "floating") {
      undock();
      this.host.dataset.mode = "floating";
      document.body.append(this.host);
    }
    if (!document.getElementById("flohub-versions-page")) {
      document.head.append(Object.assign(document.createElement("style"), { id: "flohub-versions-page", textContent: PAGE_STYLES }));
    }
  }

  /** Takes the view off the page, which shows the page's own diff again. It keeps what it shows for the next open. */
  close(): void {
    undock();
    this.host.remove();
  }

  /** Closes the view because the viewer asked to. */
  private dismiss(): void {
    this.close();
    this.onClose?.();
  }


  /**
   * Shows a range and scrolls to a line in it, as a review comment names them. Open the view first.
   * @param range The range, as a saved range or a link names it.
   * @param line The line to scroll to and mark, in the older version's numbers (the newer one's for the base).
   */
  goTo(range: SavedRange, line?: CommentLine): void {
    this.target?.(range, line);
  }

  /** @param request Where the versions come from. */
  open(request: VersionsViewRequest): void {
    this.onClose = request.onClose;
    this.place();
    if (this.shown?.key === request.key) {
      void this.shown.revalidate();
      return;
    }
    this.shown = null;
    const run = ++this.generation;
    const live = () => run === this.generation;

    const close = el("button", { type: "button", class: "close" }, "Close");
    close.addEventListener("click", () => this.dismiss());
    const titleRow = el("div", { class: "title-row" });
    titleRow.append(el("h2", { id: "versions-title" }, `Compare versions of #${request.number}`), close);
    const controls = el("div", { class: "controls" });
    const summary = el("p", { class: "summary", "aria-live": "polite" });
    const legend = el("p", { class: "legend" });
    const error = el("p", { class: "error", role: "alert" });
    const notice = el("p", { class: "notice", role: "status" });
    const header = el("header");
    header.append(titleRow, controls, summary, legend, error, notice);
    const files = el("nav", { class: "files", "aria-label": "Files" });
    const main = el("main");
    main.append(el("p", { class: "message", role: "status" }, "Loading versions…"));
    const body = el("div", { class: "body" });
    body.append(files, main);
    this.surface.replaceChildren(header, body);

    let history: VersionHistory | null = null;
    let picker: { from: HTMLSelectElement; to: HTMLSelectElement; link: HTMLAnchorElement } | null = null;
    /** The compared commits and the bases each was diffed against, so a refresh that changes neither keeps the diff. */
    let compared = "";
    /** The patches on screen, so a refresh whose bases moved only redraws when what the versions change differs. */
    let onScreen: {
      oids: string;
      before: VersionPatch | null;
      after: VersionPatch;
      reveal: Reveal;
      place: PlaceThreads;
      compared: Compared;
    } | null = null;
    /** The pull request's review threads, once fetched, and whether the viewer wants them shown. */
    let threads: ReviewThread[] = [];
    let threadsShown = true;
    const placeAll = () => {
      if (onScreen) onScreen.place(threadsShown ? threads : [], onScreen.compared);
    };
    const loadThreads = async () => {
      if (!request.threads) return;
      try {
        const fresh = await request.threads();
        if (!live()) return;
        threads = fresh;
        placeAll();
      } catch (failure) {
        if (live()) notice.textContent = `Could not load the comments: ${failure instanceof Error ? failure.message : "GitHub didn't answer."}`;
      }
    };
    /** A range to show and a line to scroll to, waiting for the versions or for the range's diff. */
    let pending: { range: SavedRange; line?: CommentLine; oids?: string } | null = null;
    let shown = 0;
    let tracking: AbortController | undefined;

    const reveal = (show: Reveal, line: CommentLine) => {
      const found = show(line);
      notice.textContent = revealNotice(found, line.path);
    };

    /** @param quiet Whether to keep the diff on screen while the same versions are compared again. */
    const compare = async (quiet: boolean) => {
      if (!history || !picker) return;
      const fromNumber = Number(picker.from.value);
      const older = fromNumber === 0 ? null : history.versions[fromNumber - 1];
      const newer = history.versions[Number(picker.to.value) - 1];
      if (older === undefined || !newer) return;
      const showing = ++shown;
      const versions = history;
      const oids = `${older?.oid ?? BASE}|${newer.oid}`;
      request.onShow?.(older, newer);
      const kept = quiet && onScreen?.oids === oids ? onScreen : null;
      picker.link.href = `${request.repoUrl}/compare/${older?.oid ?? versions.baseRefOid}...${newer.oid}`;
      picker.link.title = older
        ? "GitHub's plain compare of the two heads, including everything the base branch gained in between"
        : "GitHub's compare of the version with the base branch's current head";
      if (!kept) {
        onScreen = null;
        tracking?.abort();
        error.textContent = "";
        notice.textContent = "";
        summary.textContent = "";
        legend.replaceChildren();
        files.replaceChildren();
        const loading = older ? `Comparing v${older.number} with v${newer.number}…` : `Loading v${newer.number}…`;
        main.replaceChildren(el("p", { class: "message", role: "status" }, loading));
      }
      try {
        const [before, after] = await Promise.all([older ? request.patch(versions, older) : null, request.patch(versions, newer)]);
        if (!live() || showing !== shown) return;
        compared = comparedKey(versions, older, newer);
        const same = kept && (before && kept.before ? samePatch(before, kept.before) : before === kept.before) && samePatch(after, kept.after);
        if (!same) {
          tracking?.abort();
          tracking = new AbortController();
          error.textContent = "";
          summary.textContent = "";
          legend.replaceChildren();
          files.replaceChildren();
          const diff = before ? interdiff(before.files, after.files) : versionDiff(after.files);
          const show = renderResult({ main, summary, legend, files, signal: tracking.signal }, diff, {
            older,
            newer,
            before,
            after,
            history: versions,
            repoUrl: request.repoUrl,
          });
          const shownVersions = { older: older?.oid ?? null, newer: newer.oid, newerIsHead: newer.current };
          onScreen = { oids, before, after, reveal: show.reveal, place: show.place, compared: shownVersions };
          placeAll();
        }
        if (pending?.line && pending.oids === oids && onScreen) {
          reveal(onScreen.reveal, pending.line);
          pending = null;
        }
      } catch (failure) {
        if (!live() || showing !== shown) return;
        const message = failure instanceof Error ? failure.message : "Could not compare the versions.";
        if (kept) {
          error.textContent = `Could not refresh the comparison: ${message}`;
          return;
        }
        main.replaceChildren();
        error.textContent = message;
      }
    };

    /** Shows the range a target names, then the line once its diff is on screen. */
    const aim = () => {
      if (!history || !picker || !pending) return;
      const range = restoreRange(history.versions, pending.range);
      if (!range) return;
      fillVersions(picker.from, history.versions, range.from, Date.now(), true);
      fillVersions(picker.to, history.versions, range.to, Date.now());
      const remembered = rangeToSave(history.versions, range.from, range.to, Date.now());
      if (remembered) request.saveRange?.(remembered);
      const older = range.from === 0 ? null : (history.versions[range.from - 1] ?? null);
      const newer = history.versions[range.to - 1];
      if (!newer) return;
      pending.oids = `${older?.oid ?? BASE}|${newer.oid}`;
      if (!pending.line) pending = null;
      const current = onScreen;
      if (pending && current !== null && current.oids === pending.oids && compared === comparedKey(history, older, newer)) {
        if (pending.line) reveal(current.reveal, pending.line);
        pending = null;
        return;
      }
      void compare(false);
    };
    this.target = (range, line) => {
      pending = { range, ...(line && { line }) };
      aim();
    };

    const onlyOne = () => {
      picker = null;
      controls.replaceChildren();
      main.replaceChildren(
        el("p", { class: "message" }, "This pull request has only one known version. Versions come from force pushes and reviews."),
      );
    };

    /** Shows a history: the first one at the range the viewer last compared, a later one at the range on screen. */
    const present = (next: VersionHistory, saved: SavedRange | null) => {
      const previous = history;
      history = next;
      const range =
        (previous && picker && carryRange(previous.versions, next.versions, Number(picker.from.value), Number(picker.to.value))) ??
        restoreRange(next.versions, pending?.range ?? saved);
      if (!range) {
        onlyOne();
        return;
      }
      const now = Date.now();
      if (picker) {
        fillVersions(picker.from, next.versions, range.from, now, true);
        fillVersions(picker.to, next.versions, range.to, now);
      } else {
        const from = versionSelect("From", next.versions, range.from, now, true);
        const to = versionSelect("To", next.versions, range.to, now);
        const link = el("a", { target: "_blank", rel: "noopener" }, "GitHub's compare");
        const wrap = el("input", { type: "checkbox" });
        wrap.addEventListener("change", () => main.classList.toggle("wrap", wrap.checked));
        const wrapLabel = el("label", { class: "wrap-toggle" });
        wrapLabel.append(wrap, "Wrap lines");
        const comments = el("input", { type: "checkbox" });
        comments.checked = threadsShown;
        comments.addEventListener("change", () => {
          threadsShown = comments.checked;
          main.classList.toggle("hide-threads", !threadsShown);
          files.classList.toggle("hide-threads", !threadsShown);
          placeAll();
        });
        const commentsLabel = el("label", { class: "wrap-toggle" });
        commentsLabel.append(comments, "Comments");
        controls.replaceChildren(
          from.label,
          el("span", { class: "arrow", "aria-hidden": "true" }, "→"),
          to.label,
          link,
          commentsLabel,
          wrapLabel,
        );
        picker = { from: from.select, to: to.select, link };
        const picked = () => {
          if (!history) return;
          const remembered = rangeToSave(history.versions, Number(from.select.value), Number(to.select.value), Date.now());
          if (remembered) request.saveRange?.(remembered);
          void compare(false);
        };
        from.select.addEventListener("change", picked);
        to.select.addEventListener("change", picked);
      }
      if (pending && !previous) {
        aim();
        return;
      }
      const older = range.from === 0 ? null : next.versions[range.from - 1];
      const newer = next.versions[range.to - 1];
      if (older !== undefined && newer && comparedKey(next, older, newer) !== compared) void compare(true);
    };

    const start = async () => {
      const [cached, saved] = await Promise.all([request.cachedVersions?.() ?? null, request.savedRange?.() ?? null]);
      if (!live()) return;
      if (cached) present(cached, saved);
      const revalidate = async () => {
        void loadThreads();
        try {
          const fresh = await request.versions();
          if (live()) present(fresh, saved);
        } catch (failure) {
          if (!live()) return;
          const message = failure instanceof Error ? failure.message : "Could not load the versions.";
          if (history) {
            error.textContent = `Could not refresh the versions: ${message}`;
          } else {
            main.replaceChildren();
            error.textContent = message;
          }
        }
      };
      this.shown = { key: request.key, revalidate };
      await revalidate();
    };
    void start();
  }

}

/**
 * @param found Where scrolling to a commented line got.
 * @param path The commented file.
 * @returns What to tell the viewer when it didn't get to the line.
 */
function revealNotice(found: Revealed, path: string): string {
  switch (found) {
    case "line": {
      return "";
    }
    case "unchanged": {
      return `${path} makes the same change in both versions, so the commented line isn't in this diff.`;
    }
    case "file": {
      return `The commented line is in a part of ${path} this diff doesn't show.`;
    }
    case "missing": {
      return `${path} isn't in this diff.`;
    }
  }
}

/**
 * @param history The versions.
 * @param older The older compared version.
 * @param newer The newer compared version.
 * @returns What decides the comparison: both commits and the bases each is diffed against.
 */
function comparedKey(history: VersionHistory, older: Version | null, newer: Version): string {
  return [older, newer].map((version) => (version ? `${version.oid}:${baseCandidates(history, version).join(",")}` : BASE)).join("|");
}

function versionSelect(name: string, versions: Version[], selected: number, now: number, base = false) {
  const select = el("select");
  fillVersions(select, versions, selected, now, base);
  const label = el("label", {}, name);
  label.append(select);
  return { label, select };
}

/**
 * @param select The select to fill.
 * @param versions Oldest first.
 * @param selected The version to select, 0 for the base branch.
 * @param now The current time.
 * @param base Whether to offer the base branch, last, which shows the newer version's own changes.
 */
function fillVersions(select: HTMLSelectElement, versions: Version[], selected: number, now: number, base = false): void {
  const options = versions.toReversed().map((version) => {
    const option = el("option", { value: String(version.number) }, describeVersion(version, now));
    option.selected = version.number === selected;
    return option;
  });
  if (base) {
    const option = el("option", { value: "0" }, "Base · the base branch, for the version's own changes");
    option.selected = selected === 0;
    options.push(option);
  }
  select.replaceChildren(...options);
}

/**
 * @param version The version.
 * @param now The current time.
 * @returns A one-line description, like "v3 · 1a2b3c4 · force-pushed by ana 2h ago · current".
 */
function describeVersion(version: Version, now: number): string {
  const parts = [`v${version.number}`, version.oid.slice(0, 7)];
  const age = formatAge(version.at, now).spoken;
  parts.push(version.pushedBy ? `force-pushed by ${version.pushedBy} ${age}` : age);
  if (version.viewerLatestReview) parts.push("your last review");
  else if (version.reviewedBy.length > 0) parts.push(`reviewed by ${version.reviewedBy.join(", ")}`);
  if (version.current) parts.push("current");
  return parts.join(" · ");
}

interface Context {
  /** The older version, or null when the newer one shows against the base branch. */
  older: Version | null;
  newer: Version;
  before: VersionPatch | null;
  after: VersionPatch;
  history: VersionHistory;
  repoUrl: string;
}

interface Slots {
  main: HTMLElement;
  summary: HTMLElement;
  legend: HTMLElement;
  /** The file tree beside the diff. */
  files: HTMLElement;
  /** Aborts when another range replaces this result. */
  signal: AbortSignal;
}

/**
 * @param slots Where the result goes.
 * @param files The compared files.
 * @param context The versions compared.
 * @returns Functions that scroll to a commented line and mark it, and that put the review threads at their lines.
 */
function renderResult(
  { main, summary, legend, files: nav, signal }: Slots,
  files: FileInterdiff[],
  context: Context,
): { reveal: Reveal; place: PlaceThreads } {
  const { older, newer } = context;
  // Past GitHub's file limit, a file only one version lists may just be cut off from the other's list.
  const truncated = Boolean(context.before?.truncated) || context.after.truncated;
  const shown = truncated && older ? files.filter((file) => file.change !== "added" && file.change !== "dropped") : files;
  const differing = shown.filter((file) => file.change !== "unchanged" && file.change !== "opaque");
  const opaque = shown.filter((file) => file.change === "opaque");
  const unchanged = shown.filter((file) => file.change === "unchanged");
  if (older) {
    const headline = differing.length === 0 ? "No differences." : `${differing.length} of ${shown.length} files differ.`;
    const uncompared = opaque.length === 0 ? "" : ` ${opaque.length} can't be compared.`;
    summary.replaceChildren(
      el("strong", {}, `${headline}${uncompared}`),
      ` Shows the pull request's own changes, and how they differ between v${older.number} and v${newer.number}, ignoring what the base branch gained.`,
    );
  } else {
    summary.replaceChildren(
      el("strong", {}, `${shown.length} ${shown.length === 1 ? "file" : "files"} changed.`),
      ` Shows the pull request's changes as v${newer.number} made them, against the base branch it was made on.`,
    );
  }
  if (older && differing.length > 0) {
    const marks = el("span");
    marks.append(
      el("kbd", {}, "+"),
      " ",
      el("kbd", {}, "−"),
      " beside the code: what the pull request does to the line",
    );
    legend.replaceChildren(legendEntry("new", `Only in v${newer.number}`), legendEntry("gone", `Only in v${older.number}`), marks);
  }

  const content: Node[] = [];
  if (truncated) {
    content.push(
      el(
        "p",
        { class: "hint" },
        older
          ? "GitHub lists at most 300 files per version, so files only one version lists are left out: they may just be past the cut."
          : "GitHub lists at most 300 files per version, so files past the cut are missing.",
      ),
    );
  }
  const offBase = [context.before, context.after].some((patch) => patch && !patch.onBase) && context.history.baseHeads.length > 0;
  if (offBase) {
    content.push(
      el(
        "p",
        { class: "hint" },
        "One version doesn't descend from any known head of the base branch, so it's diffed against its merge base and may include changes from the base branch.",
      ),
    );
  }
  const tree = buildPathTree([...differing, ...opaque], (file) => file.path);
  const sections = new Map<FileInterdiff, HTMLDetailsElement>();
  const rowAt = new Map<FileInterdiff, (index: number) => HTMLElement | null>();
  for (const file of filesInOrder(tree)) {
    const { section, row } = renderFile(file, context);
    sections.set(file, section);
    rowAt.set(file, row);
    content.push(section);
  }
  const details = el("details", { class: "unchanged" });
  if (unchanged.length > 0) {
    details.append(el("summary", {}, `${unchanged.length} ${unchanged.length === 1 ? "file makes" : "files make"} the same change in both versions`));
    const list = el("ul");
    for (const file of unchanged) list.append(el("li", {}, file.oldPath ? `${file.oldPath} → ${file.path}` : file.path));
    details.append(list);
    content.push(details);
  }
  main.replaceChildren(...content);
  const treeRows = sections.size > 0 ? renderFileTree(nav, tree, sections, main, signal) : new Map<HTMLDetailsElement, HTMLButtonElement>();

  const place: PlaceThreads = (threads, compared) => {
    for (const earlier of main.querySelectorAll(".thread-row, .elsewhere")) earlier.remove();
    for (const row of treeRows.values()) row.querySelector(".comment-count")?.remove();
    const now = Date.now();
    for (const [file, section] of sections) {
      const { placed, elsewhere } = placeThreads(file, threads, compared);
      const at = rowAt.get(file);
      if (at) {
        for (const { thread, first, last } of placed) {
          // Unfolding the first line before the last keeps the commented lines together.
          for (let index = first; index < last; index++) at(index);
          let anchor: Element | null = at(last);
          if (!anchor) continue;
          while (anchor.nextElementSibling?.classList.contains("thread-row")) anchor = anchor.nextElementSibling;
          const block = el("div", { class: "thread-row" });
          block.append(renderThread(thread, now));
          anchor.after(block);
        }
      }
      if (elsewhere.length > 0) {
        const count = `${elsewhere.length} ${elsewhere.length === 1 ? "comment" : "comments"} on other versions`;
        section.querySelector(":scope > summary")?.append(el("span", { class: "elsewhere", title: "Written on a version this diff doesn't show, and outdated since" }, count));
      }
      const treeRow = treeRows.get(section);
      if (!treeRow || placed.length === 0) continue;
      const badge = el("span", { class: "comment-count", title: `${placed.length} ${placed.length === 1 ? "thread" : "threads"} here` });
      badge.append(icon("comment"), String(placed.length));
      const lineCounts = treeRow.querySelector(".counts");
      if (lineCounts) lineCounts.before(badge);
      else treeRow.append(badge);
    }
  };

  const reveal: Reveal = (line) => {
    for (const marked of main.querySelectorAll(".line.target")) marked.classList.remove("target");
    const named = (file: FileInterdiff) => file.path === line.path || file.oldPath === line.path;
    if (unchanged.some((file) => named(file))) {
      details.open = true;
      details.scrollIntoView({ block: "start" });
      return "unchanged";
    }
    const file = [...sections.keys()].find((each) => named(each));
    const section = file && sections.get(file);
    if (!file || !section) return "missing";
    section.open = true;
    // A comment names its lines as the version it was written on numbers them, which the lines keep as their origin.
    const at = (number: number) =>
      file.lines.findIndex((each) => (line.side === "LEFT" ? each.origin?.left : each.origin?.right) === number);
    const last = at(line.line);
    if (last < 0) {
      section.scrollIntoView({ block: "start" });
      return "file";
    }
    const first = line.startLine === undefined ? last : at(line.startLine);
    const marked: HTMLElement[] = [];
    for (let index = first < 0 ? last : first; index <= last; index++) {
      const row = rowAt.get(file)?.(index);
      if (row) marked.push(row);
    }
    for (const row of marked) row.classList.add("target");
    marked.at(-1)?.scrollIntoView({ block: "center" });
    return marked.length > 0 ? "line" : "file";
  };
  return { reveal, place };
}

/**
 * Lists the compared files by folder beside the diff. A file's row jumps to its diff, and the row of the file in view
 * stays marked while the diff scrolls.
 * @param nav Where the tree goes.
 * @param tree The compared files by folder.
 * @param sections Each file's diff.
 * @param main The diff's scroll container.
 * @param signal Aborts when another range replaces the diff.
 */
function renderFileTree(
  nav: HTMLElement,
  tree: PathNode<FileInterdiff>[],
  sections: Map<FileInterdiff, HTMLDetailsElement>,
  main: HTMLElement,
  signal: AbortSignal,
): Map<HTMLDetailsElement, HTMLButtonElement> {
  const rows = new Map<HTMLDetailsElement, HTMLButtonElement>();
  let current: HTMLButtonElement | null = null;
  let picked: HTMLDetailsElement | null = null;
  const mark = (row: HTMLButtonElement | undefined) => {
    if (!row || row === current) return;
    current?.removeAttribute("aria-current");
    row.setAttribute("aria-current", "location");
    current = row;
    row.scrollIntoView({ block: "nearest" });
  };
  const jump = (section: HTMLDetailsElement) => {
    section.open = true;
    picked = section;
    mark(rows.get(section));
    section.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    section.querySelector("summary")?.focus({ preventScroll: true });
  };

  const list = (nodes: PathNode<FileInterdiff>[], depth: number): HTMLUListElement => {
    const ul = el("ul");
    for (const node of nodes) {
      const item = el("li");
      if (node.kind === "folder") {
        const toggle = el("button", { type: "button", class: "folder", "aria-expanded": "true", title: node.path });
        toggle.style.setProperty("--depth", String(depth));
        toggle.append(icon("chevron"), el("span", { class: "name" }, node.name));
        const children = list(node.children, depth + 1);
        let expanded = true;
        toggle.addEventListener("click", () => {
          expanded = !expanded;
          children.hidden = !expanded;
          toggle.setAttribute("aria-expanded", String(expanded));
        });
        item.append(toggle, children);
      } else {
        const section = sections.get(node.item);
        if (!section) continue;
        const row = fileRow(node.item, node.name, depth);
        row.addEventListener("click", () => jump(section));
        rows.set(section, row);
        item.append(row);
      }
      ul.append(item);
    }
    return ul;
  };

  const all = [...sections.keys()];
  const head = el("div", { class: "files-head" }, `${all.length} ${all.length === 1 ? "file" : "files"}`);
  head.append(counts(all.reduce((sum, file) => sum + file.added, 0), all.reduce((sum, file) => sum + file.removed, 0)));
  nav.replaceChildren(head, list(tree, 0));

  let frame = 0;
  const follow = () => {
    frame = 0;
    const { top, bottom } = main.getBoundingClientRect();
    if (picked) {
      const rect = picked.getBoundingClientRect();
      if (rect.bottom > top && rect.top < bottom) return;
      picked = null;
    }
    let inView: HTMLDetailsElement | undefined;
    for (const section of rows.keys()) {
      inView ??= section;
      if (section.getBoundingClientRect().top > top + 24) break;
      inView = section;
    }
    if (inView) mark(rows.get(inView));
  };
  main.addEventListener(
    "scroll",
    () => {
      frame ||= requestAnimationFrame(follow);
    },
    { signal, passive: true },
  );
  signal.addEventListener("abort", () => cancelAnimationFrame(frame));
  follow();
  return rows;
}

function fileRow(file: FileInterdiff, name: string, depth: number): HTMLButtonElement {
  const change = fileVerdict(file);
  const row = el("button", { type: "button", class: "file", title: file.oldPath ? `${file.oldPath} → ${file.path}` : file.path });
  row.style.setProperty("--depth", String(depth));
  row.append(el("span", { class: "mark", "data-tone": change.tone, "aria-hidden": "true" }), el("span", { class: "name" }, name));
  if (file.added > 0 || file.removed > 0) row.append(counts(file.added, file.removed));
  const lines = file.added > 0 || file.removed > 0 ? `, ${file.added} lines added, ${file.removed} removed` : "";
  row.append(el("span", { class: "visually-hidden" }, `, ${change.label}${lines}`));
  return row;
}

function counts(added: number, removed: number): HTMLElement {
  const element = el("span", { class: "counts", "aria-hidden": "true" });
  if (added > 0) element.append(el("span", { class: "add" }, `+${added}`));
  if (removed > 0) element.append(el("span", { class: "del" }, `−${removed}`));
  return element;
}

function legendEntry(className: string, text: string): HTMLElement {
  const item = el("span", { class: className });
  item.append(el("i", { "aria-hidden": "true" }), text);
  return item;
}

/** How many lines around a line taken out of a fold come out with it. */
const UNFOLD_CONTEXT = 3;

/** @returns No row: a file without a diff has none. */
function noRow(): null {
  return null;
}

/**
 * @param file The file's interdiff.
 * @param context The versions compared.
 * @returns The file's section, and a function that gives the row of one of its lines, unfolding it if it has to.
 */
function renderFile(file: FileInterdiff, context: Context): { section: HTMLDetailsElement; row: (index: number) => HTMLElement | null } {
  const change = fileVerdict(file);
  const details = el("details", { class: "file", open: "" });
  const head = el("summary");
  const path = el("span", { class: "path" });
  if (file.oldPath) path.append(el("span", { class: "old-path" }, `${file.oldPath} → `));
  path.append(file.path);
  head.append(icon("chevron", "chevron"), path, copyButton(file.path), el("span", { class: "badge", "data-tone": change.tone }, change.label));
  for (const { label, mark } of headerLabels(file.header)) {
    const chip = el("span", { class: "chip", "data-mark": mark }, label);
    if (mark !== " ") chip.prepend(el("span", { class: "visually-hidden" }, `${outerLabel(mark, context)}: `));
    head.append(chip);
  }
  head.append(renderStat(file));
  const view = viewLink(file, context);
  if (view) head.append(view);
  details.append(head);

  if (file.hunks.length === 0) {
    if (!file.diffless) return { section: details, row: noRow };
    const reason =
      file.change === "opaque"
        ? "GitHub shows no diff for this file (binary, or too large), so it can't be compared. Its content differs between the versions, which may only be because the base branch changed it."
        : "GitHub shows no diff for this file (binary, or too large).";
    details.append(el("p", { class: "note" }, reason));
    return { section: details, row: noRow };
  }
  const diff = el("div", { class: "diff" });
  const language = languageFor(file.path);
  const syntax = language ? highlightLines(file.lines, language) : [];
  // A new file's patch is all added lines: its markers and its empty base-side numbers would only repeat that.
  const uniform = uniformKind(file.lines);
  if (uniform) diff.dataset.uniform = uniform;
  if (!context.older) diff.dataset.plain = "";
  const rows = (start: number, end: number) =>
    file.lines.slice(start, end).map((line, index) => {
      const row = renderLine(line, context, syntax[start + index]);
      row.dataset.index = String(start + index);
      return row;
    });
  const folds: { start: number; end: number; button: HTMLButtonElement }[] = [];
  const fold = (start: number, end: number) => {
    const button = expander(end - start, rows.bind(null, start, end));
    folds.push({ start, end, button });
    return button;
  };
  let shown = 0;
  for (const hunk of file.hunks) {
    if (hunk.start > shown) diff.append(fold(shown, hunk.start));
    diff.append(...rows(hunk.start, hunk.start + hunk.lines.length));
    shown = hunk.start + hunk.lines.length;
  }
  if (shown < file.lines.length) diff.append(fold(shown, file.lines.length));
  details.append(diff);
  // A line in a fold comes out with a few lines of context, the rest of the fold staying folded around it.
  const row = (index: number) => {
    const folded = folds.find((each) => index >= each.start && index < each.end && each.button.isConnected);
    if (folded) {
      const from = Math.max(folded.start, index - UNFOLD_CONTEXT);
      const to = Math.min(folded.end, index + UNFOLD_CONTEXT + 1);
      folded.button.replaceWith(
        ...(from > folded.start ? [fold(folded.start, from)] : []),
        ...rows(from, to),
        ...(to < folded.end ? [fold(to, folded.end)] : []),
      );
    }
    return [...diff.querySelectorAll<HTMLElement>(".line")].find((line) => line.dataset.index === String(index)) ?? null;
  };
  return { section: details, row };
}

function copyButton(path: string): HTMLButtonElement {
  const label = `Copy ${path}`;
  const copy = el("button", { type: "button", class: "copy", "aria-label": label, title: label });
  copy.append(icon("copy"));
  const copyPath = async () => {
    await navigator.clipboard.writeText(path);
    copy.replaceChildren(icon("check"));
    copy.title = "Copied";
    setTimeout(() => {
      copy.replaceChildren(icon("copy"));
      copy.title = label;
    }, 1500);
  };
  copy.addEventListener("click", () => void copyPath());
  return copy;
}

function renderStat(file: FileInterdiff): HTMLElement {
  const stat = el("span", { class: "stat" });
  if (file.added === 0 && file.removed === 0) return stat;
  if (file.added > 0) stat.append(el("span", { class: "add", "aria-hidden": "true" }, `+${file.added}`));
  if (file.removed > 0) stat.append(el("span", { class: "del", "aria-hidden": "true" }, `−${file.removed}`));
  const squares = el("span", { class: "squares", "aria-hidden": "true" });
  for (const square of diffstat(file.added, file.removed)) squares.append(el("span", { class: square }));
  stat.append(squares, el("span", { class: "visually-hidden" }, `${file.added} lines added, ${file.removed} removed between the versions`));
  return stat;
}

/**
 * @param file The file.
 * @param context The versions compared.
 * @returns A link to the file in the newer version, or in the older one when the newer doesn't have it.
 */
function viewLink(file: FileInterdiff, context: Context): HTMLAnchorElement | null {
  const [version, path] = exists(file.status.after)
    ? [context.newer, file.path]
    : (exists(file.status.before) && context.older ? [context.older, file.oldPath ?? file.path] : [null, null]);
  if (!version || !path) return null;
  const href = `${context.repoUrl}/blob/${version.oid}/${path.split("/").map((part) => encodeURIComponent(part)).join("/")}`;
  return el("a", { class: "view", href, target: "_blank", rel: "noopener" }, `View file at v${version.number}`);
}

function exists(status: string | null): boolean {
  return status !== null && status !== "removed";
}

/**
 * @param count How many lines the expander folds away.
 * @param rows Renders them.
 * @returns A button that replaces itself with the lines.
 */
function expander(count: number, rows: () => HTMLElement[]): HTMLButtonElement {
  const button = el("button", { type: "button", class: "expander", title: "Expand" });
  const gutter = el("span", { class: "num" });
  gutter.append(icon("unfold"));
  button.append(gutter, el("span", { class: "code" }, `${count} unchanged ${count === 1 ? "line" : "lines"}`));
  button.addEventListener("click", () => {
    button.replaceWith(...rows());
  });
  return button;
}

function outerLabel(mark: "+" | "-", context: Context): string {
  if (!context.older) return mark === "+" ? "Added" : "Removed";
  return mark === "+" ? `Only in v${context.newer.number}` : `Only in v${context.older.number}`;
}

/**
 * A line of the diff. Its background says how it changed between the versions, like any diff's; the marker beside the
 * code says what the pull request does to it.
 * @param line The line.
 * @param context The versions compared.
 * @param tokens The line's syntax, when its language is known.
 * @returns The row.
 */
function renderLine(line: InterdiffLine, context: Context, tokens?: Token[] | null): HTMLElement {
  const { kind, code } = splitLine(line.display);
  const row = el("div", { class: "line", "data-outer": line.mark, "data-kind": kind });
  if (kind === "hunk" && isWholeFileHunk(code)) row.hidden = true;
  const marker = kind === "+" || kind === "-" ? kind : "";
  const text = el("span", { class: "code" });
  if (line.mark !== " ") text.append(el("span", { class: "visually-hidden" }, `${outerLabel(line.mark, context)}: `));
  const segments = line.segments ?? [{ text: code, changed: false }];
  let word: HTMLElement | null = null;
  const pieces = overlay(tokens ?? [{ text: code, kind: null }], segments);
  for (const piece of pieces) {
    const run = piece.kind ? el("span", { class: `tok-${piece.kind}` }, piece.text) : document.createTextNode(piece.text);
    if (!piece.changed) word = null;
    else if (!word) text.append((word = el("span", { class: "word" })));
    (word ?? text).append(run);
  }
  row.append(
    el("span", { class: "sign", "aria-hidden": "true" }, line.mark === " " ? "" : (line.mark === "+" ? "+" : "−")),
    el("span", { class: "num" }, line.left === null ? "" : String(line.left)),
    el("span", { class: "num" }, line.right === null ? "" : String(line.right)),
    el("span", { class: "marker", "data-kind": kind }, marker === "-" ? "−" : marker),
    text,
  );
  return row;
}
