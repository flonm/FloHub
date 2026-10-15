import { formatAge } from "./age";
import { type DiscussionItem, type DiscussionVerdict, isUnread } from "./discussion";
import { el, icon } from "./dom";
import { renderRichText } from "./rich-text";

export interface DiscussionOptions {
  items: DiscussionItem[];
  /** When the viewer last looked at the pull request, or null to mark nothing as new. */
  seenAt: string | null;
  viewer: string;
  expanded: boolean;
  showBots: boolean;
  now: number;
  toggleExpanded: () => void;
  toggleBots: () => void;
}

const VERDICT_LABEL: Record<DiscussionVerdict, { label: string; tone: string }> = {
  approved: { label: "Approved", tone: "success" },
  changes_requested: { label: "Requested changes", tone: "attention" },
  dismissed: { label: "Dismissed review", tone: "muted" },
  commented: { label: "Reviewed", tone: "muted" },
};

/** Collapsed, the section shows the new items, up to this many, or else the newest one. */
const MAX_COLLAPSED = 5;
/** Texts longer than this, with more lines, or with block content, are clamped behind a "Show more" toggle. */
const CLAMP_CHARACTERS = 240;
const CLAMP_LINES = 3;
const BLOCK_CONTENT = /<(pre|img|table|ul|ol|blockquote|details|h[1-6])\b/iu;

/** Items whose full text the viewer opened, kept across re-renders. */
const opened = new Set<string>();

/**
 * Renders the pull request's review texts and general comments: the new ones by default, everything on demand,
 * bots and stack tools only when asked for.
 * @param options The items and display state.
 * @returns The section, or null when the pull request has no such comments.
 */
export function renderDiscussionSection(options: DiscussionOptions): HTMLElement | null {
  if (options.items.length === 0) return null;
  const bots = options.items.filter((item) => item.bot).length;
  const visible = options.showBots ? options.items : options.items.filter((item) => !item.bot);
  const unread = visible.filter((item) => isUnread(item, options.seenAt, options.viewer));
  const shown = options.expanded ? visible : (unread.length > 0 ? unread.slice(0, MAX_COLLAPSED) : visible.slice(0, 1));

  const section = el("section", { class: "discussion", "aria-label": "Discussion" });
  const header = el("div", { class: "bar" });
  header.append(el("span", { class: "label" }, "Discussion"));
  if (unread.length > 0) header.append(el("span", { class: "discussion-new" }, `${unread.length} new`));
  else header.append(el("span", { class: "message" }, countLabel(visible.length)));
  if (visible.length > shown.length || options.expanded) {
    const toggle = el(
      "button",
      { type: "button", class: "text-button", "aria-expanded": String(options.expanded), "data-focus-key": "discussion-toggle" },
      options.expanded ? "Show less" : `Show all (${visible.length})`,
    );
    toggle.addEventListener("click", options.toggleExpanded);
    header.append(toggle);
  }
  if (bots > 0) {
    const toggle = el(
      "button",
      { type: "button", class: "text-button", "aria-pressed": String(options.showBots), "data-focus-key": "discussion-bots" },
      options.showBots ? "Hide bots" : `Show bots (${bots})`,
    );
    toggle.addEventListener("click", options.toggleBots);
    header.append(toggle);
  }
  section.append(header);

  if (shown.length > 0) {
    const list = el("ol", { class: "discussion-list" });
    for (const item of shown) list.append(renderItem(item, isUnread(item, options.seenAt, options.viewer), options.now));
    section.append(list);
  }
  return section;
}

function renderItem(item: DiscussionItem, unread: boolean, now: number): HTMLElement {
  const entry = el("li", { class: unread ? "discussion-item unread" : "discussion-item" });
  const meta = el("div", { class: "discussion-meta" });
  meta.append(avatar(item));
  meta.append(
    item.profileUrl
      ? el("a", { class: "name", href: item.profileUrl, target: "_top", "data-focus-key": `discussion-author:${item.key}` }, item.author)
      : el("span", { class: "name" }, item.author),
  );
  if (item.verdict) {
    const verdict = VERDICT_LABEL[item.verdict];
    meta.append(el("span", { class: "discussion-verdict", "data-tone": verdict.tone }, verdict.label));
  }
  if (unread) meta.append(el("span", { class: "discussion-unread" }, "New"));
  const age = formatAge(item.at, now);
  meta.append(el("time", { class: "discussion-age", datetime: item.at, title: age.spoken }, age.short));
  const link = el("a", {
    class: "icon-button discussion-link",
    href: item.url,
    target: "_top",
    "aria-label": `Open ${item.author}'s ${item.verdict ? "review" : "comment"} on GitHub`,
    title: "Open on GitHub",
    "data-focus-key": `discussion-link:${item.key}`,
  });
  link.append(icon("external"));
  meta.append(link);

  const isOpen = opened.has(item.key);
  const long =
    item.text.length > CLAMP_CHARACTERS || item.text.split("\n").length > CLAMP_LINES || BLOCK_CONTENT.test(item.html ?? "");
  const text = el("div", { class: long && !isOpen ? "discussion-text clamped" : "discussion-text" });
  const rich = item.html ? renderRichText(item.html) : null;
  if (rich) text.append(rich);
  else text.append(el("p", { class: "plain" }, item.text));
  entry.append(meta, text);
  if (long) {
    const more = el(
      "button",
      { type: "button", class: "text-button discussion-more", "aria-expanded": String(isOpen), "data-focus-key": `discussion-more:${item.key}` },
      isOpen ? "Show less" : "Show more",
    );
    more.addEventListener("click", () => {
      const nowOpen = !opened.has(item.key);
      if (nowOpen) opened.add(item.key);
      else opened.delete(item.key);
      text.classList.toggle("clamped", !nowOpen);
      more.setAttribute("aria-expanded", String(nowOpen));
      more.textContent = nowOpen ? "Show less" : "Show more";
    });
    entry.append(more);
  }
  return entry;
}

function avatar(item: DiscussionItem): HTMLElement {
  if (!item.avatarUrl) {
    const placeholder = el("span", { class: "avatar placeholder" });
    placeholder.append(icon("people"));
    return placeholder;
  }
  const url = new URL(item.avatarUrl, "https://github.com");
  url.searchParams.set("s", "40");
  return el("img", { class: "avatar", src: url.href, alt: "", width: "20", height: "20" });
}

function countLabel(count: number): string {
  return count === 1 ? "1 comment" : `${count} comments`;
}
