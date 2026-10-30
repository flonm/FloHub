import type { Meta, StoryObj } from "@storybook/html-vite";
import { el } from "../ui/dom";
import { type EverythingState, FOLDED_AT_FIRST, type InboxViewActions, type InboxViewState, renderInbox, type SectionKind } from "../ui/inbox-view";
import { inPopup, NOW } from "./shadow";
import { FRESH, group, HOUR, LOADED, MINE, MINUTE, pull, REVIEW, ready, SCOPES, WAITING } from "./inbox-fixtures";
import { NO_MARKS, setSnooze, snoozeFor, togglePin } from "../core/inbox-marks";

/**
 * Mounts the inbox and re-renders it when a section is folded, as the popup does.
 * @param state What to show, without the folded sections, which the story keeps itself.
 * @param initial The sections to start folded.
 * @returns The shadow host.
 */
function mount(state: Omit<InboxViewState, "collapsed">, initial: SectionKind[] = [...FOLDED_AT_FIRST]): HTMLElement {
  const collapsed = new Set<SectionKind>(initial);
  const showSnoozed = new Set<SectionKind>();
  let marks = state.marks ?? NO_MARKS;
  let everything: EverythingState = state.everything ?? { loading: false, scopes: SCOPES };
  const box = el("div");
  const draw = () => box.replaceChildren(...renderInbox({ ...state, collapsed, marks, showSnoozed, now: NOW, everything }, actions));
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
    // Loading takes a moment, then shows the loaded pull requests, as the service worker's answer would.
    loadEverything: () => {
      everything = { ...everything, loading: true };
      draw();
      setTimeout(() => {
        everything = { loading: false, scopes: SCOPES, loaded: { groups: LOADED, fetchedAt: NOW, capped: false, searchUrl: "https://github.com/pulls" } };
        draw();
      }, 800);
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

/**
 * Every section in one popup, each category under its own heading, empty ones faded. The review requests someone else
 * already answered and everything else start folded; click their headings to open them.
 */
export const EverySection: Story = { render: () => mount({ inbox: ready(), problem: null }) };

/** Every section open: the review requests others answered, and what the searches found that waits for nobody. */
export const EverySectionOpen: Story = { render: () => mount({ inbox: ready(), problem: null }, []) };

/** Asked again: the most pressing category, in the attention colour at the top of "Your turn". */
export const Rerequested: Story = {
  render: () =>
    mount({
      inbox: ready({
        review: [
          group("octo-org/api", null, [
            pull({ number: 77, title: "fix(auth): refresh tokens before they expire", rerequested: true, lastActivity: new Date(NOW - 50 * HOUR).toISOString(), turn: { whose: "you", reasons: [{ code: "rerequested" }] } }),
          ]),
          FRESH,
        ],
      }),
      problem: null,
    }),
};

/** "Everything else" loading every open pull request of the owners and repositories. */
export const EverythingLoading: Story = {
  render: () => mount({ inbox: ready(), problem: null, everything: { loading: true, scopes: SCOPES } }, ["reviewed"]),
};

/** "Everything else" after a load that hit the search's cap, with a link to the rest on GitHub. */
export const EverythingLoaded: Story = {
  render: () =>
    mount(
      {
        inbox: ready(),
        problem: null,
        everything: { loading: false, scopes: SCOPES, loaded: { groups: LOADED, fetchedAt: NOW - 20 * MINUTE, capped: true, searchUrl: "https://github.com/pulls" } },
      },
      ["reviewed"],
    ),
};

/** "Everything else" after a failed load: the reason, and the button to try again. */
export const EverythingFailed: Story = {
  render: () => mount({ inbox: ready(), problem: null, everything: { loading: false, scopes: SCOPES, error: "GitHub returned no data." } }, ["reviewed"]),
};

/** The skeleton the popup shows until the stored inbox or the refresh arrives. */
export const Loading: Story = { render: () => mount({ inbox: null, problem: null }) };

/** One combined empty state when nothing waits for the viewer. */
export const Empty: Story = {
  render: () => mount({ inbox: ready({ review: [], waiting: [], mine: [], other: [] }), problem: null }),
};

/** The empty state while a profile is active names it. */
export const EmptyInProfile: Story = {
  render: () => mount({ inbox: ready({ review: [], waiting: [], mine: [], other: [] }), problem: null, scope: "Personal" }),
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
        other: [],
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
  render: () => mount({ inbox: ready(), problem: null }, ["you", "them", "reviewed", "none", "other"]),
};

/** A section with nothing in it still keeps its line, and every category its faded heading. */
export const EmptySections: Story = {
  render: () => mount({ inbox: ready({ review: [], waiting: [], other: [] }), problem: null }),
};
