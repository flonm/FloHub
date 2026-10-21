import { formatAge } from "../core/age";
import { renderRichText } from "../core/rich-text";
import type { PostingMode, ReviewThread, ThreadComment } from "../core/threads";
import { el, icon } from "./dom";

/** The thread's styles, for the shadow root it's drawn in. They read the versions view's `--vd-` tokens. */
export const THREAD_STYLES = `
.thread-row, .composer-row {
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
.thread-actions { display: flex; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--vd-border); }
.thread-actions .resolve { margin-left: auto; }
.box { display: flex; flex-direction: column; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--vd-border); }
.composer { border: 1px solid var(--vd-border); border-radius: 6px; background: var(--vd-bg); }
.composer > .box { border-top: 0; }
.box .title { margin: 0; color: var(--vd-muted); font-size: 12px; }
.box textarea {
  min-height: 72px;
  padding: 8px;
  border: 1px solid var(--vd-border);
  border-radius: 6px;
  background: var(--vd-bg);
  color: var(--vd-fg);
  font: inherit;
  resize: vertical;
}
.box textarea:focus { outline: 2px solid var(--vd-accent); outline-offset: -1px; }
.box .buttons { display: flex; justify-content: flex-end; gap: 8px; }
.box .problem { margin: 0; color: var(--vd-danger, #d1242f); font-size: 12px; }
.box .problem:empty { display: none; }
.btn {
  min-height: 28px;
  padding: 0 12px;
  border: 1px solid var(--vd-border);
  border-radius: 6px;
  background: var(--vd-bg-muted);
  color: var(--vd-fg);
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  line-height: 26px;
  cursor: pointer;
}
.btn.primary { border-color: transparent; background: var(--button-primary-bgColor-rest, #1f883d); color: var(--button-primary-fgColor-rest, #ffffff); }
.btn:disabled { opacity: 0.6; cursor: default; }
.btn:focus-visible { outline: 2px solid var(--vd-accent); outline-offset: 1px; }
`;

/** What the viewer can do to a thread from the versions view. */
export interface ThreadActions {
  /** "Reply", or "Add review comment" while the viewer has a pending review the reply joins. */
  replyLabel: string;
  /** Resolves once posted; rejects with a message to show. */
  reply: (body: string) => Promise<void>;
  /** Resolves once done; rejects with a message to show. */
  setResolved: (resolved: boolean) => Promise<void>;
}

/**
 * A review thread as the versions view shows it under its line: open while it's unresolved, folded to one line once
 * resolved, with the comments' authors, ages and bodies as GitHub renders them.
 * @param thread The thread.
 * @param now The current time.
 * @returns The thread.
 */
export function renderThread(thread: ReviewThread, now: number, actions?: ThreadActions): HTMLDetailsElement {
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
  if (actions) details.append(threadActions(thread, actions));
  return details;
}

/**
 * @param thread The thread.
 * @param actions What the viewer can do to it.
 * @returns The thread's Reply and Resolve buttons, and the reply box Reply opens.
 */
function threadActions(thread: ReviewThread, actions: ThreadActions): HTMLElement {
  const footer = el("div");
  const buttons = el("div", { class: "thread-actions" });
  const replyButton = el("button", { type: "button", class: "btn" }, "Reply");
  const resolve = el("button", { type: "button", class: "btn resolve" }, thread.resolved ? "Unresolve conversation" : "Resolve conversation");
  const problem = el("p", { class: "problem", role: "alert" });
  const toggle = async () => {
    resolve.disabled = true;
    try {
      await actions.setResolved(!thread.resolved);
    } catch (failure) {
      resolve.disabled = false;
      problem.textContent = failure instanceof Error ? failure.message : "Could not change the conversation.";
    }
  };
  resolve.addEventListener("click", () => void toggle());
  buttons.append(replyButton, resolve);
  replyButton.addEventListener("click", () => {
    const box = writeBox({
      title: null,
      placeholder: "Reply…",
      submits: [{ label: actions.replyLabel, primary: true, run: actions.reply }],
      cancel: () => {
        box.remove();
        buttons.hidden = false;
      },
    });
    buttons.hidden = true;
    footer.append(box);
    box.querySelector("textarea")?.focus();
  });
  footer.append(buttons, problem);
  return footer;
}

/** One way to post what's written in a box. */
interface Submit {
  label: string;
  primary?: boolean;
  /** Resolves once posted; rejects with a message to show, keeping the text. */
  run: (body: string) => Promise<void>;
}

/**
 * @param options The box's title, placeholder, ways to post and how to cancel.
 * @returns A box to write a comment in. It keeps its text, and says why, when posting fails.
 */
function writeBox(options: { title: string | null; placeholder: string; submits: Submit[]; note?: string; cancel: () => void }): HTMLElement {
  const box = el("div", { class: "box" });
  if (options.title) box.append(el("p", { class: "title" }, options.title));
  const text = el("textarea", { placeholder: options.placeholder, "aria-label": options.title ?? options.placeholder });
  const problem = el("p", { class: "problem", role: "alert" }, options.note ?? "");
  const buttons = el("div", { class: "buttons" });
  const cancel = el("button", { type: "button", class: "btn" }, "Cancel");
  cancel.addEventListener("click", () => options.cancel());
  buttons.append(cancel);
  const posts = options.submits.map((submit) => {
    const post = el("button", { type: "button", class: submit.primary ? "btn primary" : "btn" }, submit.label);
    post.disabled = true;
    const send = async () => {
      const body = text.value.trim();
      if (!body) return;
      for (const each of [text, cancel, ...posts]) each.disabled = true;
      problem.textContent = "";
      try {
        await submit.run(body);
        // Posted: the text no longer holds the box open, so the thread's refresh replaces it.
        text.value = "";
      } catch (failure) {
        for (const each of [text, cancel, ...posts]) each.disabled = false;
        problem.textContent = failure instanceof Error ? failure.message : "Could not post the comment.";
      }
    };
    post.addEventListener("click", () => void send());
    return post;
  });
  text.addEventListener("input", () => {
    for (const post of posts) post.disabled = text.value.trim() === "";
  });
  text.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      options.cancel();
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      (posts.find((post) => post.classList.contains("primary")) ?? posts[0])?.click();
    }
  });
  buttons.append(...posts);
  box.append(text, problem, buttons);
  return box;
}

/**
 * A box for a new comment on lines of the head, with GitHub's choices for how it goes out: on its own or starting a
 * review, or into the pending review. While the viewer's pending review sits on an older version, it only says so.
 * @param options What the comment is on, how it can be posted, and how to post or cancel it.
 * @returns The box.
 */
export function renderComposer(options: {
  title: string;
  mode: PostingMode;
  post: (mode: "single" | "review", body: string) => Promise<void>;
  cancel: () => void;
}): HTMLElement {
  const composer = el("div", { class: "composer" });
  const submits: Submit[] =
    options.mode === "fresh"
      ? [
          { label: "Start a review", run: async (body) => options.post("review", body) },
          { label: "Add single comment", primary: true, run: async (body) => options.post("single", body) },
        ]
      : (options.mode === "review"
        ? [{ label: "Add review comment", primary: true, run: async (body) => options.post("review", body) }]
        : []);
  const note =
    options.mode === "blocked" ? "Your pending review is on an older version. Submit it, then comment on the current one." : undefined;
  composer.append(writeBox({ title: options.title, placeholder: "Leave a comment", submits, ...(note && { note }), cancel: options.cancel }));
  return composer;
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
