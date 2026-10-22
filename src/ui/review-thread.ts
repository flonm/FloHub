import { formatAge } from "../core/age";
import { renderRichText } from "../core/rich-text";
import type { ReviewThread, ThreadComment } from "../core/threads";
import { el, icon } from "./dom";

/** The thread's styles, for the shadow root it's drawn in. They read the versions view's `--vd-` tokens. */
export const THREAD_STYLES = `
.thread-row {
  position: sticky;
  left: 0;
  width: min(760px, calc(100cqw - 32px));
  padding: 8px 12px 8px 116px;
  font: 14px/1.5 var(--fontStack-sansSerif, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif);
  white-space: normal;
}
.thread { border: 1px solid var(--vd-border); border-radius: 6px; background: var(--vd-bg); overflow: hidden; }
.thread > summary { display: flex; align-items: center; gap: 8px; padding: 6px 12px; color: var(--vd-muted); font-size: 12px; cursor: pointer; list-style: none; }
.thread > summary::-webkit-details-marker { display: none; }
.thread[open] > summary { border-bottom: 1px solid var(--vd-border); }
.thread svg { width: 14px; height: 14px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
.thread .chip { padding: 0 6px; border: 1px solid var(--vd-border); border-radius: 2em; font-weight: 600; }
.thread .chip[data-tone="done"] { color: var(--vd-done, #8250df); border-color: currentColor; }
.thread .chip[data-tone="attention"] { color: var(--vd-attention); border-color: currentColor; }
.thread ol { margin: 0; padding: 0; list-style: none; }
.thread li + li { border-top: 1px solid var(--vd-border); }
.comment { padding: 8px 12px; }
.comment header { display: flex; align-items: center; gap: 6px; padding: 0; border: 0; font-size: 12px; color: var(--vd-muted); }
.comment header img { width: 20px; height: 20px; border-radius: 50%; }
.comment header strong { color: var(--vd-fg); }
.comment header a { margin-left: auto; color: var(--vd-accent); text-decoration: none; }
.comment .body { margin-top: 4px; overflow-wrap: anywhere; }
.comment .body > :first-child { margin-top: 0; }
.comment .body > :last-child { margin-bottom: 0; }
.comment .body pre { padding: 8px; border-radius: 6px; background: var(--vd-bg-muted); overflow: auto; }
.comment .body code { font: 12px var(--vd-mono); }
.comment .body img { max-width: 100%; }
`;

/**
 * A review thread as the versions view shows it under its line: open while it's unresolved, folded to one line once
 * resolved, with the comments' authors, ages and bodies as GitHub renders them.
 * @param thread The thread.
 * @param now The current time.
 * @returns The thread.
 */
export function renderThread(thread: ReviewThread, now: number): HTMLDetailsElement {
  const details = el("details", { class: "thread", "data-thread": thread.id });
  details.open = !thread.resolved;
  const summary = el("summary");
  summary.append(icon("comment"));
  const [first] = thread.comments;
  const count = thread.comments.length;
  summary.append(el("span", {}, `${first?.author ?? "Someone"}${count > 1 ? ` and ${count - 1} more ${count === 2 ? "reply" : "replies"}` : ""}`));
  if (thread.resolved) summary.append(el("span", { class: "chip", "data-tone": "done" }, "Resolved"));
  if (thread.outdated) summary.append(el("span", { class: "chip", "data-tone": "attention" }, "Outdated"));
  if (thread.comments.some((comment) => comment.pending)) summary.append(el("span", { class: "chip" }, "Pending"));
  const list = el("ol");
  for (const comment of thread.comments) list.append(renderComment(comment, now));
  details.append(summary, list);
  return details;
}

function renderComment(comment: ThreadComment, now: number): HTMLLIElement {
  const item = el("li", { class: "comment" });
  const header = el("header");
  if (comment.avatarUrl) header.append(el("img", { src: comment.avatarUrl, alt: "" }));
  header.append(el("strong", {}, comment.author ?? "ghost"), el("span", {}, formatAge(comment.createdAt, now).spoken));
  if (comment.pending) header.append(el("span", { class: "chip" }, "Pending"));
  if (comment.url) header.append(el("a", { href: comment.url, target: "_blank", rel: "noopener" }, "View on GitHub"));
  const body = el("div", { class: "body" });
  body.append(renderRichText(comment.html) ?? el("p", {}, "This comment can't be shown here."));
  item.append(header, body);
  return item;
}
