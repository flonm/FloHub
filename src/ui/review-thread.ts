import { formatAge } from "../core/age";
import { renderRichText } from "../core/rich-text";
import type { PostingMode, ReviewThread, ThreadComment } from "../core/threads";
import { el, icon } from "./dom";

/**
 * The thread's styles, for the shadow root it's drawn in. They read the versions view's `--vd-` tokens. They share that
 * root with the view's own styles, so the thread's class names are its own: a comment's body once took the view's `.body`
 * layout and laid its paragraphs out side by side.
 */
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
.thread svg { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
.thread > summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--vd-bg-muted);
  color: var(--vd-muted);
  font-size: 12px;
  cursor: pointer;
  list-style: none;
}
.thread > summary::-webkit-details-marker { display: none; }
.thread[open] > summary { border-bottom: 1px solid var(--vd-border); }
.thread .twist { transform: rotate(90deg); transition: transform 120ms; }
.thread[open] .twist { transform: rotate(180deg); }
.thread .labels { display: flex; gap: 4px; margin-left: auto; }
.thread .label {
  padding: 0 7px;
  border: 1px solid var(--vd-border);
  border-radius: 2em;
  color: var(--vd-muted);
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
  white-space: nowrap;
}
.thread .label[data-tone="attention"] { border-color: var(--vd-attention); color: var(--vd-attention); }
.comment { padding: 12px; }
.comment + .comment { border-top: 1px solid var(--vd-border); }
.comment-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.comment-head .avatar { width: 24px; height: 24px; border-radius: 50%; }
.comment-head strong { color: var(--vd-fg); font-weight: 600; }
.comment-head .age { color: var(--vd-muted); font-size: 12px; }
.comment-head .view { margin-left: 4px; color: var(--vd-muted); font-size: 12px; text-decoration: none; }
.comment-head .view:hover { color: var(--vd-accent); }
.comment-body { margin-top: 8px; overflow-wrap: anywhere; }
.comment-body > :first-child { margin-top: 0; }
.comment-body > :last-child { margin-bottom: 0; }
.comment-body pre { padding: 8px; border-radius: 6px; background: var(--vd-bg-muted); overflow: auto; }
.comment-body code { font: 12px var(--vd-mono); }
.comment-body img { max-width: 100%; }
.reply-row { padding: 8px 12px; border-top: 1px solid var(--vd-border); background: var(--vd-bg-muted); }
.reply-row .box { padding: 0; border-top: 0; }
.write-reply {
  width: 100%;
  padding: 5px 12px;
  border: 1px solid var(--vd-border);
  border-radius: 6px;
  background: var(--vd-bg);
  color: var(--vd-muted);
  font: inherit;
  text-align: left;
  cursor: text;
}
.write-reply:focus-visible { outline: 2px solid var(--vd-accent); outline-offset: -1px; }
.thread-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--vd-border);
  background: var(--vd-bg-muted);
  color: var(--vd-muted);
  font-size: 12px;
}
.thread-foot strong { color: var(--vd-fg); font-weight: 600; }
.thread-foot .problem { flex-basis: 100%; }
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
.problem { margin: 0; color: var(--vd-danger, #d1242f); font-size: 12px; }
.problem:empty { display: none; }
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
  /** Called when a reply box closes without posting. */
  closed?: () => void;
}

/** How GitHub labels an author's relation to the repository, for the relations it labels. */
const ASSOCIATIONS: Record<string, string> = {
  OWNER: "Owner",
  MEMBER: "Member",
  COLLABORATOR: "Collaborator",
  CONTRIBUTOR: "Contributor",
  FIRST_TIME_CONTRIBUTOR: "First-time contributor",
};

/**
 * @param thread The thread.
 * @returns Where the thread is, the way GitHub's own thread header says it: "Comment on line R809", with R for the
 * head side and L for the base side.
 */
export function threadPlace(thread: ReviewThread): string {
  const line = thread.line ?? thread.originalLine;
  if (line === null) return "Comment on the file";
  const start = thread.line === null ? thread.originalStartLine : thread.startLine;
  const side = thread.side === "LEFT" ? "L" : "R";
  return start === null || start === line ? `Comment on line ${side}${line}` : `Comment on lines ${side}${start} to ${side}${line}`;
}

/**
 * A review thread as the versions view shows it under its line, laid out like GitHub's own: open while it's
 * unresolved, folded to its header once resolved, with the comments' authors, ages and bodies as GitHub renders them.
 * @param thread The thread.
 * @param options The current time, what the viewer can do to the thread (read-only without), the pull request's
 * author, whose comments are labelled Author, and the version the thread was written on, which its line names.
 * @returns The thread.
 */
export function renderThread(
  thread: ReviewThread,
  options: { now: number; actions?: ThreadActions | undefined; pullAuthor?: string | null; version?: string | null },
): HTMLDetailsElement {
  const details = el("details", { class: "thread", "data-thread": thread.id });
  details.open = !thread.resolved;
  const summary = el("summary");
  // R43 is a side of that version's diff, not a column of the view: naming the version keeps the two apart.
  summary.append(icon("chevron", "twist"), el("span", {}, `${threadPlace(thread)}${options.version ? ` on ${options.version}` : ""}`));
  const labels = el("span", { class: "labels" });
  if (thread.outdated) labels.append(el("span", { class: "label", "data-tone": "attention" }, "Outdated"));
  if (thread.comments.some((comment) => comment.pending)) labels.append(el("span", { class: "label" }, "Pending"));
  if (thread.resolved) labels.append(el("span", { class: "label" }, "Resolved"));
  summary.append(labels);
  details.append(summary);
  for (const comment of thread.comments) details.append(renderComment(comment, options.now, options.pullAuthor ?? null));
  if (options.actions) details.append(...threadActions(thread, options.actions));
  else if (thread.resolved) details.append(resolvedNote(thread));
  return details;
}

function renderComment(comment: ThreadComment, now: number, pullAuthor: string | null): HTMLElement {
  const item = el("div", { class: "comment" });
  // A div, not a header: the versions view styles its own header element.
  const head = el("div", { class: "comment-head" });
  if (comment.avatarUrl) head.append(el("img", { class: "avatar", src: comment.avatarUrl, alt: "" }));
  head.append(el("strong", {}, comment.author ?? "ghost"), el("span", { class: "age" }, formatAge(comment.createdAt, now).spoken));
  const labels = el("span", { class: "labels" });
  const association = comment.association ? ASSOCIATIONS[comment.association] : undefined;
  if (association) labels.append(el("span", { class: "label" }, association));
  if (comment.author !== null && comment.author === pullAuthor) labels.append(el("span", { class: "label" }, "Author"));
  if (comment.pending) labels.append(el("span", { class: "label" }, "Pending"));
  head.append(labels);
  if (comment.url) head.append(el("a", { class: "view", href: comment.url, target: "_blank", rel: "noopener", title: "View on GitHub" }, "View"));
  const body = el("div", { class: "comment-body" });
  body.append(renderRichText(comment.html) ?? el("p", {}, "This comment can't be shown here."));
  item.append(head, body);
  return item;
}

/** @returns The footer's note on who resolved the thread, or a plain footer while nobody did. */
function resolvedNote(thread: ReviewThread): HTMLElement {
  const foot = el("div", { class: "thread-foot" });
  if (thread.resolvedBy) {
    const note = el("span");
    note.append(el("strong", {}, thread.resolvedBy), " marked this thread as resolved");
    foot.append(note);
  }
  return foot;
}

/**
 * @param thread The thread.
 * @param actions What the viewer can do to it.
 * @returns The thread's "Write a reply" row, which opens a reply box, and its footer with Resolve or Unresolve.
 */
function threadActions(thread: ReviewThread, actions: ThreadActions): HTMLElement[] {
  const replyRow = el("div", { class: "reply-row" });
  const writeReply = el("button", { type: "button", class: "write-reply" }, "Write a reply");
  writeReply.addEventListener("click", () => {
    const box = writeBox({
      title: null,
      placeholder: "Write a reply",
      submits: [{ label: actions.replyLabel, primary: true, run: actions.reply }],
      cancel: () => {
        box.replaceWith(writeReply);
        actions.closed?.();
      },
    });
    writeReply.replaceWith(box);
    box.querySelector("textarea")?.focus();
  });
  replyRow.append(writeReply);

  const foot = resolvedNote(thread);
  const resolve = el("button", { type: "button", class: "btn" }, thread.resolved ? "Unresolve comment" : "Resolve comment");
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
  foot.prepend(resolve);
  foot.append(problem);
  return [replyRow, foot];
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
