import type { Meta, StoryObj } from "@storybook/html-vite";
import type { DiscussionItem } from "../core/discussion";
import type { Reviewer } from "../core/reviewers";
import { deriveStack } from "../core/stack";
import type { Version } from "../core/versions";
import { type BarActions, type BarState, ReviewBar } from "../ui/bar";
import { NOW, pull, stack } from "./shadow";

const HOUR = 3_600_000;

const NOOP: BarActions = {
  refresh: () => undefined,
  rerequest: () => undefined,
  poke: () => undefined,
  openOptions: () => undefined,
  toggleStack: () => undefined,
  toggleMerged: () => undefined,
  toggleMinimized: () => undefined,
  compareVersions: () => undefined,
  toggleHighlight: () => undefined,
  toggleDiscussion: () => undefined,
  toggleDiscussionBots: () => undefined,
};

/** @returns A reviewer for the bar's chips. */
function reviewer(overrides: Partial<Reviewer> & Pick<Reviewer, "key" | "name" | "status">): Reviewer {
  return {
    kind: "user",
    avatarUrl: null,
    url: `https://github.com/${overrides.name}`,
    previous: null,
    canRerequest: false,
    canPoke: false,
    ...overrides,
  };
}

const REVIEWERS: Reviewer[] = [
  reviewer({ key: "user:mona", name: "mona", status: "changes_requested" }),
  reviewer({ key: "user:grace", name: "grace", status: "rerequested", previous: "approved" }),
  reviewer({ key: "team:octo-org/reviewers", name: "octo-org/reviewers", kind: "team", status: "pending", canPoke: true }),
  reviewer({ key: "user:linus", name: "linus", status: "dismissed" }),
  reviewer({ key: "user:dependabot", name: "dependabot", kind: "bot", status: "commented" }),
  reviewer({ key: "user:tizian", name: "tizian", status: "approved", canRerequest: true }),
];

const CURRENT = pull(344, "feat(stack): keep stacked layers in sync", { reviewDecision: "APPROVED" }, [2, 4], 3);
const STACK = deriveStack(
  {
    ...CURRENT,
    stack: stack([
      pull(338, "refactor(git): extract the rebase planner", { state: "MERGED", mergedAt: "2026-10-05T12:00:00Z" }, [3, 3], 240),
      CURRENT,
      pull(345, "fix(stack): retarget after the parent merges", { reviewDecision: "CHANGES_REQUESTED" }, [1, 3], 6),
    ]),
  },
  "main",
);

const ALONE = deriveStack({ ...CURRENT, stack: null }, "main");

const DISCUSSION: DiscussionItem[] = [
  {
    key: "r1",
    author: "mona",
    avatarUrl: null,
    profileUrl: "https://github.com/mona",
    bot: false,
    verdict: "changes_requested",
    text: "The retry loop can spin forever when the token is rejected. Please cap it.",
    html: null,
    at: new Date(NOW - 2 * HOUR).toISOString(),
    url: "https://github.com/octo-org/api/pull/344#discussion_r1",
  },
  {
    key: "r2",
    author: "tizian",
    avatarUrl: null,
    profileUrl: "https://github.com/tizian",
    bot: false,
    verdict: "commented",
    text: "Good catch, capped it at three tries.",
    html: null,
    at: new Date(NOW - 40 * 60_000).toISOString(),
    url: "https://github.com/octo-org/api/pull/344#discussion_r2",
  },
];

const SINCE: Version = {
  oid: "1111111",
  number: 2,
  at: new Date(NOW - 8 * HOUR).toISOString(),
  pushedBy: "mona",
  reviewedBy: ["tizian"],
  viewerLatestReview: true,
  current: false,
};
const HEAD: Version = {
  oid: "2222222",
  number: 3,
  at: new Date(NOW - HOUR).toISOString(),
  pushedBy: "mona",
  reviewedBy: [],
  viewerLatestReview: false,
  current: true,
};

/** @returns A ready state, with everything that can be shown turned off unless asked for. */
function ready(overrides: Partial<Extract<BarState, { kind: "ready" }>> = {}): Extract<BarState, { kind: "ready" }> {
  return {
    kind: "ready",
    reviewers: REVIEWERS,
    stack: STACK,
    stackCollapsed: false,
    showMerged: true,
    now: NOW,
    refreshing: false,
    busy: new Set(),
    pokedAt: new Map(),
    notice: null,
    forcePushes: { count: 0, lastAt: null },
    highlight: null,
    discussion: null,
    discussionSeenAt: null,
    discussionLastReview: null,
    discussionExpanded: false,
    showBots: false,
    viewer: "tizian",
    ...overrides,
  };
}

/** @returns The inline bar, rendered once, without the toggles wired up. */
function inline(state: BarState): HTMLElement {
  const instance = new ReviewBar("inline", NOOP);
  instance.render(state);
  return instance.host;
}

/** @returns The inline bar with its stack, merged and discussion toggles live, as on the page. */
function interactive(state: Extract<BarState, { kind: "ready" }>): HTMLElement {
  let current = state;
  const instance = new ReviewBar("inline", {
    ...NOOP,
    toggleStack: () => {
      current = { ...current, stackCollapsed: !current.stackCollapsed };
      instance.render(current);
    },
    toggleMerged: () => {
      current = { ...current, showMerged: !current.showMerged };
      instance.render(current);
    },
    toggleDiscussion: () => {
      current = { ...current, discussionExpanded: !current.discussionExpanded };
      instance.render(current);
    },
    toggleDiscussionBots: () => {
      current = { ...current, showBots: !current.showBots };
      instance.render(current);
    },
  });
  instance.render(current);
  return instance.host;
}

/**
 * @param state What the floating bar shows.
 * @param options Whether to start expanded or shrunk to the edge tab.
 * @returns The floating bar's host.
 */
function floating(state: BarState, options: { expanded?: boolean; minimized?: boolean } = {}): HTMLElement {
  const instance = new ReviewBar("floating", NOOP);
  instance.render(state);
  if (options.minimized) instance.setMinimized(true);
  else if (options.expanded) instance.host.shadowRoot!.querySelector<HTMLElement>(".pill")!.click();
  return instance.host;
}

const meta = {
  title: "Stack/Bar",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "The bar FloHub mounts on every pull request: the stack, each reviewer's verdict with a re-request or poke button, the versions bar and the discussion. Inline it sits under the page header; floating it is a pill that opens a panel. Click the stack heading and the discussion toggles to see them move.",
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The inline bar with a stack, every reviewer status and a hidden notice. */
export const Inline: Story = { render: () => interactive(ready()) };

/** A pull request outside any stack shows a one-entry overview. */
export const InlineNoStack: Story = { render: () => interactive(ready({ stack: ALONE })) };

/** Still fetching the reviewers; the stack from the cache is already there. */
export const InlineLoadingReviewers: Story = { render: () => inline(ready({ reviewers: null })) };

/** The very first paint, before anything is known. */
export const InlineLoading: Story = { render: () => inline({ kind: "loading" }) };

/** No reviewers requested yet. */
export const InlineNoReviewers: Story = { render: () => interactive(ready({ reviewers: [] })) };

/** A token the extension cannot use, with the way to fix it. */
export const InlineSetup: Story = {
  render: () => inline({ kind: "setup", message: "Add a GitHub token to see reviewers and the stack." }),
};

/** A refresh that failed, with a retry. */
export const InlineError: Story = {
  render: () => inline({ kind: "error", message: "Could not reach api.github.com." }),
};

/** A re-request and a poke in flight, and a notice under the chips. */
export const InlineBusy: Story = {
  render: () =>
    inline(
      ready({
        refreshing: true,
        busy: new Set(["user:grace", "team:octo-org/reviewers"]),
        notice: "Could not poke octo-org/reviewers: Resource not accessible by personal access token",
      }),
    ),
};

/** Force-pushes and highlighted changes since the viewer's review. */
export const InlineVersions: Story = {
  render: () =>
    inline(
      ready({
        forcePushes: { count: 3, lastAt: new Date(NOW - 6 * HOUR).toISOString() },
        highlight: { since: SINCE, current: HEAD, changedFiles: 4, droppedFiles: [], truncated: false, hidden: false },
      }),
    ),
};

/** The same, with files the pull request no longer changes and GitHub's file-list cut-off. */
export const InlineVersionsWithDroppedFiles: Story = {
  render: () =>
    inline(
      ready({
        forcePushes: { count: 1, lastAt: new Date(NOW - 6 * HOUR).toISOString() },
        highlight: {
          since: SINCE,
          current: HEAD,
          changedFiles: 4,
          droppedFiles: ["src/core/stack.ts", "src/ui/bar.ts"],
          truncated: true,
          hidden: false,
        },
      }),
    ),
};

/** Review texts and comments, collapsed to the new ones. */
export const InlineDiscussion: Story = {
  render: () => interactive(ready({ discussion: DISCUSSION, discussionSeenAt: new Date(NOW - 3 * HOUR).toISOString() })),
};

/** The floating pill, collapsed. */
export const Floating: Story = { render: () => floating(ready()) };

/** The floating pill opened into the full panel. */
export const FloatingExpanded: Story = { render: () => floating(ready(), { expanded: true }) };

/** Shrunk to a tab at the window edge. */
export const FloatingMinimized: Story = { render: () => floating(ready(), { minimized: true }) };
