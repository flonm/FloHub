import { formatAge } from "../core/age";
import { el } from "./dom";
import type { VersionPatch } from "../api/github";
import { type FileChange, type FileInterdiff, interdiff } from "../core/interdiff";
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
  --vd-del-bg: var(--diffBlob-deletionLine-bgColor, #ffebe9);
  --vd-hunk-bg: var(--diffBlob-hunkLine-bgColor, #ddf4ff);
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
  padding: 6px 12px;
  border-radius: 6px 6px 0 0;
  background: var(--vd-bg-muted);
  cursor: pointer;
}
details.file:not([open]) > summary { border-radius: 6px; }
.path { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 600; word-break: break-all; }
.old-path { color: var(--vd-muted); font-weight: 400; }
.badge { padding: 0 8px; border: 1px solid currentColor; border-radius: 999px; font-size: 12px; font-weight: 600; }
.counts { margin-left: auto; font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
.counts .add { color: var(--vd-success); }
.counts .del { color: var(--vd-danger); }
[data-tone="success"] { color: var(--vd-success); }
[data-tone="danger"] { color: var(--vd-danger); }
[data-tone="attention"] { color: var(--vd-attention); }
[data-tone="muted"] { color: var(--vd-muted); }
.note { margin: 0; padding: 8px 12px; color: var(--vd-muted); font-size: 12px; }

.diff { overflow-x: auto; font: 12px/20px ui-monospace, SFMono-Regular, Menlo, monospace; }
.line { display: flex; min-width: max-content; }
.line > span { white-space: pre; }
.outer, .inner { flex: none; width: 2ch; text-align: center; user-select: none; }
.outer { color: var(--vd-muted); }
.code { padding-right: 16px; }
.line[data-outer="+"] { background: var(--vd-add-bg); }
.line[data-outer="-"] { background: var(--vd-del-bg); }
.line[data-outer="+"] .outer { color: var(--vd-success); font-weight: 700; }
.line[data-outer="-"] .outer { color: var(--vd-danger); font-weight: 700; }
.line[data-inner="+"] .inner, .line[data-inner="+"] .code { color: var(--vd-success); }
.line[data-inner="-"] .inner, .line[data-inner="-"] .code { color: var(--vd-danger); }
.line[data-inner="meta"] .code { color: var(--vd-muted); }
.line[data-inner="meta"] { background: var(--vd-hunk-bg); }
.line[data-inner="meta"][data-outer="+"] { background: var(--vd-add-bg); }
.line[data-inner="meta"][data-outer="-"] { background: var(--vd-del-bg); }
.gap { padding: 0 12px; color: var(--vd-muted); background: var(--vd-bg-muted); font-size: 12px; line-height: 20px; }

details.unchanged > summary { color: var(--vd-muted); cursor: pointer; }
details.unchanged ul { margin: 6px 0 0; padding-left: 20px; font: 12px/20px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--vd-muted); }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (prefers-reduced-motion: reduce) { dialog[open] { animation: none; } }
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
    const error = el("p", { class: "error", role: "alert" });
    const header = el("header");
    header.append(titleRow, controls, summary, error);
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
        controls.append(from.label, el("span", { class: "arrow", "aria-hidden": "true" }, "→"), to.label, link);

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
          main.replaceChildren(el("p", { class: "message", role: "status" }, `Comparing v${older.number} with v${newer.number}…`));
          try {
            const [before, after] = await Promise.all([request.patch(history, older), request.patch(history, newer)]);
            if (!live() || showing !== shown) return;
            renderResult(main, summary, interdiff(before.files, after.files), { older, newer, before, after, history });
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
}

function renderResult(main: HTMLElement, summary: HTMLElement, files: FileInterdiff[], context: Context): void {
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
    ` Shows how the pull request's own changes differ between v${context.older.number} and v${context.newer.number}: lines marked on the left changed between the versions, ignoring what the base branch gained.`,
  );

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
  for (const file of compared) content.push(renderFile(file));
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

function renderFile(file: FileInterdiff): HTMLElement {
  const change = CHANGE[file.change];
  const details = el("details", { class: "file", open: "" });
  const head = el("summary");
  const path = el("span", { class: "path" });
  if (file.oldPath) path.append(el("span", { class: "old-path" }, `${file.oldPath} → `));
  path.append(file.path);
  const counts = el("span", { class: "counts" });
  if (file.added > 0) counts.append(el("span", { class: "add", "aria-hidden": "true" }, `+${file.added}`), " ");
  if (file.removed > 0) counts.append(el("span", { class: "del", "aria-hidden": "true" }, `−${file.removed}`));
  if (file.added > 0 || file.removed > 0) {
    counts.append(el("span", { class: "visually-hidden" }, `${file.added} lines added, ${file.removed} removed between the versions`));
  }
  head.append(path, el("span", { class: "badge", "data-tone": change.tone }, change.label), counts);
  details.append(head);

  if (file.hunks.length === 0) {
    const reason =
      file.change === "opaque"
        ? "GitHub shows no diff for this file (binary, or too large), so it can't be compared. Its content differs between the versions, which may only be because the base branch changed it."
        : "GitHub shows no diff for this file (binary, or too large).";
    details.append(el("p", { class: "note" }, reason));
    return details;
  }
  const diff = el("div", { class: "diff" });
  for (const [index, hunk] of file.hunks.entries()) {
    if (index > 0) diff.append(el("div", { class: "gap", "aria-hidden": "true" }, "⋯"));
    for (const line of hunk.lines) diff.append(renderLine(line.mark, line.text));
  }
  details.append(diff);
  return details;
}

function renderLine(outer: string, text: string): HTMLElement {
  const [first] = text;
  const meta = first !== "+" && first !== "-" && first !== " " && first !== "\\";
  const row = el("div", { class: "line", "data-outer": outer, "data-inner": meta ? "meta" : first });
  row.append(
    el("span", { class: "outer" }, outer === " " ? " " : outer),
    el("span", { class: "inner" }, meta ? "" : first),
    el("span", { class: "code" }, meta ? text : text.slice(1)),
  );
  return row;
}
