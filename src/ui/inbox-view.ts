import { formatAge } from "../core/age";
import { INBOX_PERIOD_MINUTES } from "../api/inbox-sync";
import type { FailureCode } from "../api/github";
import { type Inbox, type InboxPull, type InboxRole, type InboxSection, isStale, type TurnGroup, turnSections } from "../core/inbox";
import { formatDiffStat } from "../core/viewed";
import { el, icon } from "./dom";
import { VERDICT_LOOK, verdictFace } from "./verdict-face";
import { reasonWords, type ReasonTone } from "./turn-words";
import { applyMarks, type InboxMarks, isPinned, isSnoozed, NO_MARKS, type SnoozePreset } from "../core/inbox-marks";

/** The sections the popup draws: review requests asked again, then whose move each pull request waits for. */
export type SectionKind = InboxSection;

/** What the popup shows instead of the inbox, or over it. */
export interface Problem {
  kind: "no-token" | "unauthorized" | "scopes" | "error";
  message: string;
}

/** Everything the inbox needs to draw itself. */
export interface InboxViewState {
  inbox: Inbox | null;
  problem: Problem | null;
  /** The sections the user folded away. */
  collapsed: ReadonlySet<SectionKind>;
  /** The pull requests the user pinned or snoozed. */
  marks?: InboxMarks;
  /** The sections whose snoozed pull requests the user asked to see. */
  showSnoozed?: ReadonlySet<SectionKind>;
  /** The current time, for which snoozes are over. */
  now?: number;
}

/** What the popup does when the user acts on the inbox. */
export interface InboxViewActions {
  openPull: (url: string, background: boolean) => void;
  /** A row took focus; the popup keeps the list's single tab stop on it. */
  focusRow: (key: string) => void;
  toggleSection: (kind: SectionKind) => void;
  hideTeamRequests: (repo: string) => void;
  togglePin: (url: string) => void;
  /** Snoozes a pull request, or wakes it with null. */
  snooze: (pull: InboxPull, preset: SnoozePreset | null) => void;
  toggleSnoozed: (kind: SectionKind) => void;
  retryRefresh: () => void;
  openSettings: () => void;
}

/**
 * @param code Why the refresh failed.
 * @param message The service worker's explanation.
 * @returns The problem to show.
 */
export function problemFor(code: FailureCode, message: string): Problem {
  return { kind: code === "failed" ? "error" : code, message };
}

/**
 * @param problem The problem.
 * @returns Whether it hides the inbox, since a refresh cannot fix it without a new token.
 */
export function blocksInbox(problem: Problem | null): boolean {
  return problem !== null && problem.kind !== "error";
}

/**
 * @param inbox The inbox.
 * @returns Whether nothing waits for review and the viewer has no open pull requests.
 */
export function isEmptyInbox(inbox: Pick<Inbox, "review" | "mine" | "waiting">): boolean {
  return inbox.review.length === 0 && inbox.mine.length === 0 && (inbox.waiting?.length ?? 0) === 0;
}

/**
 * @param fetchedAt When the inbox was fetched, in epoch milliseconds.
 * @param now The current time in epoch milliseconds.
 * @returns A line like "Updated 5 minutes ago".
 */
export function updatedLabel(fetchedAt: number, now: number): string {
  return `Updated ${formatAge(new Date(fetchedAt).toISOString(), now).spoken}`;
}

/**
 * Moves the selection in the popup's list of rows.
 * @param key The pressed key.
 * @param index The focused row, or -1 when focus is outside the list.
 * @param count How many rows there are.
 * @returns The row to focus, or null when the key does not move the selection.
 */
export function moveSelection(key: string, index: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case "ArrowDown":
    case "j": {
      return index < 0 ? 0 : Math.min(index + 1, count - 1);
    }
    case "ArrowUp":
    case "k": {
      return index < 0 ? 0 : Math.max(index - 1, 0);
    }
    case "Home": {
      return 0;
    }
    case "End": {
      return count - 1;
    }
    default: {
      return null;
    }
  }
}

/**
 * @param tabUrl The address a tab shows.
 * @param pullUrl A pull request's address.
 * @returns Whether the tab shows that pull request, on any of its subpages.
 */
export function showsPull(tabUrl: string, pullUrl: string): boolean {
  try {
    const tab = new URL(tabUrl);
    const pull = new URL(pullUrl);
    if (tab.origin !== pull.origin) return false;
    const path = tab.pathname.toLowerCase();
    const base = pull.pathname.toLowerCase().replace(/\/$/u, "");
    return path === base || path.startsWith(`${base}/`);
  } catch {
    return false;
  }
}

/**
 * Draws the inbox: the problem that replaces it, the skeleton while it loads, one combined empty state, or the three
 * sections of pull requests.
 * @param state What to show.
 * @param actions What to do when the user acts on it.
 * @returns The children for the popup's main element.
 */
export function renderInbox(state: InboxViewState, actions: InboxViewActions): HTMLElement[] {
  const { inbox, problem } = state;
  if (problem && (blocksInbox(problem) || !inbox)) return [renderProblem(problem, actions)];
  if (!inbox) return [renderSkeleton()];
  if (isEmptyInbox(inbox)) {
    return [
      blank(
        "check",
        "Nothing to review",
        `No review requests and no open pull requests. FloHub checks again every ${INBOX_PERIOD_MINUTES} minutes.`,
      ),
    ];
  }
  const sections = turnSections(inbox);
  return [
    ...(sections.again.length > 0 ? [renderSection("Re-requested", sections.again, "", "again", state, actions)] : []),
    renderSection("Your turn", sections.you, "Nothing waits for you.", "you", state, actions),
    renderSection("Their turn", sections.them, "Nobody else has a move to make.", "them", state, actions),
    ...(sections.none.length > 0 ? [renderSection("Drafts", sections.none, "", "none", state, actions)] : []),
  ];
}

function renderProblem(current: Problem, actions: InboxViewActions): HTMLElement {
  switch (current.kind) {
    case "no-token": {
      return blank("people", "Add a GitHub token", "The inbox needs a token to find your review requests and pull requests.", [
        "Set up token",
        actions.openSettings,
      ]);
    }
    case "unauthorized": {
      return blank("cross", "GitHub rejected the token", "It may have expired or been revoked. Add a new one in the settings.", [
        "Open settings",
        actions.openSettings,
      ]);
    }
    case "scopes": {
      return blank("cross", "The token needs more access", `${current.message} Create one with the repo and read:org scopes.`, [
        "Open settings",
        actions.openSettings,
      ]);
    }
    case "error": {
      return blank("cross", "Could not load the inbox", current.message, ["Try again", actions.retryRefresh]);
    }
  }
}

function blank(name: "check" | "cross" | "people", title: string, text: string, action?: [string, () => void]): HTMLElement {
  const box = el("div", { class: "blank", "data-kind": name });
  const badge = el("span", { class: "blank-icon" });
  badge.append(icon(name));
  box.append(badge, el("p", { class: "blank-title" }, title), el("p", { class: "blank-text" }, text));
  if (action) {
    const [label, onClick] = action;
    const button = el("button", { type: "button", class: "text-button", "data-focus-key": `action:${label}` }, label);
    button.addEventListener("click", onClick);
    box.append(button);
  }
  return box;
}

function renderSkeleton(): HTMLElement {
  const box = el("div", { class: "skeleton" });
  box.append(el("span", { class: "visually-hidden" }, "Loading pull requests"));
  for (const rowCount of [3, 2]) {
    const section = el("div", { class: "skeleton-section", "aria-hidden": "true" });
    section.append(el("span", { class: "bone heading" }));
    for (let index = 0; index < rowCount; index++) {
      const row = el("div", { class: "skeleton-row" });
      row.append(el("span", { class: "bone dot" }), el("span", { class: "bone line" }), el("span", { class: "bone line short" }));
      section.append(row);
    }
    box.append(section);
  }
  return box;
}

function renderSection(
  title: string,
  groups: TurnGroup[],
  empty: string,
  kind: SectionKind,
  state: InboxViewState,
  actions: InboxViewActions,
): HTMLElement {
  const marks = state.marks ?? NO_MARKS;
  const now = state.now ?? Date.now();
  const showing = state.showSnoozed?.has(kind) ?? false;
  const marked = applyMarks(groups, marks, now, showing);
  const count = groups.reduce((sum, entry) => sum + entry.pulls.length, 0) - marked.snoozed;
  const id = `section-${kind}`;
  const bodyId = `section-body-${kind}`;
  const open = !state.collapsed.has(kind);
  const section = el("section", { "aria-labelledby": id });
  const toggle = el("button", {
    type: "button",
    class: "section-toggle",
    id,
    "aria-expanded": String(open),
    "aria-controls": bodyId,
    "data-focus-key": `section:${kind}`,
  });
  toggle.append(icon("chevron"), el("span", { class: "section-title" }, title), el("span", { class: "count" }, String(count)));
  toggle.addEventListener("click", () => actions.toggleSection(kind));
  const heading = el("h2");
  heading.append(toggle);
  const body = el("div", { id: bodyId });
  body.hidden = !open;
  section.append(heading, body);
  if (!open) return section;
  if (marked.groups.length === 0 && marked.snoozed === 0) {
    body.append(el("p", { class: "empty" }, empty));
    return section;
  }
  const list = el("ul", { class: "groups" });
  for (const entry of marked.groups) list.append(renderGroup(entry, kind, actions, { marks, now }));
  if (marked.groups.length > 0) body.append(list);
  if (marked.snoozed > 0) {
    const snoozed = `${marked.snoozed} snoozed`;
    const more = el(
      "button",
      { type: "button", class: "snoozed-toggle", "aria-expanded": String(showing), "data-focus-key": `snoozed:${kind}` },
      showing ? `Hide ${snoozed}` : `Show ${snoozed}`,
    );
    more.prepend(icon("clock"));
    more.addEventListener("click", () => actions.toggleSnoozed(kind));
    body.append(more);
  }
  return section;
}

/** The marks the rows are drawn with, and when. */
interface Marking {
  marks: InboxMarks;
  now: number;
}

function renderGroup(entry: TurnGroup, kind: SectionKind, actions: InboxViewActions, marking: Marking): HTMLElement {
  // Layers of one stack stay adjacent; a rail joins them only when the inbox holds more than one.
  const joined = entry.stackNumber !== null && entry.pulls.length > 1;
  const item = el("li", { class: joined ? "group joined" : "group" });
  const list = el("ul", { class: "layers" });
  if (entry.stackNumber !== null) list.setAttribute("aria-label", `Stack of ${entry.stackSize} in ${entry.repo}`);
  for (const pull of entry.pulls) list.append(renderPull(pull, entry, kind, actions, marking));
  item.append(list);
  return item;
}

function renderPull(pull: InboxPull, entry: TurnGroup, kind: SectionKind, actions: InboxViewActions, marking: Marking): HTMLElement {
  const pinned = isPinned(marking.marks, pull.url);
  const snoozed = isSnoozed(marking.marks, pull, marking.now);
  const item = el("li", { class: ["layer", ...(pinned ? ["pinned"] : []), ...(snoozed ? ["snoozed"] : [])].join(" ") });
  const { role } = entry;
  const key = `${kind}:${pull.url}`;
  const ids = { title: `title-${kind}-${pull.number}-${entry.repo}`, meta: `meta-${kind}-${pull.number}-${entry.repo}` };
  const link = el("a", {
    class: "pull",
    href: pull.url,
    tabindex: "-1",
    "data-focus-key": key,
    "aria-labelledby": ids.title,
    "aria-describedby": ids.meta,
  });
  link.addEventListener("click", (event) => {
    event.preventDefault();
    actions.openPull(pull.url, event.metaKey || event.ctrlKey);
  });
  link.addEventListener("mousedown", (event) => {
    if (event.button === 1) event.preventDefault();
  });
  link.addEventListener("auxclick", (event) => {
    if (event.button !== 1) return;
    event.preventDefault();
    actions.openPull(pull.url, true);
  });
  link.addEventListener("focus", () => actions.focusRow(key));

  const title = el("span", { class: "title", id: ids.title, title: `#${pull.number} ${pull.title}` });
  if (pinned) title.append(icon("pin", "pin-mark"), el("span", { class: "visually-hidden" }, "Pinned: "));
  title.append(el("span", { class: "number" }, `#${pull.number} `), pull.title);

  const time = el("time", { class: "age", datetime: pull.lastActivity, "aria-hidden": "true" });
  if (role === "review") time.dataset.flagStale = "";
  const spoken = el("span", { class: "visually-hidden spoken-age" });

  const meta = el("span", { class: "meta", id: ids.meta });
  if (snoozed) meta.append(flag("Snoozed", "neutral"));
  meta.append(...renderReasons(pull, role, kind));
  if (role !== "mine" && pull.author) meta.append(el("span", { class: "item author" }, pull.author));
  meta.append(el("span", { class: "item repo" }, entry.repo));
  if (entry.stackNumber !== null && pull.position !== null) {
    const position = `Layer ${pull.position} of ${entry.stackSize} in its stack, counted from the base`;
    const layer = el("span", { class: "item position", title: position });
    layer.append(el("span", { "aria-hidden": "true" }, `${pull.position}/${entry.stackSize}`), el("span", { class: "visually-hidden" }, position));
    meta.append(layer);
  }
  if (pull.totalThreads > 0) meta.append(renderThreads(pull));
  const diffStat = renderDiffStat(pull);
  if (diffStat) meta.append(diffStat);
  meta.append(spoken);
  updateAge(time, spoken, Date.now());

  const lead = el("span", { class: "lead" });
  lead.append(role === "mine" ? el("span", { class: "node", "data-tone": pull.tone }) : renderAvatar(pull));

  link.append(lead, title, time, meta);
  const faces = renderFaces(pull);
  if (faces) {
    link.append(faces);
    meta.append(el("span", { class: "visually-hidden" }, `. Reviews: ${faces.title}`));
  }
  item.append(link, renderRowTools(pull, entry, role, actions, { pinned, snoozed }));
  return item;
}

/**
 * The row's own buttons, shown on hover or focus at the end of its title line: hiding team requests on a team
 * request, pinning, and snoozing or waking it, with a menu of how long.
 */
function renderRowTools(
  pull: InboxPull,
  entry: TurnGroup,
  role: InboxRole,
  actions: InboxViewActions,
  marks: { pinned: boolean; snoozed: boolean },
): HTMLElement {
  const tools = el("span", { class: "row-tools" });
  if (role === "review" && pull.viaTeam) tools.append(renderHideTeams(entry.repo, pull, actions));
  const pin = rowButton(marks.pinned ? "Unpin" : "Pin to the top", "pin", `pin:${pull.url}`);
  pin.setAttribute("aria-pressed", String(marks.pinned));
  pin.addEventListener("click", () => actions.togglePin(pull.url));
  tools.append(pin);
  if (marks.snoozed) {
    const wake = rowButton("Wake: show it again", "clock", `wake:${pull.url}`);
    wake.addEventListener("click", () => actions.snooze(pull, null));
    tools.append(wake);
    return tools;
  }
  const snooze = rowButton("Snooze", "clock", `snooze:${pull.url}`);
  snooze.setAttribute("aria-haspopup", "menu");
  snooze.setAttribute("aria-expanded", "false");
  const menu = el("span", { class: "snooze-menu", role: "menu", hidden: "" });
  for (const [preset, label] of SNOOZE_CHOICES) {
    const choice = el("button", { type: "button", role: "menuitem", tabindex: "-1", "data-preset": preset }, label);
    choice.addEventListener("click", () => actions.snooze(pull, preset));
    menu.append(choice);
  }
  const close = (refocus: boolean) => {
    menu.hidden = true;
    snooze.setAttribute("aria-expanded", "false");
    if (refocus) snooze.focus();
  };
  snooze.addEventListener("click", () => {
    const opening = menu.hidden === true;
    menu.hidden = !opening;
    snooze.setAttribute("aria-expanded", String(opening));
    if (opening) menu.querySelector<HTMLElement>("button")?.focus();
  });
  menu.addEventListener("keydown", (event) => {
    const items = [...menu.querySelectorAll<HTMLElement>("button")];
    const at = items.indexOf(event.target as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      items[(at + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
    }
  });
  menu.addEventListener("focusout", (event) => {
    if (!(event.relatedTarget instanceof Node) || !tools.contains(event.relatedTarget)) close(false);
  });
  tools.append(snooze, menu);
  return tools;
}

/** The ways to snooze a pull request, in the menu's order. */
const SNOOZE_CHOICES: [SnoozePreset, string][] = [
  ["hour", "For an hour"],
  ["tomorrow", "Until tomorrow, 9:00"],
  ["activity", "Until something happens on it"],
];

/** An icon button among a row's tools; the list's single tab stop moves it with its row. */
function rowButton(label: string, name: "pin" | "clock", focusKey: string): HTMLButtonElement {
  const button = el("button", { type: "button", class: "row-tool", tabindex: "-1", "aria-label": label, title: label, "data-focus-key": focusKey });
  button.append(icon(name));
  return button;
}

/**
 * @param pull The pull request.
 * @param role The search that found it.
 * @returns The chips that say why it waits for whom, with its status when no chip says it already.
 */
function renderReasons(pull: InboxPull, role: InboxRole, kind: SectionKind): HTMLElement[] {
  // A review request is what the "Your turn" section means by default, being asked again what "Re-requested" means,
  // and the viewer's verdict says more than "waiting for author".
  const said = new Set(["requested", "waiting-on-author", ...(kind === "again" ? ["rerequested"] : [])]);
  const reasons = (pull.turn?.reasons ?? []).filter((reason) => !said.has(reason.code));
  const chips = reasons.map((reason) => {
    const words = reasonWords(reason);
    return flag(words.text, words.tone, words.detail);
  });
  if (role === "waiting") {
    const verdict = pull.yourVerdict ? flag(...YOUR_VERDICT[pull.yourVerdict]) : null;
    const pushed = pull.pushedSinceReview && reasons.every((reason) => reason.code !== "pushed-since-review") ? [flag("New commits", "accent")] : [];
    return [...(verdict ? [verdict] : []), ...chips, ...pushed];
  }
  if (!pull.turn && role === "review" && pull.rerequested && kind !== "again") chips.push(flag("Re-requested", "attention"));
  const shown = new Set(chips.map((chip) => chip.textContent));
  const quiet = role === "review" && pull.tone === "accent";
  return quiet || shown.has(pull.label) || (pull.label === "Draft" && reasons.length > 0) ? chips : [renderStatus(pull), ...chips];
}

/** The viewer's verdict its author has to answer, as a waiting row says it. */
const YOUR_VERDICT: Record<"changes_requested" | "commented", [string, ReasonTone]> = {
  changes_requested: ["You requested changes", "attention"],
  commented: ["You commented", "neutral"],
};

/** A tone-coloured note in a row's meta line, like a verdict or a fresh push. */
function flag(text: string, tone: ReasonTone, detail?: string): HTMLElement {
  const chip = el("span", { class: "item status", "data-tone": tone }, text);
  if (detail) chip.title = detail;
  return chip;
}

/** Sets the repository to count only direct requests, for a row that reached the viewer through a team. */
function renderHideTeams(repo: string, pull: InboxPull, actions: InboxViewActions): HTMLElement {
  const hide = el(
    "button",
    {
      type: "button",
      class: "hide-teams",
      tabindex: "-1",
      title: `Show only pull requests that request you by name in ${repo}. Undo it in the settings.`,
      "aria-label": `Hide team requests in ${repo}`,
      "data-focus-key": `hide-teams:${pull.url}`,
    },
    "Hide team requests",
  );
  hide.addEventListener("click", () => {
    hide.disabled = true;
    actions.hideTeamRequests(repo);
  });
  return hide;
}

/** The most faces a row shows; the rest are counted. */
const MAX_FACES = 4;

/**
 * @param pull The pull request.
 * @returns Everyone else's latest verdict as faces, its tooltip naming each, or null when nobody else reviewed.
 */
function renderFaces(pull: InboxPull): HTMLElement | null {
  const reviews = pull.reviews ?? [];
  if (reviews.length === 0) return null;
  const said = reviews.map((review) => `${review.login} ${VERDICT_LOOK[review.verdict].said}`).join(", ");
  const faces = el("span", { class: "faces", title: said, "aria-hidden": "true" });
  for (const review of reviews.slice(0, MAX_FACES)) faces.append(verdictFace(review));
  if (reviews.length > MAX_FACES) faces.append(el("span", { class: "more" }, `+${reviews.length - MAX_FACES}`));
  return faces;
}

function renderStatus(pull: InboxPull): HTMLElement {
  return el("span", { class: "item status", "data-tone": pull.tone }, pull.label);
}

function renderThreads(pull: InboxPull): HTMLElement {
  const done = pull.resolvedThreads === pull.totalThreads;
  const label = `${pull.resolvedThreads} of ${pull.totalThreads} conversations resolved`;
  const threads = el("span", { class: done ? "item threads done" : "item threads", title: label });
  threads.append(icon("comment"), el("span", { "aria-hidden": "true" }, `${pull.resolvedThreads}/${pull.totalThreads}`));
  threads.append(el("span", { class: "visually-hidden" }, label));
  return threads;
}

/** The pull request's added and deleted lines, like the counts in the Files changed tree. */
function renderDiffStat(pull: InboxPull): HTMLElement | null {
  const stat = formatDiffStat(pull.additions ?? 0, pull.deletions ?? 0);
  if (!stat) return null;
  const element = el("span", { class: "item diffstat", title: stat.label });
  const visible = el("span", { "aria-hidden": "true" });
  if (stat.added) visible.append(el("span", { class: "added" }, stat.added));
  if (stat.deleted) visible.append(el("span", { class: "deleted" }, stat.deleted));
  element.append(visible, el("span", { class: "visually-hidden" }, stat.label));
  return element;
}

function renderAvatar(pull: InboxPull): HTMLElement {
  if (!pull.avatarUrl) return avatarPlaceholder();
  const url = new URL(pull.avatarUrl);
  url.searchParams.set("s", "40");
  const image = el("img", { class: "avatar", src: url.href, alt: "", width: "20", height: "20" });
  image.addEventListener("error", () => image.replaceWith(avatarPlaceholder()));
  return image;
}

function avatarPlaceholder(): HTMLElement {
  const span = el("span", { class: "avatar placeholder" });
  span.append(icon("people"));
  return span;
}

/**
 * Writes a row's relative time, and marks it when a review request has waited too long.
 * @param time The time element.
 * @param spoken The hidden element that says the same thing out loud.
 * @param now The current time in epoch milliseconds.
 */
export function updateAge(time: HTMLTimeElement, spoken: Element | null, now: number): void {
  const age = formatAge(time.dateTime, now);
  const stale = time.dataset.flagStale !== undefined && isStale({ lastActivity: time.dateTime }, now);
  time.textContent = age.short;
  time.classList.toggle("stale", stale);
  time.title = stale ? `Last activity ${age.spoken}, waiting for a while` : `Last activity ${age.spoken}`;
  if (spoken) spoken.textContent = `, ${time.title.toLowerCase()}`;
}
