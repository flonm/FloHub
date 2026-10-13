import { formatAge } from "./age";
import { el, iconButton } from "./dom";
import type { Inbox, InboxGroup, InboxPull } from "./inbox";
import { send } from "./messages";

type Problem = { kind: "setup" | "error"; message: string } | null;

const app = document.querySelector<HTMLElement>("#app");
let inbox: Inbox | null = null;
let refreshing = true;
let problem: Problem = null;

if (app) {
  void chrome.storage.local.get("inbox").then((stored) => {
    inbox ??= (stored.inbox as Inbox | undefined) ?? null;
    render();
  });
  void refresh();
}

async function refresh(): Promise<void> {
  refreshing = true;
  render();
  const reply = await send({ type: "inbox" });
  refreshing = false;
  if (reply.ok) {
    inbox = reply.value;
    problem = null;
  } else {
    problem = { kind: reply.code === "failed" ? "error" : "setup", message: reply.message };
  }
  render();
}

function render(): void {
  if (!app) return;
  const focusKey = (document.activeElement as HTMLElement | null)?.dataset.focusKey;
  app.replaceChildren(renderHeader(), renderBody());
  if (focusKey) document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus();
}

function renderHeader(): HTMLElement {
  const header = el("header");
  const updated = refreshing
    ? "Updating…"
    : inbox
      ? `Updated ${formatAge(new Date(inbox.fetchedAt).toISOString(), Date.now()).spoken}`
      : "";
  const reload = iconButton("refresh", "Refresh", () => void refresh(), "refresh");
  if (refreshing) {
    reload.classList.add("spinning");
    reload.setAttribute("aria-busy", "true");
  }
  const settings = iconButton("gear", "Settings", () => void chrome.runtime.openOptionsPage(), "settings");
  header.append(el("h1", {}, "Inbox"), el("span", { class: "updated", role: "status" }, updated), reload, settings);
  return header;
}

function renderBody(): HTMLElement {
  const main = el("main");
  if (problem?.kind === "setup") {
    main.append(el("p", { class: "message" }, problem.message));
    const setup = el("button", { type: "button", class: "text-button", "data-focus-key": "setup" }, "Set up token");
    setup.addEventListener("click", () => void chrome.runtime.openOptionsPage());
    main.append(setup);
    return main;
  }
  if (problem) main.append(el("p", { class: "notice", role: "alert" }, problem.message));
  if (!inbox) {
    if (!problem) main.append(el("p", { class: "message" }, "Loading your inbox…"));
    return main;
  }
  main.append(
    renderSection("Waiting for your review", inbox.review, "Nothing waits for your review.", true),
    renderSection("Your pull requests", inbox.mine, "You have no open pull requests.", false),
  );
  return main;
}

function renderSection(title: string, groups: InboxGroup[], empty: string, showAuthor: boolean): HTMLElement {
  const count = groups.reduce((sum, entry) => sum + entry.pulls.length, 0);
  const section = el("section", { "aria-label": title });
  const heading = el("h2", {}, title);
  heading.append(el("span", { class: "count" }, String(count)));
  section.append(heading);
  if (groups.length === 0) {
    section.append(el("p", { class: "empty" }, empty));
    return section;
  }
  const list = el("ul");
  for (const entry of groups) list.append(renderGroup(entry, showAuthor));
  section.append(list);
  return section;
}

function renderGroup(entry: InboxGroup, showAuthor: boolean): HTMLElement {
  const item = el("li");
  const label = el("div", { class: "group-label" }, entry.repo);
  if (entry.stackNumber !== null) label.append(el("span", {}, `· Stack of ${entry.stackSize}`));
  const list = el("ul");
  for (const pull of entry.pulls) list.append(renderPull(pull, entry, showAuthor));
  item.append(label, list);
  return item;
}

function renderPull(pull: InboxPull, entry: InboxGroup, showAuthor: boolean): HTMLElement {
  const item = el("li");
  const link = el("a", { class: "pull", href: pull.url, "data-focus-key": `pull:${pull.url}` });
  link.addEventListener("click", (event) => {
    event.preventDefault();
    const background = event.metaKey || event.ctrlKey;
    void chrome.tabs.create({ url: pull.url, active: !background });
    if (!background) window.close();
  });

  const title = el("span", { class: "title" });
  title.append(el("span", { class: "number" }, `#${pull.number} `), pull.title);
  const meta = el("span", { class: "meta" });
  if (pull.rerequested) meta.append(el("span", { class: "tag" }, "Re-requested"));
  if (showAuthor && pull.author) meta.append(el("span", {}, pull.author));
  if (pull.position !== null && entry.stackNumber !== null) {
    meta.append(el("span", { title: "Layer in its stack, counted from the base" }, `Layer ${pull.position}/${entry.stackSize}`));
  }
  if (pull.totalThreads > 0) {
    meta.append(el("span", {}, `${pull.resolvedThreads}/${pull.totalThreads} resolved`));
  }
  const age = formatAge(pull.lastActivity, Date.now());
  meta.append(el("span", { title: `Last activity ${age.spoken}` }, age.short));

  link.append(el("span", { class: "state", "data-tone": pull.tone }, pull.label), title, meta);
  item.append(link);
  return item;
}

