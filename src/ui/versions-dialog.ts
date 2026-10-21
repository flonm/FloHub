import { formatAge } from "../core/age";
import { el, icon } from "./dom";
import type { VersionPatch } from "../api/github";
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
} from "../core/interdiff";
import { buildPathTree, filesInOrder, type PathNode } from "../core/path-tree";
import { highlightLines, languageFor, overlay, type Token } from "../core/syntax";
import { defaultRange, type Version, type VersionHistory } from "../core/versions";

export interface VersionsDialogRequest {
  number: number;
  /** The repository's URL, like https://github.com/owner/repo. */
  repoUrl: string;
  /** Resolves to the pull request's versions; rejects with a message to show. */
  versions: () => Promise<VersionHistory>;
  /** Resolves to what a version changes; rejects with a message to show. */
  patch: (history: VersionHistory, version: Version) => Promise<VersionPatch>;
}


const DIALOG_STYLES = `
:host {
  --vd-fg: var(--fgColor-default, #1f2328);
  --vd-muted: var(--fgColor-muted, #59636e);
  --vd-bg: var(--bgColor-default, #ffffff);
  --vd-bg-muted: var(--bgColor-muted, #f6f8fa);
  --vd-border: var(--borderColor-default, #d1d9e0);
  --vd-success: var(--fgColor-success, #1a7f37);
  --vd-danger: var(--fgColor-danger, #d1242f);
  --vd-accent: var(--fgColor-accent, #0969da);
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
dialog {
  width: min(1200px, calc(100vw - 32px));
  height: calc(100vh - 48px);
  max-height: none;
  padding: 0;
  border: 1px solid var(--vd-border);
  border-radius: 12px;
  background: var(--vd-bg);
  color: var(--vd-fg);
  box-shadow: var(--vd-shadow);
}
dialog[open] { display: flex; flex-direction: column; animation: appear 140ms ease-out; }
dialog::backdrop { background: rgba(31, 35, 40, 0.4); }
@keyframes appear { from { opacity: 0; transform: translateY(6px); } }
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
.body { flex: 1; min-height: 0; display: flex; }
main { position: relative; flex: 1; min-width: 0; overflow: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }

nav.files { position: relative; flex: none; width: 280px; overflow: auto; padding: 8px; border-right: 1px solid var(--vd-border); font-size: 12px; }
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
.diff[data-uniform] .marker { display: none; }
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
@media (prefers-reduced-motion: reduce) { dialog[open] { animation: none; } .chevron, .files .folder svg { transition: none; } }
`;

/** A modal that shows how a pull request's own changes differ between two of its versions. */
export class VersionsDialog {
  private readonly host: HTMLElement;
  private readonly dialog: HTMLDialogElement;
  private generation = 0;

  constructor() {
    this.host = document.createElement("flohub-versions");
    const shadow = this.host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = DIALOG_STYLES;
    this.dialog = el("dialog", { "aria-labelledby": "versions-title" });
    shadow.append(style, this.dialog);
    for (const type of ["keydown", "keyup", "keypress"]) {
      shadow.addEventListener(type, (event) => event.stopPropagation());
    }
    this.dialog.addEventListener("close", () => {
      this.generation++;
      this.dialog.replaceChildren();
    });
  }

  /** @returns Whether the dialog is showing. */
  get isOpen(): boolean {
    return this.dialog.open;
  }

  /** @param request Where the versions come from. */
  open(request: VersionsDialogRequest): void {
    if (!this.host.isConnected) document.body.append(this.host);
    const run = ++this.generation;
    const live = () => run === this.generation;

    const close = el("button", { type: "button", class: "close" }, "Close");
    close.addEventListener("click", () => this.dialog.close());
    const titleRow = el("div", { class: "title-row" });
    titleRow.append(el("h2", { id: "versions-title" }, `Compare versions of #${request.number}`), close);
    const controls = el("div", { class: "controls" });
    const summary = el("p", { class: "summary", "aria-live": "polite" });
    const legend = el("p", { class: "legend" });
    const error = el("p", { class: "error", role: "alert" });
    const header = el("header");
    header.append(titleRow, controls, summary, legend, error);
    const files = el("nav", { class: "files", "aria-label": "Files" });
    const main = el("main");
    main.append(el("p", { class: "message", role: "status" }, "Loading versions…"));
    const body = el("div", { class: "body" });
    body.append(files, main);
    this.dialog.replaceChildren(header, body);
    if (!this.dialog.open) this.dialog.showModal();
    close.focus();

    void request.versions().then(
      // oxlint-disable-next-line promise/always-return -- the chain ends here; nothing reads what it resolves to
      (history) => {
        if (!live()) return;
        const range = defaultRange(history.versions);
        if (!range) {
          main.replaceChildren(
            el("p", { class: "message" }, "This pull request has only one known version. Versions come from force pushes and reviews."),
          );
          return;
        }
        const now = Date.now();
        const from = versionSelect("From", history.versions, range.from, now);
        const to = versionSelect("To", history.versions, range.to, now);
        const link = el("a", { target: "_blank", rel: "noopener" }, "GitHub's compare");
        const wrap = el("input", { type: "checkbox" });
        wrap.addEventListener("change", () => main.classList.toggle("wrap", wrap.checked));
        const wrapLabel = el("label", { class: "wrap-toggle" });
        wrapLabel.append(wrap, "Wrap lines");
        controls.append(from.label, el("span", { class: "arrow", "aria-hidden": "true" }, "→"), to.label, link, wrapLabel);

        let shown = 0;
        let tracking: AbortController | undefined;
        const show = async () => {
          tracking?.abort();
          tracking = new AbortController();
          const { signal } = tracking;
          const showing = ++shown;
          const older = history.versions[Number(from.select.value) - 1];
          const newer = history.versions[Number(to.select.value) - 1];
          if (!older || !newer) return;
          link.href = `${request.repoUrl}/compare/${older.oid}..${newer.oid}`;
          link.title = "GitHub's plain compare of the two heads, including everything the base branch gained in between";
          error.textContent = "";
          summary.textContent = "";
          legend.replaceChildren();
          files.replaceChildren();
          main.replaceChildren(el("p", { class: "message", role: "status" }, `Comparing v${older.number} with v${newer.number}…`));
          try {
            const [before, after] = await Promise.all([request.patch(history, older), request.patch(history, newer)]);
            if (!live() || showing !== shown) return;
            renderResult({ main, summary, legend, files, signal }, interdiff(before.files, after.files), {
              older,
              newer,
              before,
              after,
              history,
              repoUrl: request.repoUrl,
            });
          } catch (failure) {
            if (!live() || showing !== shown) return;
            main.replaceChildren();
            error.textContent = failure instanceof Error ? failure.message : "Could not compare the versions.";
          }
        };
        from.select.addEventListener("change", () => void show());
        to.select.addEventListener("change", () => void show());
        void show();
      },
      (failure: unknown) => {
        if (!live()) return;
        main.replaceChildren();
        error.textContent = failure instanceof Error ? failure.message : "Could not load the versions.";
      },
    );
  }
}

function versionSelect(name: string, versions: Version[], selected: number, now: number) {
  const select = el("select");
  for (const version of versions.toReversed()) {
    const option = el("option", { value: String(version.number) }, describeVersion(version, now));
    option.selected = version.number === selected;
    select.append(option);
  }
  const label = el("label", {}, name);
  label.append(select);
  return { label, select };
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
  older: Version;
  newer: Version;
  before: VersionPatch;
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

function renderResult({ main, summary, legend, files: nav, signal }: Slots, files: FileInterdiff[], context: Context): void {
  // Past GitHub's file limit, a file only one version lists may just be cut off from the other's list.
  const truncated = context.before.truncated || context.after.truncated;
  const shown = truncated ? files.filter((file) => file.change !== "added" && file.change !== "dropped") : files;
  const differing = shown.filter((file) => file.change !== "unchanged" && file.change !== "opaque");
  const opaque = shown.filter((file) => file.change === "opaque");
  const unchanged = shown.filter((file) => file.change === "unchanged");
  const headline = differing.length === 0 ? "No differences." : `${differing.length} of ${shown.length} files differ.`;
  const uncompared = opaque.length === 0 ? "" : ` ${opaque.length} can't be compared.`;
  summary.replaceChildren(
    el("strong", {}, `${headline}${uncompared}`),
    ` Shows the pull request's own changes, and how they differ between v${context.older.number} and v${context.newer.number}, ignoring what the base branch gained.`,
  );
  if (differing.length > 0) {
    const marks = el("span");
    marks.append(
      el("kbd", {}, "+"),
      " ",
      el("kbd", {}, "−"),
      " beside the code: what the pull request does to the line",
    );
    legend.replaceChildren(legendEntry("new", `Only in v${context.newer.number}`), legendEntry("gone", `Only in v${context.older.number}`), marks);
  }

  const content: Node[] = [];
  if (truncated) {
    content.push(
      el(
        "p",
        { class: "hint" },
        "GitHub lists at most 300 files per version, so files only one version lists are left out: they may just be past the cut.",
      ),
    );
  }
  const offBase = [context.before, context.after].some((patch) => !patch.onBase) && context.history.baseHeads.length > 0;
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
  for (const file of filesInOrder(tree)) {
    const section = renderFile(file, context);
    sections.set(file, section);
    content.push(section);
  }
  if (unchanged.length > 0) {
    const details = el("details", { class: "unchanged" });
    details.append(el("summary", {}, `${unchanged.length} ${unchanged.length === 1 ? "file makes" : "files make"} the same change in both versions`));
    const list = el("ul");
    for (const file of unchanged) list.append(el("li", {}, file.oldPath ? `${file.oldPath} → ${file.path}` : file.path));
    details.append(list);
    content.push(details);
  }
  main.replaceChildren(...content);
  if (sections.size > 0) renderFileTree(nav, tree, sections, main, signal);
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
): void {
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

function renderFile(file: FileInterdiff, context: Context): HTMLDetailsElement {
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
    if (!file.diffless) return details;
    const reason =
      file.change === "opaque"
        ? "GitHub shows no diff for this file (binary, or too large), so it can't be compared. Its content differs between the versions, which may only be because the base branch changed it."
        : "GitHub shows no diff for this file (binary, or too large).";
    details.append(el("p", { class: "note" }, reason));
    return details;
  }
  const diff = el("div", { class: "diff" });
  const language = languageFor(file.path);
  const syntax = language ? highlightLines(file.lines, language) : [];
  // A new file's patch is all added lines: its markers and its empty base-side numbers would only repeat that.
  const uniform = uniformKind(file.lines);
  if (uniform) diff.dataset.uniform = uniform;
  const rows = (start: number, end: number) => file.lines.slice(start, end).map((line, index) => renderLine(line, context, syntax[start + index]));
  let shown = 0;
  for (const hunk of file.hunks) {
    if (hunk.start > shown) diff.append(expander(hunk.start - shown, rows.bind(null, shown, hunk.start)));
    diff.append(...rows(hunk.start, hunk.start + hunk.lines.length));
    shown = hunk.start + hunk.lines.length;
  }
  if (shown < file.lines.length) diff.append(expander(file.lines.length - shown, rows.bind(null, shown, file.lines.length)));
  details.append(diff);
  return details;
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
    : (exists(file.status.before) ? [context.older, file.oldPath ?? file.path] : [null, null]);
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
