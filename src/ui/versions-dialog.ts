import { formatAge } from "../core/age";
import { el, icon } from "./dom";
import type { VersionPatch } from "../api/github";
import { diffstat, type FileChange, type FileInterdiff, headerLabels, type InterdiffLine, interdiff, splitLine } from "../core/interdiff";
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

const CHANGE: Record<FileChange, { label: string; tone: string }> = {
  changed: { label: "Changed", tone: "attention" },
  added: { label: "Newly changed", tone: "success" },
  dropped: { label: "No longer changed", tone: "danger" },
  opaque: { label: "Can't compare", tone: "muted" },
  unchanged: { label: "Unchanged", tone: "muted" },
};

const DIALOG_STYLES = `
:host {
  --vd-fg: var(--fgColor-default, #1f2328);
  --vd-muted: var(--fgColor-muted, #59636e);
  --vd-bg: var(--bgColor-default, #ffffff);
  --vd-bg-muted: var(--bgColor-muted, #f6f8fa);
  --vd-border: var(--borderColor-default, #d1d9e0);
  --vd-success: var(--fgColor-success, #1a7f37);
  --vd-danger: var(--fgColor-danger, #d1242f);
  --vd-attention: var(--fgColor-attention, #9a6700);
  --vd-accent: var(--fgColor-accent, #0969da);
  --vd-add-bg: var(--diffBlob-additionLine-bgColor, #dafbe1);
  --vd-add-num-bg: var(--diffBlob-additionNum-bgColor, #d1f8d9);
  --vd-del-bg: var(--diffBlob-deletionLine-bgColor, #ffebe9);
  --vd-del-num-bg: var(--diffBlob-deletionNum-bgColor, #ffcecb);
  --vd-hunk-bg: var(--diffBlob-hunkLine-bgColor, #ddf4ff);
  --vd-hunk-num-bg: var(--diffBlob-hunkNum-bgColor-rest, #b6e3ff);
  --vd-new-word: var(--borderColor-attention-muted, rgba(212, 167, 44, 0.4));
  --vd-gone-word: var(--borderColor-danger-muted, rgba(255, 129, 130, 0.4));
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
main { flex: 1; overflow: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
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
.chip[data-mark="+"], .chip[data-mark="-"] { border-left: 3px solid; border-radius: 0 6px 6px 0; }
.chip[data-mark="+"] { border-left-color: var(--vd-attention); color: var(--vd-fg); }
.chip[data-mark="-"] { border-left-color: var(--vd-danger); text-decoration: line-through; }
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
[data-tone="attention"] { color: var(--vd-attention); }
[data-tone="muted"] { color: var(--vd-muted); }
.note { margin: 0; padding: 8px 12px; color: var(--vd-muted); font-size: 12px; }

.legend:empty { display: none; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 0; color: var(--vd-muted); font-size: 12px; }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.legend i { width: 3px; height: 14px; border-radius: 1px; }
.legend .new i { background: var(--vd-attention); }
.legend .gone i { background: var(--vd-danger); }
.legend .gone s { color: inherit; }
.wrap-toggle { margin-left: auto; font-weight: 400 !important; font-size: 12px; }

.diff { overflow-x: auto; font: 12px/20px var(--vd-mono); }
.line { display: flex; min-width: max-content; }
.num {
  flex: none;
  width: 48px;
  padding: 0 8px;
  text-align: right;
  color: var(--vd-muted);
  user-select: none;
}
.marker { flex: none; width: 22px; padding-left: 8px; user-select: none; }
.code { flex: 1; padding-right: 16px; white-space: pre; }
.wrap .line { min-width: 0; }
.wrap .code { white-space: pre-wrap; overflow-wrap: anywhere; }
.line[data-kind="+"] { background: var(--vd-add-bg); }
.line[data-kind="+"] .num { background: var(--vd-add-num-bg); }
.line[data-kind="-"] { background: var(--vd-del-bg); }
.line[data-kind="-"] .num { background: var(--vd-del-num-bg); }
.line[data-kind="hunk"] { background: var(--vd-hunk-bg); color: var(--vd-muted); }
.line[data-kind="hunk"] .num { background: var(--vd-hunk-num-bg); }
.line[data-outer="+"] .num:first-child { box-shadow: inset 3px 0 0 var(--vd-attention); }
.line[data-outer="-"] .num:first-child { box-shadow: inset 3px 0 0 var(--vd-danger); }
.line[data-outer="-"] .code, .line[data-outer="-"] .marker { color: var(--vd-muted); }
.line[data-outer="-"]:not([data-words]) .text { text-decoration: line-through; }
.line[data-outer="+"] .word { border-radius: 3px; background: var(--vd-new-word); }
.line[data-outer="-"] .word { border-radius: 3px; background: var(--vd-gone-word); text-decoration: line-through; }
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
.expander .num { display: flex; justify-content: center; align-items: center; width: 96px; background: var(--vd-hunk-num-bg); }
.expander .code { padding-left: 8px; }
.expander:hover, .expander:hover .num { background: var(--vd-accent); color: var(--vd-bg); }

details.unchanged > summary { color: var(--vd-muted); cursor: pointer; }
details.unchanged ul { margin: 6px 0 0; padding-left: 20px; font: 12px/20px var(--vd-mono); color: var(--vd-muted); }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; user-select: none; }
@media (prefers-reduced-motion: reduce) { dialog[open] { animation: none; } .chevron { transition: none; } }
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
    const main = el("main");
    main.append(el("p", { class: "message", role: "status" }, "Loading versions…"));
    this.dialog.replaceChildren(header, main);
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
        const show = async () => {
          const showing = ++shown;
          const older = history.versions[Number(from.select.value) - 1];
          const newer = history.versions[Number(to.select.value) - 1];
          if (!older || !newer) return;
          link.href = `${request.repoUrl}/compare/${older.oid}..${newer.oid}`;
          link.title = "GitHub's plain compare of the two heads, including everything the base branch gained in between";
          error.textContent = "";
          summary.textContent = "";
          legend.replaceChildren();
          main.replaceChildren(el("p", { class: "message", role: "status" }, `Comparing v${older.number} with v${newer.number}…`));
          try {
            const [before, after] = await Promise.all([request.patch(history, older), request.patch(history, newer)]);
            if (!live() || showing !== shown) return;
            renderResult({ main, summary, legend }, interdiff(before.files, after.files), {
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
}

function renderResult({ main, summary, legend }: Slots, files: FileInterdiff[], context: Context): void {
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
    legend.replaceChildren(
      legendEntry("new", `Only in v${context.newer.number}`),
      legendEntry("gone", el("s", {}, `Only in v${context.older.number}`)),
    );
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
  const compared = [...differing, ...opaque].toSorted((a, b) => (a.path < b.path ? -1 : 1));
  for (const file of compared) content.push(renderFile(file, context));
  if (unchanged.length > 0) {
    const details = el("details", { class: "unchanged" });
    details.append(el("summary", {}, `${unchanged.length} ${unchanged.length === 1 ? "file makes" : "files make"} the same change in both versions`));
    const list = el("ul");
    for (const file of unchanged) list.append(el("li", {}, file.oldPath ? `${file.oldPath} → ${file.path}` : file.path));
    details.append(list);
    content.push(details);
  }
  main.replaceChildren(...content);
}

function legendEntry(className: string, text: Node | string): HTMLElement {
  const item = el("span", { class: className });
  item.append(el("i", { "aria-hidden": "true" }), text);
  return item;
}

function renderFile(file: FileInterdiff, context: Context): HTMLElement {
  const change = CHANGE[file.change];
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
  let shown = 0;
  for (const hunk of file.hunks) {
    if (hunk.start > shown) diff.append(expander(file.lines.slice(shown, hunk.start), context));
    for (const line of hunk.lines) diff.append(renderLine(line, context));
    shown = hunk.start + hunk.lines.length;
  }
  if (shown < file.lines.length) diff.append(expander(file.lines.slice(shown), context));
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

function expander(lines: InterdiffLine[], context: Context): HTMLButtonElement {
  const count = lines.length;
  const button = el("button", { type: "button", class: "expander", title: "Expand" });
  const gutter = el("span", { class: "num" });
  gutter.append(icon("unfold"));
  button.append(gutter, el("span", { class: "code" }, `${count} unchanged ${count === 1 ? "line" : "lines"}`));
  button.addEventListener("click", () => {
    button.replaceWith(...lines.map((line) => renderLine(line, context)));
  });
  return button;
}

function outerLabel(mark: "+" | "-", context: Context): string {
  return mark === "+" ? `Only in v${context.newer.number}` : `Only in v${context.older.number}`;
}

function renderLine(line: InterdiffLine, context: Context): HTMLElement {
  const { kind, code } = splitLine(line.display);
  const row = el("div", { class: "line", "data-outer": line.mark, "data-kind": kind });
  const marker = kind === "+" || kind === "-" ? kind : "";
  const text = el("span", { class: "code" });
  if (line.mark !== " ") text.append(el("span", { class: "visually-hidden" }, `${outerLabel(line.mark, context)}: `));
  if (line.segments?.some((segment) => segment.changed)) {
    row.dataset.words = "";
    for (const segment of line.segments) text.append(segment.changed ? el("span", { class: "word" }, segment.text) : segment.text);
  } else {
    text.append(el("span", { class: "text" }, code));
  }
  row.append(
    el("span", { class: "num" }, line.left === null ? "" : String(line.left)),
    el("span", { class: "num" }, line.right === null ? "" : String(line.right)),
    el("span", { class: "marker" }, marker),
    text,
  );
  return row;
}
