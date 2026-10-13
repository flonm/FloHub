import { formatAge } from "./age";
import { el, icon, iconButton } from "./dom";
import { type Inbox, type InboxGroup, type InboxPull, isStale } from "./inbox";
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
    renderSection("Waiting for your review", inbox.review, "Nothing waits for your review.", "review"),
    renderSection("Your pull requests", inbox.mine, "You have no open pull requests.", "mine"),
  );
  return main;
}

type SectionKind = "review" | "mine";

function renderSection(title: string, groups: InboxGroup[], empty: string, kind: SectionKind): HTMLElement {
  const count = groups.reduce((sum, entry) => sum + entry.pulls.length, 0);
  const section = el("section", { "aria-label": title });
  const heading = el("h2", {}, title);
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
  const link = el("a", { class: "pull", href: pull.url, "data-focus-key": `pull:${pull.url}` });
  link.addEventListener("click", (event) => {
    event.preventDefault();
    const background = event.metaKey || event.ctrlKey;
    void chrome.tabs.create({ url: pull.url, active: !background });
    if (!background) window.close();
  });

  const now = Date.now();
  const title = el("span", { class: "title" });
  title.append(el("span", { class: "number" }, `#${pull.number} `), pull.title);

  const age = formatAge(pull.lastActivity, now);
  const stale = kind === "review" && isStale(pull, now);
  const time = el(
    "time",
    {
      class: stale ? "age stale" : "age",
      datetime: pull.lastActivity,
      title: stale ? `Waiting since the last activity ${age.spoken}` : `Last activity ${age.spoken}`,
    },
    age.short,
  );

  const meta = el("span", { class: "meta" });
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

  const lead = el("span", { class: "lead" });
  lead.append(kind === "review" ? renderAvatar(pull) : el("span", { class: "node", "data-tone": pull.tone }));

  link.append(lead, title, time, meta);
  item.append(link);
  return item;
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

function renderAvatar(pull: InboxPull): HTMLElement {
  const placeholder = (): HTMLElement => {
    const span = el("span", { class: "avatar placeholder" });
    span.append(icon("people"));
    return span;
  };
  if (!pull.avatarUrl) return placeholder();
  const url = new URL(pull.avatarUrl);
  url.searchParams.set("s", "40");
  const image = el("img", { class: "avatar", src: url.toString(), alt: "", width: "20", height: "20" });
  image.addEventListener("error", () => image.replaceWith(placeholder()));
  return image;
}
