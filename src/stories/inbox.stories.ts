import type { Meta, StoryObj } from "@storybook/html-vite";
import type { Inbox, InboxGroup, InboxPull } from "../core/inbox";
import { el } from "../ui/dom";
import { type InboxViewActions, type InboxViewState, renderInbox, type SectionKind } from "../ui/inbox-view";
import { inPopup, NOW } from "./shadow";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const AVATAR = "https://avatars.githubusercontent.com/u/583231?v=4";

/**
 * @param overrides The numbers and title, plus whatever the row's state needs.
 * @returns A pull request as the inbox holds it.
 */
function pull(overrides: Partial<InboxPull> & Pick<InboxPull, "number" | "title">): InboxPull {
  return {
    url: `https://github.com/octo-org/api/pull/${overrides.number}`,
    tone: "accent",
    label: "Needs review",
    author: "mona",
    avatarUrl: AVATAR,
    position: null,
    lastActivity: new Date(NOW - 5 * HOUR).toISOString(),
    resolvedThreads: 0,
    totalThreads: 0,
    rerequested: false,
    additions: 0,
    deletions: 0,
    ...overrides,
  };
}

/** @returns One stack, or one pull request outside a stack when the number is null. */
function group(repo: string, stackNumber: number | null, pulls: InboxPull[]): InboxGroup {
  return { key: `${repo}#${stackNumber ?? pulls[0]?.number ?? 0}`, repo, stackNumber, stackSize: stackNumber === null ? 1 : pulls.length, pulls };
}

const REVIEW: InboxGroup = group("octo-org/api", 12, [
  pull({
    number: 903,
    title: "feat(ui): render the stack in the inbox",
    tone: "success",
    label: "Ready to merge",
    position: 3,
    totalThreads: 3,
    resolvedThreads: 3,
    additions: 48,
    deletions: 7,
  }),
  pull({
    number: 902,
    title: "feat(api): page through the stack entries",
    tone: "attention",
    label: "Changes requested",
    position: 2,
    totalThreads: 1,
    lastActivity: new Date(NOW - 26 * HOUR).toISOString(),
  }),
  pull({
    number: 901,
    title: "fix(auth): refresh tokens before they expire and retry the failed request once",
    label: "Needs review",
    position: 1,
    rerequested: true,
    viaTeam: true,
  }),
]);

const WAITING: InboxGroup[] = [
  group("octo-org/api", null, [
    pull({
      number: 130,
      title: "fix(sync): keep local commits on rebase",
      tone: "danger",
      label: "Checks failed",
      yourVerdict: "changes_requested",
      pushedSinceReview: true,
    }),
  ]),
  group("octo-org/docs", null, [
    pull({ number: 128, title: "docs: explain the stack badge", tone: "neutral", label: "Draft", yourVerdict: "commented" }),
  ]),
];

const MINE: InboxGroup[] = [
  group("octo-org/api", 42, [
    pull({
      number: 121,
      title: "feat(stack): show failing checks",
      tone: "danger",
      label: "Checks failed",
      author: "tizian",
      position: 2,
      additions: 10,
      deletions: 2,
      lastActivity: new Date(NOW - 40 * MINUTE).toISOString(),
    }),
    pull({
      number: 120,
      title: "docs: explain the stack badge",
      tone: "success",
      label: "Ready to merge",
      author: "tizian",
      position: 1,
      totalThreads: 2,
      resolvedThreads: 1,
    }),
  ]),
];

/** @returns A full inbox, every section populated. */
function ready(overrides: Partial<Inbox> = {}): Inbox {
  return {
    viewer: "tizian",
    fetchedAt: NOW - 4 * MINUTE,
    review: [REVIEW],
    waiting: WAITING,
    mine: MINE,
    reviewCount: 3,
    ...overrides,
  };
}

/**
 * Mounts the inbox and re-renders it when a section is folded, as the popup does.
 * @param state What to show, without the folded sections, which the story keeps itself.
 * @returns The shadow host.
 */
function mount(state: Omit<InboxViewState, "collapsed">): HTMLElement {
  const collapsed = new Set<SectionKind>();
  const box = el("div");
  const draw = () => box.replaceChildren(...renderInbox({ ...state, collapsed }, actions));
  const actions: InboxViewActions = {
    openPull: () => undefined,
    focusRow: () => undefined,
    toggleSection: (kind) => {
      if (collapsed.has(kind)) collapsed.delete(kind);
      else collapsed.add(kind);
      draw();
    },
    hideTeamRequests: () => undefined,
    retryRefresh: () => undefined,
    openSettings: () => undefined,
  };
  const host = inPopup(box);
  draw();
  return host;
}

const meta = { title: "Inbox/Overview" } satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every section in one popup: a stack of review requests, reviews waiting for their author, and the viewer's own. */
export const EverySection: Story = { render: () => mount({ inbox: ready(), problem: null }) };

/** The skeleton the popup shows until the stored inbox or the refresh arrives. */
export const Loading: Story = { render: () => mount({ inbox: null, problem: null }) };

/** One combined empty state when nothing waits for the viewer. */
export const Empty: Story = {
  render: () => mount({ inbox: ready({ review: [], waiting: [], mine: [] }), problem: null }),
};

/** A failed refresh keeps the stored inbox on screen, with a notice and a retry over it. */
export const StaleWithNotice: Story = {
  render: () => mount({ inbox: ready(), problem: { kind: "error", message: "Could not reach api.github.com" } }),
};

/** No token yet, so the inbox is replaced by the setup prompt. */
export const NoToken: Story = { render: () => mount({ inbox: null, problem: { kind: "no-token", message: "" } }) };

/** GitHub rejected the token. */
export const Unauthorized: Story = { render: () => mount({ inbox: null, problem: { kind: "unauthorized", message: "" } }) };

/** The token is valid but lacks a scope, so the prompt names the missing ones. */
export const MissingScopes: Story = {
  render: () => mount({ inbox: null, problem: { kind: "scopes", message: "Resource not accessible by personal access token." } }),
};

/** A single team request, with the button that hides the repository's team requests. Hover the row to reveal it. */
export const TeamRequest: Story = {
  render: () =>
    mount({
      inbox: ready({
        review: [group("octo-org/api", null, [pull({ number: 71, title: "feat(auth): scope the token to one repository", viaTeam: true })])],
        waiting: [],
        mine: [],
      }),
      problem: null,
    }),
};
