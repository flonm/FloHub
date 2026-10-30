import type { Meta, StoryObj } from "@storybook/html-vite";
import type { Inbox } from "../core/inbox";
import { type InboxMarks, NO_MARKS, setSnooze, snoozeFor, togglePin } from "../core/inbox-marks";
import { repoInbox, repoViewCounts, type RepoView } from "../core/repo-views";
import { el } from "../ui/dom";
import type { InboxViewActions, Problem, SectionKind } from "../ui/inbox-view";
import { RepoPullsViews } from "../ui/repo-pulls";
import { group, HOUR, MINE, pull, ready, WAITING } from "./inbox-fixtures";
import { NOW } from "./shadow";

const REF = { owner: "octo-org", repo: "api" };

/** The inbox narrowed to octo-org/api, with a pull request waiting on its author and one of the viewer's on reviewers. */
function apiInbox(): Inbox {
  return repoInbox(
    ready({
      mine: [
        ...MINE,
        group("octo-org/api", null, [
          pull({ number: 150, title: "feat(api): cursor pagination", author: "tizian", turn: { whose: "them", reasons: [{ code: "waiting-on-reviewers", who: ["ada"] }] } }),
        ]),
      ],
      waiting: [
        ...WAITING,
        group("octo-org/api", null, [
          pull({
            number: 144,
            title: "fix(api): reject an empty cursor",
            author: "grace",
            yourVerdict: "changes_requested",
            lastActivity: new Date(NOW - 30 * HOUR).toISOString(),
            turn: { whose: "them", reasons: [{ code: "waiting-on-author" }] },
          }),
        ]),
      ],
    }),
    REF,
  );
}

/** A stand-in for GitHub's own sidebar and list, built from the same links and ids FloHub looks for on the page. */
function githubPage(): { page: HTMLElement; sidebar: HTMLElement; main: HTMLElement } {
  const page = el("div", { style: "display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 24px; color: var(--fgColor-default); font: 14px/1.5 -apple-system, sans-serif" });
  const sidebar = el("nav", { "aria-label": "GitHub's lists" });
  const list = el("ul", { style: "margin: 0; padding: 0; list-style: none" });
  const lists: [string, string][] = [
    ["Pull requests", ""],
    ["Authored by me", "/authored/tizian"],
    ["Assigned to me", "/assigned/tizian"],
    ["Involves me", "/involves/tizian"],
    ["Review requests", "/review-requested/tizian"],
  ];
  for (const [name, path] of lists) {
    const link = el("a", { href: `/octo-org/api/pulls${path}`, style: "display: block; padding: 6px 8px; color: inherit; text-decoration: none" }, name);
    if (path === "") link.setAttribute("aria-current", "page");
    const item = el("li");
    item.append(link);
    list.append(item);
  }
  sidebar.append(list);
  const main = el("div");
  const githubList = el(
    "div",
    { id: "story-list-view-container", style: "padding: 16px; border: 1px dashed var(--borderColor-default); border-radius: 6px; color: var(--fgColor-muted)" },
    "GitHub's own list of pull requests",
  );
  main.append(githubList);
  page.append(sidebar, main);
  return { page, sidebar, main };
}

/**
 * Mounts the views on a stand-in for GitHub's page and keeps them interactive: a click on a view opens it, pins and
 * snoozes redraw, as the content script does.
 */
function mount(initial: { view: RepoView | null; inbox: Inbox | null; problem?: Problem; marks?: InboxMarks }): HTMLElement {
  let { view } = initial;
  let marks = initial.marks ?? NO_MARKS;
  const showSnoozed = new Set<SectionKind>();
  const actions: InboxViewActions = {
    openPull: () => undefined,
    focusRow: () => undefined,
    toggleSection: () => undefined,
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
    loadEverything: () => undefined,
    retryRefresh: () => undefined,
    openSettings: () => undefined,
  };
  const views = new RepoPullsViews(actions);
  const { page } = githubPage();
  const draw = () => {
    views.render({
      view,
      counts: initial.inbox && repoViewCounts(initial.inbox, marks, NOW),
      inbox: { inbox: initial.inbox, problem: initial.problem ?? null, collapsed: new Set(), marks, showSnoozed, now: NOW, scope: "octo-org/api" },
    });
    views.place(REF, view !== null);
  };
  views.links.addEventListener("click", (event) => {
    const link = event.composedPath().find((target): target is HTMLAnchorElement => target instanceof HTMLAnchorElement);
    if (!link?.dataset.view) return;
    event.preventDefault();
    view = link.dataset.view as RepoView;
    draw();
  });
  // FloHub finds its spots on the page, which Storybook attaches only after the story returns.
  requestAnimationFrame(draw);
  return page;
}

const meta = {
  title: "Inbox/Repository views",
  parameters: {
    docs: {
      description: {
        component:
          "FloHub's views on a repository's pull request list: a group below GitHub's own sidebar lists, and the list a view shows in place of GitHub's, drawn by the real `RepoPullsViews` on a stand-in for GitHub's page. Click a view to open it.",
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** GitHub's own list shows; the sidebar counts what each view holds. */
export const Closed: Story = { render: () => mount({ view: null, inbox: apiInbox() }) };

/** Your turn: every category, empty ones faded, re-requested in the attention colour on top. */
export const YourTurn: Story = { render: () => mount({ view: "your-turn", inbox: apiInbox() }) };

/** Re-requested on its own, without a heading of its category. */
export const Rerequested: Story = { render: () => mount({ view: "rerequested", inbox: apiInbox() }) };

/** Their turn: waiting for the author, then for the reviewers. */
export const TheirTurn: Story = { render: () => mount({ view: "their-turn", inbox: apiInbox() }) };

/** Reviews someone else answered already. */
export const ReviewedByOthers: Story = { render: () => mount({ view: "reviewed", inbox: apiInbox() }) };

/** A snoozed pull request leaves the counts and hides behind a line that shows it. */
export const Snoozed: Story = {
  render: () => {
    const inbox = apiInbox();
    const rerequested = inbox.review[0]?.pulls.find((entry) => entry.rerequested);
    return mount({ view: "your-turn", inbox, marks: { pinned: [], snoozed: { [rerequested?.url ?? ""]: { until: NOW + HOUR } } } });
  },
};

/** Nothing waits in the repository: zero counts, and the view says so. */
export const Empty: Story = { render: () => mount({ view: "their-turn", inbox: repoInbox(ready(), { owner: "octo-org", repo: "quiet" }) }) };

/** The inbox is still loading: no counts yet, and the list's skeleton. */
export const Loading: Story = { render: () => mount({ view: "your-turn", inbox: null }) };

/** The inbox failed to load and there's none stored. */
export const Failed: Story = {
  render: () => mount({ view: "your-turn", inbox: null, problem: { kind: "error", message: "Could not reach api.github.com" } }),
};

/** No token yet, so the list asks for one. */
export const NoToken: Story = { render: () => mount({ view: "your-turn", inbox: null, problem: { kind: "no-token", message: "" } }) };
