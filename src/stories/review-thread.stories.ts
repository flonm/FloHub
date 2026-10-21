import type { Meta, StoryObj } from "@storybook/html-vite";
import type { ReviewThread, ThreadComment } from "../core/threads";
import { renderThread, THREAD_STYLES } from "../ui/review-thread";
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
  comments: [comment()],
  ...overrides,
});

/**
 * Draws a thread the way the versions view does under its line.
 * @param shown The thread.
 * @returns The thread in a shadow root with the view's styles.
 */
function render(shown: ReviewThread): HTMLElement {
  const host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = TOKENS + THREAD_STYLES;
  const row = document.createElement("div");
  row.className = "thread-row";
  row.append(renderThread(shown, NOW));
  shadow.append(style, row);
  return host;
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
export const Resolved: Story = { render: () => render(thread({ resolved: true })) };

/** An outdated thread: its lines are gone from the current diff, but the view shows it where it was written. */
export const Outdated: Story = { render: () => render(thread({ outdated: true, line: null })) };

/** The viewer's draft comment in their pending review, which only they see until they submit the review. */
export const Pending: Story = {
  render: () => render(thread({ comments: [comment({ author: "you", pending: true, html: "<p>Nit: name this <code>RETRY_DELAY_MS</code>.</p>" })] })),
};
