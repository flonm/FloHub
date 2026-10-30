import { el, icon, iconButton } from "./ui/dom";
import type { Inbox } from "./core/inbox";
import {
  blocksInbox,
  type EverythingState,
  FOLDED_AT_FIRST,
  type InboxViewActions,
  moveSelection,
  type Problem,
  problemFor,
  renderInbox,
  type SectionKind,
  showsPull,
  updateAge,
  updatedLabel,
} from "./ui/inbox-view";
import { send } from "./api/messages";
import { writeReviewScope } from "./core/review-scope";
import { type InboxMarks, isPinned, MARKS_KEY, NO_MARKS, readMarks, setSnooze, snoozeFor, togglePin } from "./core/inbox-marks";
import {
  DEFAULT_PROFILES,
  loadProfiles,
  PROFILES_KEY,
  profileGroups,
  profileInbox,
  type Profiles,
  readProfiles,
  saveProfiles,
  searchScopes,
} from "./core/profiles";
import { EVERYTHING_KEY, type Everything } from "./api/inbox-sync";
import { renderProfileSwitch } from "./ui/profile-view";

const TICK_MS = 15_000;
/** How old the stored inbox may be for opening the popup to skip asking GitHub; the alarm refreshes it every few minutes. */
const FRESH_MS = 60_000;

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
/** Sections the user folded away, kept across popups. */
let collapsed = new Set<SectionKind>();
/** Sections that start folded which the user opened, kept across popups. */
let opened = new Set<SectionKind>();
/** The open pull requests loaded for "Everything else", whether a load runs, and why the last one failed. */
let everything: Everything | undefined;
let loadingEverything = false;
let everythingError: string | undefined;
/** The pull requests the user pinned or snoozed, kept in storage for the service worker's notifications too. */
let marks: InboxMarks = NO_MARKS;
/** Which repositories the inbox shows, kept in sync storage. */
let profiles: Profiles = DEFAULT_PROFILES;
/** The sections whose snoozed pull requests are shown, for this popup only. */
const showSnoozed = new Set<SectionKind>();

const top = el("div", { class: "top" });
const header = el("header");
const title = el("h1", {}, "Inbox");
const updated = el("span", { class: "updated" });
const reload = iconButton("refresh", "Refresh", () => void refresh(), "refresh");
const settings = iconButton("gear", "Settings", () => void openSettings(), "settings");
const notice = el("div", { class: "notice", role: "alert", hidden: "" });
const live = el("div", { class: "visually-hidden", role: "status" });
const main = el("main", { "aria-label": "Inbox" });

const actions: InboxViewActions = {
  openPull: (url, background) => void openPull(url, background),
  focusRow: (key) => {
    selectedKey = key;
    updateTabStop();
  },
  toggleSection: (kind) => void toggleSection(kind),
  hideTeamRequests: (repo) => void hideTeamRequests(repo),
  togglePin: (url) => void saveMarks(togglePin(marks, url), isPinned(marks, url) ? "Unpinned" : "Pinned to the top"),
  snooze: (pull, preset) => {
    const snooze = preset ? snoozeFor(preset, new Date(), pull) : null;
    void saveMarks(setSnooze(marks, pull.url, snooze), preset ? `Snoozed #${pull.number}` : `#${pull.number} is back`);
  },
  toggleSnoozed: (kind) => {
    if (showSnoozed.has(kind)) showSnoozed.delete(kind);
    else showSnoozed.add(kind);
    render();
  },
  loadEverything: () => void fetchEverything(),
  retryRefresh: () => void refresh(true),
  openSettings: () => void openSettings(),
};

if (app) {
  header.append(title, updated, reload, settings);
  top.append(header, notice);
  app.append(top, main, live);
  document.addEventListener("keydown", onKeydown);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && Object.hasOwn(changes, PROFILES_KEY)) {
      profiles = readProfiles(changes[PROFILES_KEY]?.newValue);
      render();
    }
    if (area !== "local") return;
    if (Object.hasOwn(changes, MARKS_KEY)) {
      marks = readMarks(changes[MARKS_KEY]?.newValue);
      render();
    }
    if (Object.hasOwn(changes, EVERYTHING_KEY)) {
      everything = changes[EVERYTHING_KEY]?.newValue as Everything | undefined;
      render();
    }
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
  void refresh(false, FRESH_MS);
  void showStored();
}

/** Shows the inbox the service worker stored last, until the refresh answers. */
async function showStored(): Promise<void> {
  const [stored, saved] = await Promise.all([
    chrome.storage.local.get(["inbox", "inboxCollapsed", "inboxOpened", EVERYTHING_KEY, MARKS_KEY]),
    loadProfiles(),
  ]);
  profiles = saved;
  everything = stored[EVERYTHING_KEY] as Everything | undefined;
  opened = new Set(stored.inboxOpened as SectionKind[] | undefined);
  inbox ??= (stored.inbox as Inbox | undefined) ?? null;
  collapsed = new Set(stored.inboxCollapsed as SectionKind[] | undefined);
  marks = readMarks(stored[MARKS_KEY]);
  loaded = true;
  render();
}

/**
 * @param announce Whether to tell a screen reader once the inbox is updated.
 * @param maxAgeMs How old a stored inbox may be to answer instead of fetching; omit it to always fetch.
 */
async function refresh(announce = false, maxAgeMs?: number): Promise<void> {
  if (refreshing) {
    // The token or the stored inbox changed under a running refresh, so its answer may be outdated.
    again = true;
    return;
  }
  refreshing = true;
  again = false;
  render();
  const reply = await send({ type: "inbox", maxAgeMs });
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
  const shown = inbox && profileInbox(inbox, profiles);
  const scope = profiles.active === null ? undefined : profiles.names[profiles.active];
  const folded = new Set(collapsed);
  for (const kind of FOLDED_AT_FIRST) if (!opened.has(kind)) folded.add(kind);
  const fetched = everything && { ...everything, groups: profileGroups(everything.groups, profiles) };
  const more: EverythingState = {
    loading: loadingEverything,
    scopes: scopes(),
    ...(everythingError && { error: everythingError }),
    ...(fetched && { loaded: fetched }),
  };
  main.replaceChildren(
    ...renderInbox({ inbox: shown, problem, collapsed: folded, marks, showSnoozed, now: Date.now(), scope, everything: more }, actions),
  );
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
  const current = header.querySelector(".profile-switch");
  const next = renderProfileSwitch(profiles, (active) => void saveProfiles({ ...profiles, active }));
  if (next) {
    if (current) current.replaceWith(next);
    else title.after(next);
  } else {
    current?.remove();
  }
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

async function toggleSection(kind: SectionKind): Promise<void> {
  const set = FOLDED_AT_FIRST.has(kind) ? opened : collapsed;
  if (set.has(kind)) set.delete(kind);
  else set.add(kind);
  render();
  await chrome.storage.local.set({ inboxCollapsed: [...collapsed], inboxOpened: [...opened] });
}

/** @returns The owners and repositories "Everything else" searches: those the active profile shows. */
function scopes(): string[] {
  return searchScopes(inbox ?? undefined, profiles);
}

async function fetchEverything(): Promise<void> {
  if (loadingEverything) return;
  loadingEverything = true;
  everythingError = undefined;
  render();
  const reply = await send({ type: "everything", scopes: scopes() });
  loadingEverything = false;
  if (reply.ok) {
    everything = reply.value;
    live.textContent = "Loaded every open pull request";
  } else {
    everythingError = reply.message;
  }
  render();
}

/**
 * @param next The marks after the user's change.
 * @param said What a screen reader hears.
 */
async function saveMarks(next: InboxMarks, said: string): Promise<void> {
  marks = next;
  render();
  live.textContent = said;
  await chrome.storage.local.set({ [MARKS_KEY]: next });
}

async function hideTeamRequests(repo: string): Promise<void> {
  await writeReviewScope(repo, "direct");
  live.textContent = `Team requests in ${repo} hidden. Undo it in the settings.`;
}

/** Keeps the relative times truthful while the popup stays open. */
function tick(): void {
  const now = Date.now();
  if (inbox) updated.textContent = updatedLabel(inbox.fetchedAt, now);
  for (const time of main.querySelectorAll<HTMLTimeElement>("time.age")) {
    updateAge(time, time.closest(".pull")?.querySelector(".spoken-age") ?? null, now);
  }
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
    const tools = row.parentElement?.querySelectorAll<HTMLButtonElement>(":scope > .row-tools > button") ?? [];
    for (const tool of tools) tool.tabIndex = row.tabIndex;
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    window.close();
    return;
  }
  // The profile switch keeps its arrow keys for picking a profile.
  if (event.altKey || event.isComposing || event.target instanceof HTMLSelectElement) return;
  const all = rows();
  const row = event.target instanceof HTMLAnchorElement ? event.target : null;
  const index = row ? all.indexOf(row) : -1;
  if (event.key === "Enter" && row && index >= 0) {
    event.preventDefault();
    void openPull(row.href, event.metaKey || event.ctrlKey);
    return;
  }
  if (event.metaKey || event.ctrlKey || event.shiftKey) return;
  // p pins the focused row, s opens its snooze menu, or wakes it while it's snoozed.
  if (row && (event.key === "p" || event.key === "s")) {
    const tool = row.parentElement?.querySelector<HTMLButtonElement>(event.key === "p" ? '[data-focus-key^="pin:"]' : '[data-focus-key^="snooze:"], [data-focus-key^="wake:"]');
    if (tool) {
      event.preventDefault();
      tool.click();
    }
    return;
  }
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
