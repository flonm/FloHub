import type { Meta, StoryObj } from "@storybook/html-vite";
import type { Inbox, InboxGroup, InboxPull } from "../core/inbox";
import { el } from "../ui/dom";
import { type InboxViewActions, type InboxViewState, renderInbox, type SectionKind } from "../ui/inbox-view";
import { inPopup, NOW } from "./shadow";
import { NO_MARKS, setSnooze, snoozeFor, togglePin } from "../core/inbox-marks";

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
    turn: { whose: "you", reasons: [{ code: "requested" }] },
    reviews: [
      { login: "octocat", avatarUrl: AVATAR, verdict: "approved" },
      { login: "ada", avatarUrl: null, verdict: "approved" },
    ],
  }),
  pull({
    number: 902,
    title: "feat(api): page through the stack entries",
    tone: "attention",
    label: "Changes requested",
    position: 2,
    totalThreads: 1,
    lastActivity: new Date(NOW - 26 * HOUR).toISOString(),
    turn: { whose: "you", reasons: [{ code: "requested" }] },
    reviews: [{ login: "octocat", avatarUrl: AVATAR, verdict: "changes_requested" }],
  }),
  pull({
    number: 901,
    title: "fix(auth): refresh tokens before they expire and retry the failed request once",
    label: "Needs review",
    position: 1,
    rerequested: true,
    viaTeam: true,
    turn: { whose: "you", reasons: [{ code: "rerequested" }] },
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
      turn: { whose: "you", reasons: [{ code: "replies", count: 2 }, { code: "pushed-since-review" }] },
      reviews: [{ login: "linus", avatarUrl: null, verdict: "commented" }],
    }),
  ]),
  group("octo-org/docs", null, [
    pull({ number: 128, title: "docs: explain the stack badge", tone: "neutral", label: "Draft", yourVerdict: "commented", turn: { whose: "none", reasons: [{ code: "draft" }] } }),
  ]),
  group("octo-org/web", null, [
    pull({
      number: 77,
      title: "fix(web): debounce the search box",
      label: "Needs review",
      yourVerdict: "changes_requested",
      turn: { whose: "them", reasons: [{ code: "waiting-on-author" }] },
    }),
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
      turn: { whose: "you", reasons: [{ code: "checks-failed" }, { code: "changes-requested", who: ["mona"] }, { code: "replies", count: 1 }] },
      reviews: [
        { login: "mona", avatarUrl: null, verdict: "changes_requested" },
        { login: "octocat", avatarUrl: AVATAR, verdict: "approved" },
        { login: "ada", avatarUrl: null, verdict: "approved" },
        { login: "grace", avatarUrl: null, verdict: "commented" },
        { login: "linus", avatarUrl: null, verdict: "commented" },
      ],
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
      turn: { whose: "you", reasons: [{ code: "ready-to-merge" }] },
      reviews: [{ login: "octocat", avatarUrl: AVATAR, verdict: "approved" }],
    }),
  ]),
  group("octo-org/web", null, [
    pull({
      number: 64,
      title: "feat(web): keyboard shortcuts for the inbox",
      label: "Needs review",
      author: "tizian",
      turn: { whose: "them", reasons: [{ code: "waiting-on-reviewers", who: ["ada", "grace"] }] },
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
 * @param initial The sections to start folded.
 * @returns The shadow host.
 */
function mount(state: Omit<InboxViewState, "collapsed">, initial: SectionKind[] = []): HTMLElement {
  const collapsed = new Set<SectionKind>(initial);
  const showSnoozed = new Set<SectionKind>();
  let marks = state.marks ?? NO_MARKS;
  const box = el("div");
  const draw = () => box.replaceChildren(...renderInbox({ ...state, collapsed, marks, showSnoozed, now: NOW }, actions));
  const actions: InboxViewActions = {
    openPull: () => undefined,
    focusRow: () => undefined,
    toggleSection: (kind) => {
      if (collapsed.has(kind)) collapsed.delete(kind);
      else collapsed.add(kind);
      draw();
    },
    hideTeamRequests: () => undefined,
    togglePin: (url) => {
      marks = togglePin(marks, url);
      draw();
    },
    snooze: (snoozed, preset) => {
      marks = setSnooze(marks, snoozed.url, preset ? snoozeFor(preset, new Date(NOW), snoozed) : null);
      draw();
    },
    toggleSnoozed: (kind) => {
      if (showSnoozed.has(kind)) showSnoozed.delete(kind);
      else showSnoozed.add(kind);
      draw();
    },
    retryRefresh: () => undefined,
    openSettings: () => undefined,
  };
  const host = inPopup(box);
  draw();
  return host;
}

const meta = {
  title: "Inbox/Overview",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "The popup's inbox, mounted with the real `renderInbox` inside a shadow root carrying popup.css. Review requests are grouped by stack, top layer first; every status is plain tone-coloured text rather than a badge. Click a section heading to fold it.",
      },
    },
  },
} satisfies Meta;

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

/** One lone pull request per status, so the whole tone palette is side by side. */
export const EveryStatus: Story = {
  render: () =>
    mount({
      inbox: ready({
        review: [
          group("octo-org/api", null, [pull({ number: 11, title: "fix(auth): stop the retry loop", tone: "danger", label: "Checks failed" })]),
          group("octo-org/api", null, [pull({ number: 12, title: "feat(api): page through the stack entries", tone: "attention", label: "Changes requested" })]),
          group("octo-org/api", null, [pull({ number: 13, title: "feat(ui): render the stack in the inbox", tone: "success", label: "Ready to merge" })]),
          group("octo-org/api", null, [pull({ number: 14, title: "docs: explain the stack badge", tone: "done", label: "Merged" })]),
          group("octo-org/api", null, [pull({ number: 15, title: "chore(styles): tidy the tokens", tone: "neutral", label: "Draft" })]),
          group("octo-org/api", null, [pull({ number: 16, title: "feat(auth): scope the token to one repository", tone: "accent", label: "Needs review" })]),
        ],
        waiting: [],
        mine: [],
      }),
      problem: null,
    }),
};

/** A pinned stack sorts first in its section; two snoozed pull requests hide behind "Show 2 snoozed". Hover a row for its pin and snooze buttons. */
export const PinnedAndSnoozed: Story = {
  render: () =>
    mount({
      inbox: ready(),
      problem: null,
      marks: {
        pinned: [MINE[0]?.pulls[1]?.url ?? ""],
        snoozed: {
          [REVIEW.pulls[2]?.url ?? ""]: { until: NOW + HOUR },
          [WAITING[0]?.pulls[0]?.url ?? ""]: { afterActivity: WAITING[0]?.pulls[0]?.lastActivity ?? "" },
        },
      },
    }),
};

/** Every section folded to their headings, as the popup remembers them. */
export const Collapsed: Story = {
  render: () => mount({ inbox: ready(), problem: null }, ["again", "you", "them", "none"]),
};

/** A section with nothing in it still keeps its line. */
export const EmptySections: Story = {
  render: () => mount({ inbox: ready({ review: [], waiting: [] }), problem: null }),
};
