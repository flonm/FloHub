import type { Meta, StoryObj } from "@storybook/html-vite";
import type { ReviewThread, ThreadComment } from "../core/threads";
import { renderComposer, renderThread, THREAD_STYLES, type ThreadActions } from "../ui/review-thread";
import { NOW } from "./shadow";

const HOUR = 3_600_000;

/** The versions view's tokens the thread reads, mapped to GitHub's Primer tokens as the view maps them. */
const TOKENS = `
:host {
  --vd-fg: var(--fgColor-default, #1f2328);
  --vd-muted: var(--fgColor-muted, #59636e);
  --vd-bg: var(--bgColor-default, #ffffff);
  --vd-bg-muted: var(--bgColor-muted, #f6f8fa);
  --vd-border: var(--borderColor-default, #d1d9e0);
  --vd-accent: var(--fgColor-accent, #0969da);
  --vd-attention: var(--fgColor-attention, #9a6700);
  --vd-danger: var(--fgColor-danger, #d1242f);
  --vd-done: var(--fgColor-done, #8250df);
  --vd-mono: var(--fontStack-monospace, ui-monospace, SFMono-Regular, Menlo, monospace);
  display: block;
  container-type: inline-size;
  color: var(--vd-fg);
}
`;

const comment = (overrides: Partial<ThreadComment> = {}): ThreadComment => ({
  id: 1,
  author: "tizian",
  avatarUrl: null,
  html: "<p>Should this retry with a back-off? Three immediate retries hammer the API.</p>",
  createdAt: new Date(NOW - 5 * HOUR).toISOString(),
  url: "https://github.com/octo-org/api/pull/344#discussion_r1",
  pending: false,
  association: "MEMBER",
  originalCommit: "2222222",
  ...overrides,
});

const thread = (overrides: Partial<ReviewThread> = {}): ReviewThread => ({
  id: "PRRT_1",
  path: "src/core/retry.ts",
  resolved: false,
  outdated: false,
  line: 13,
  startLine: null,
  originalLine: 13,
  originalStartLine: null,
  side: "RIGHT",
  resolvedBy: null,
  comments: [comment()],
  ...overrides,
});

/** Posting that takes a moment, then fails, so a story shows the busy state and the error. */
async function failLater(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 600);
  });
  throw new Error("Pull request review thread line must be part of the diff");
}

/** A thread's actions, as the view gives them when it can post. */
const ACTIONS: ThreadActions = { replyLabel: "Reply", reply: failLater, setResolved: failLater };

/**
 * Draws a thread, or a comment box, the way the versions view does under its line.
 * @param content The thread or the box.
 * @param className The row's class.
 * @returns It, in a shadow root with the view's styles.
 */
function inRow(content: HTMLElement, className = "thread-row"): HTMLElement {
  const host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = TOKENS + THREAD_STYLES;
  const row = document.createElement("div");
  row.className = className;
  row.append(content);
  shadow.append(style, row);
  return host;
}

/**
 * @param shown The thread.
 * @param actions What the viewer can do to it; read-only without.
 * @returns The thread under its line.
 */
function render(shown: ReviewThread, actions?: ThreadActions): HTMLElement {
  return inRow(renderThread(shown, { now: NOW, actions, pullAuthor: "mona" }));
}

/**
 * @param mode How the comment can be posted.
 * @returns A box for a new comment.
 */
function composer(mode: "fresh" | "review" | "blocked"): HTMLElement {
  return inRow(renderComposer({ title: "Comment on lines 12–13 of src/core/retry.ts", mode, post: failLater, cancel: () => undefined }), "composer-row");
}

const meta = {
  title: "Stack/Review thread",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "A review thread as the versions view shows it under the line it's on: open while unresolved, folded once resolved, with GitHub's own rendering of each comment.",
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** An open question on a line. */
export const Open: Story = { render: () => render(thread()) };

/** A conversation: the question, the author's answer, and code in a reply. */
export const Conversation: Story = {
  render: () =>
    render(
      thread({
        comments: [
          comment(),
          comment({
            id: 2,
            author: "mona",
            createdAt: new Date(NOW - 2 * HOUR).toISOString(),
            html: "<p>Done, it backs off now:</p><pre><code>export const DELAY_MS = 250; // between attempts</code></pre>",
          }),
          comment({ id: 3, createdAt: new Date(NOW - HOUR).toISOString(), html: "<p>Thanks, <strong>looks good</strong>.</p>" }),
        ],
      }),
    ),
};

/** A resolved thread folds to its summary line; a click opens it. */
export const Resolved: Story = { render: () => render(thread({ resolved: true, resolvedBy: "mona" })) };

/** An outdated thread: its lines are gone from the current diff, but the view shows it where it was written. */
export const Outdated: Story = { render: () => render(thread({ outdated: true, line: null })) };

/** The viewer's draft comment in their pending review, which only they see until they submit the review. */
export const Pending: Story = {
  render: () => render(thread({ comments: [comment({ author: "you", pending: true, html: "<p>Nit: name this <code>RETRY_DELAY_MS</code>.</p>" })] })),
};

/** With posting: Reply opens a box under the thread, and Resolve conversation resolves it. Posting here fails, to show the error. */
export const WithActions: Story = { render: () => render(thread(), ACTIONS) };

/** With a pending review, a reply joins it, as GitHub's own reply does. */
export const ReplyingInAReview: Story = { render: () => render(thread(), { ...ACTIONS, replyLabel: "Add review comment" }) };

/** A resolved thread can be unresolved. */
export const Unresolve: Story = { render: () => render(thread({ resolved: true, resolvedBy: "mona" }), ACTIONS) };

/** A new comment without a pending review: on its own, or starting a review. ⌘↵ posts, Escape cancels. */
export const NewComment: Story = { render: () => composer("fresh") };

/** A new comment while the viewer has a pending review on the head: it joins the review. */
export const NewCommentInAReview: Story = { render: () => composer("review") };

/** The viewer's pending review is on an older version, whose lines a comment here can't name: it says to submit it. */
export const PendingReviewOnAnOlderVersion: Story = { render: () => composer("blocked") };
