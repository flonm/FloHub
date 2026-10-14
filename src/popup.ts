import { formatAge } from "./age";
import { el, icon, iconButton } from "./dom";
import { type Inbox, type InboxGroup, type InboxPull, isStale } from "./inbox";
import { INBOX_PERIOD_MINUTES } from "./inbox-sync";
import { blocksInbox, isEmptyInbox, moveSelection, type Problem, problemFor, showsPull, updatedLabel } from "./inbox-view";
import { send } from "./messages";
import { writeReviewScope } from "./review-scope";
import { formatDiffStat } from "./viewed";

type SectionKind = "review" | "mine";

const TICK_MS = 15_000;

const app = document.querySelector<HTMLElement>("#app");
let inbox: Inbox | null = null;
let loaded = false;
let refreshing = false;
/** Whether another refresh was asked for while one ran. */
let again = false;
let problem: Problem | null = null;
/** The row that holds the list's single tab stop. */
let selectedKey: string | null = null;
/** Whether focus was placed once, so later renders never take it from where the user moved it. */
let placedFocus = false;

const top = el("div", { class: "top" });
const header = el("header");
const updated = el("span", { class: "updated" });
const reload = iconButton("refresh", "Refresh", () => void refresh(), "refresh");
const settings = iconButton("gear", "Settings", () => void openSettings(), "settings");
const notice = el("div", { class: "notice", role: "alert", hidden: "" });
const live = el("div", { class: "visually-hidden", role: "status" });
const main = el("main", { "aria-label": "Inbox" });

if (app) {
  header.append(el("h1", {}, "Inbox"), updated, reload, settings);
  top.append(header, notice);
  app.append(top, main, live);
  document.addEventListener("keydown", onKeydown);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if ("token" in changes) void refresh();
    else if ("inbox" in changes && !refreshing) {
      // The service worker refreshed it on its schedule, or dropped it and is about to fetch it again.
      const next = changes.inbox.newValue as Inbox | undefined;
      if (!next) {
        void refresh();
        return;
      }
      inbox = next;
      render();
    }
  });
  setInterval(tick, TICK_MS);
  void refresh();
  void showStored();
}

/** Shows the inbox the service worker stored last, until the refresh answers. */
async function showStored(): Promise<void> {
  const stored = await chrome.storage.local.get("inbox");
  inbox ??= (stored.inbox as Inbox | undefined) ?? null;
  loaded = true;
  render();
}

async function refresh(announce = false): Promise<void> {
  if (refreshing) {
    // The token or the stored inbox changed under a running refresh, so its answer may be outdated.
    again = true;
    return;
  }
  refreshing = true;
  again = false;
  render();
  const reply = await send({ type: "inbox" });
  refreshing = false;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- a storage change may set it while `send` runs
  if (again) {
    void refresh(announce);
    return;
  }
  loaded = true;
  if (reply.ok) {
    inbox = reply.value;
    problem = null;
    if (announce) live.textContent = "Inbox updated";
  } else {
    problem = problemFor(reply.code, reply.message);
    if (blocksInbox(problem)) inbox = null;
  }
  render();
}

async function openSettings(): Promise<void> {
  await chrome.runtime.openOptionsPage();
  window.close();
}

function render(): void {
  if (!app || !loaded) return;
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const focusKey = focused?.dataset.focusKey;
  const focusIndex = rows().indexOf(focused as HTMLAnchorElement);

  renderHeader();
  main.replaceChildren(...renderBody());
  main.setAttribute("aria-busy", String(refreshing && !inbox));
  updateTabStop();
  document.documentElement.style.scrollPaddingTop = `${top.offsetHeight}px`;

  const target =
    (focusKey ? document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`) : null) ??
    (focusIndex === -1 ? null : (rows()[Math.min(focusIndex, rows().length - 1)] ?? null));
  if (target) {
    target.focus({ preventScroll: true });
  } else if (!placedFocus || !document.activeElement || document.activeElement === document.body) {
    // The popup opens with focus on its first row, or on its one action.
    const first = rows()[0] ?? main.querySelector<HTMLElement>("button");
    if (first) {
      first.focus({ preventScroll: true });
      placedFocus = true;
    }
  }
}

function renderHeader(): void {
  updated.textContent = inbox ? updatedLabel(inbox.fetchedAt, Date.now()) : "";
  reload.classList.toggle("spinning", refreshing);
  reload.title = refreshing ? "Refreshing" : "Refresh";
  reload.setAttribute("aria-label", reload.title);
  const stale = problem?.kind === "error" && inbox !== null;
  notice.hidden = !stale;
  if (stale && problem) {
    const text = el("span", { class: "notice-text", title: problem.message }, problem.message);
    const retry = el("button", { type: "button", class: "link-button", "data-focus-key": "retry" }, "Retry");
    retry.addEventListener("click", () => void refresh(true));
    notice.replaceChildren(icon("cross"), text, retry);
  } else {
    notice.replaceChildren();
  }
}

function renderBody(): HTMLElement[] {
  if (problem && (blocksInbox(problem) || !inbox)) return [renderProblem(problem)];
  if (!inbox) return [renderSkeleton()];
  if (isEmptyInbox(inbox)) {
    return [blank("check", "Nothing to review", `No review requests and no open pull requests. FloHub checks again every ${INBOX_PERIOD_MINUTES} minutes.`)];
  }
  return [
    renderSection("Waiting for your review", inbox.review, "No review requests.", "review"),
    renderSection("Your pull requests", inbox.mine, "No open pull requests.", "mine"),
  ];
}

function renderProblem(current: Problem): HTMLElement {
  switch (current.kind) {
    case "no-token": {
      return blank("people", "Add a GitHub token", "The inbox needs a token to find your review requests and pull requests.", [
        "Set up token",
        () => void openSettings(),
      ]);
    }
    case "unauthorized": {
      return blank("cross", "GitHub rejected the token", "It may have expired or been revoked. Add a new one in the settings.", [
        "Open settings",
        () => void openSettings(),
      ]);
    }
    case "scopes": {
      return blank("cross", "The token needs more access", `${current.message} Create one with the repo and read:org scopes.`, [
        "Open settings",
        () => void openSettings(),
      ]);
    }
    case "error": {
      return blank("cross", "Could not load the inbox", current.message, ["Try again", () => void refresh(true)]);
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

function renderSection(title: string, groups: InboxGroup[], empty: string, kind: SectionKind): HTMLElement {
  const count = groups.reduce((sum, entry) => sum + entry.pulls.length, 0);
  const id = `section-${kind}`;
  const section = el("section", { "aria-labelledby": id });
  const heading = el("h2", { id }, title);
  heading.append(el("span", { class: "count" }, String(count)));
  section.append(heading);
  if (groups.length === 0) {
    section.append(el("p", { class: "empty" }, empty));
    return section;
  }
  const list = el("ul", { class: "groups" });
  for (const entry of groups) list.append(renderGroup(entry, kind));
  section.append(list);
  return section;
}

function renderGroup(entry: InboxGroup, kind: SectionKind): HTMLElement {
  // Layers of one stack stay adjacent; a rail joins them only when the inbox holds more than one.
  const joined = entry.stackNumber !== null && entry.pulls.length > 1;
  const item = el("li", { class: joined ? "group joined" : "group" });
  const list = el("ul", { class: "layers" });
  if (entry.stackNumber !== null) list.setAttribute("aria-label", `Stack of ${entry.stackSize} in ${entry.repo}`);
  for (const pull of entry.pulls) list.append(renderPull(pull, entry, kind));
  item.append(list);
  return item;
}

function renderPull(pull: InboxPull, entry: InboxGroup, kind: SectionKind): HTMLElement {
  const item = el("li", { class: "layer" });
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
    void openPull(pull.url, event.metaKey || event.ctrlKey);
  });
  link.addEventListener("mousedown", (event) => {
    if (event.button === 1) event.preventDefault();
  });
  link.addEventListener("auxclick", (event) => {
    if (event.button !== 1) return;
    event.preventDefault();
    void openPull(pull.url, true);
  });
  link.addEventListener("focus", () => {
    selectedKey = key;
    updateTabStop();
  });

  const title = el("span", { class: "title", id: ids.title, title: `#${pull.number} ${pull.title}` });
  title.append(el("span", { class: "number" }, `#${pull.number} `), pull.title);

  const time = el("time", { class: "age", datetime: pull.lastActivity, "aria-hidden": "true" });
  if (kind === "review") time.dataset.flagStale = "";
  const spoken = el("span", { class: "visually-hidden spoken-age" });

  const meta = el("span", { class: "meta", id: ids.meta });
  if (kind === "review") {
    if (pull.rerequested) meta.append(el("span", { class: "tag", "data-tone": "attention" }, "Re-requested"));
    if (pull.author) meta.append(el("span", { class: "item author" }, pull.author));
    if (pull.tone !== "accent") meta.append(renderStatus(pull));
  } else {
    meta.append(renderStatus(pull));
  }
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
  lead.append(kind === "review" ? renderAvatar(pull) : el("span", { class: "node", "data-tone": pull.tone }));

  link.append(lead, title, time, meta);
  item.append(link);
  if (kind === "review" && pull.viaTeam) item.append(renderHideTeams(entry.repo, pull));
  return item;
}

/** Sets the repository to count only direct requests, for a row that reached the viewer through a team. */
function renderHideTeams(repo: string, pull: InboxPull): HTMLElement {
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
    void hideTeamRequests(repo);
  });
  return hide;
}

async function hideTeamRequests(repo: string): Promise<void> {
  await writeReviewScope(repo, "direct");
  live.textContent = `Team requests in ${repo} hidden. Undo it in the settings.`;
}

function updateAge(time: HTMLTimeElement, spoken: Element | null, now: number): void {
  const age = formatAge(time.dateTime, now);
  const stale = time.dataset.flagStale !== undefined && isStale({ lastActivity: time.dateTime }, now);
  time.textContent = age.short;
  time.classList.toggle("stale", stale);
  time.title = stale ? `Last activity ${age.spoken}, waiting for a while` : `Last activity ${age.spoken}`;
  if (spoken) spoken.textContent = `, ${time.title.toLowerCase()}`;
}

/** Keeps the relative times truthful while the popup stays open. */
function tick(): void {
  const now = Date.now();
  if (inbox) updated.textContent = updatedLabel(inbox.fetchedAt, now);
  for (const time of main.querySelectorAll<HTMLTimeElement>("time.age")) {
    updateAge(time, time.closest(".pull")?.querySelector(".spoken-age") ?? null, now);
  }
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

function rows(): HTMLAnchorElement[] {
  return [...main.querySelectorAll<HTMLAnchorElement>("a.pull")];
}

/** Gives the list one tab stop, on the selected row, so Tab moves between the header and the list. */
function updateTabStop(): void {
  const all = rows();
  const selected = all.find((row) => row.dataset.focusKey === selectedKey) ?? all[0];
  for (const row of all) {
    row.tabIndex = row === selected ? 0 : -1;
    const hide = row.parentElement?.querySelector<HTMLButtonElement>(".hide-teams");
    if (hide) hide.tabIndex = row.tabIndex;
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    window.close();
    return;
  }
  if (event.altKey || event.isComposing) return;
  const all = rows();
  const row = event.target instanceof HTMLAnchorElement ? event.target : null;
  const index = row ? all.indexOf(row) : -1;
  if (event.key === "Enter" && row && index >= 0) {
    event.preventDefault();
    void openPull(row.href, event.metaKey || event.ctrlKey);
    return;
  }
  if (event.metaKey || event.ctrlKey || event.shiftKey) return;
  // From the header, only the arrow down and j step into the list; elsewhere they keep their usual meaning.
  if (index < 0 && event.key !== "ArrowDown" && event.key !== "j") return;
  const next = moveSelection(event.key, index < 0 ? -1 : index, all.length);
  if (next === null) return;
  event.preventDefault();
  const target = index < 0 ? (all.find((candidate) => candidate.tabIndex === 0) ?? all[next]) : all[next];
  target?.focus({ preventScroll: true });
  target?.scrollIntoView({ block: "nearest" });
}

/**
 * Opens a pull request. A plain open switches to a tab that already shows it, when the extension can see one,
 * and closes the popup; a background open always adds a tab and keeps the popup open.
 * @param url The pull request.
 * @param background Whether to open it in a background tab.
 */
async function openPull(url: string, background: boolean): Promise<void> {
  if (background) {
    await chrome.tabs.create({ url, active: false });
    return;
  }
  const existing = await findTab(url);
  if (existing?.id === undefined) {
    await chrome.tabs.create({ url, active: true });
  } else {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  }
  window.close();
}

async function findTab(url: string): Promise<chrome.tabs.Tab | undefined> {
  try {
    // Without the tabs permission, the query only sees tabs on hosts the content script runs on.
    const [tabs, current] = await Promise.all([chrome.tabs.query({ url: `${url}*` }), chrome.windows.getCurrent()]);
    const matching = tabs.filter((tab) => (tab.url ? showsPull(tab.url, url) : false));
    return matching.find((tab) => tab.windowId === current.id) ?? matching[0];
  } catch {
    return undefined;
  }
}
