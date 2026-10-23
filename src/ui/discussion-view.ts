import { formatAge } from "../core/age";
import { type DiscussionItem, type DiscussionVerdict, isUnread } from "../core/discussion";
import type { DismissedVerdict } from "../core/reviewers";
import { el, icon } from "./dom";
import { renderRichText } from "../core/rich-text";

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

const DISMISSED_LABEL: Record<DismissedVerdict, { label: string; tone: string }> = {
  approved: { label: "Dismissed approval", tone: "success" },
  changes_requested: { label: "Dismissed change request", tone: "attention" },
};

/** Collapsed, the section shows the new items, up to this many, or else the newest one. */
const MAX_COLLAPSED = 5;
/** Texts longer than this, with more lines, or with block content, are clamped behind a "Show more" toggle. */
const CLAMP_CHARACTERS = 240;
const CLAMP_LINES = 3;
const BLOCK_CONTENT = /<(pre|img|table|ul|ol|blockquote|details|h[1-6])\b/iu;

/** Items whose full text the viewer opened, kept across re-renders. */
const opened = new Set<string>();

interface Shown {
  visible: DiscussionItem[];
  unread: DiscussionItem[];
  shown: DiscussionItem[];
  bots: number;
}

function select(options: DiscussionOptions): Shown {
  const bots = options.items.filter((item) => item.bot).length;
  const visible = options.showBots ? options.items : options.items.filter((item) => !item.bot);
  const unread = visible.filter((item) => isUnread(item, options.seenAt, options.viewer));
  const shown = options.expanded ? visible : (unread.length > 0 ? unread.slice(0, MAX_COLLAPSED) : visible.slice(0, 1));
  return { visible, unread, shown, bots };
}

/**
 * The discussion's controls for the bar's toolbar: how many comments there are and how many are new, which opens
 * the rest, and the switch for bots and stack tools.
 * @param options The items and display state.
 * @returns The controls, or none when the pull request has no such comments.
 */
export function renderDiscussionControls(options: DiscussionOptions): HTMLElement[] {
  if (options.items.length === 0) return [];
  const { visible, unread, shown, bots } = select(options);
  const count = countLabel(visible.length);
  const fresh = unread.length > 0 ? `, ${unread.length} new` : "";
  const more = visible.length > shown.length || options.expanded;
  const toggle = more
    ? el("button", {
        type: "button",
        class: "tool",
        "aria-expanded": String(options.expanded),
        "aria-label": `Discussion: ${count}${fresh}. ${options.expanded ? "Show only the newest" : "Show all"}`,
        "data-tip": options.expanded ? "Show only the newest" : `Show all ${count}`,
        "data-focus-key": "discussion-toggle",
      })
    : el("span", { class: "tool static", "aria-label": `Discussion: ${count}${fresh}`, "data-tip": `Discussion: ${count}${fresh}` });
  toggle.append(icon("comment"), el("span", { class: "tool-count", "aria-hidden": "true" }, String(visible.length)));
  if (unread.length > 0) toggle.append(el("span", { class: "discussion-new", "aria-hidden": "true" }, `${unread.length} new`));
  if (more) toggle.append(icon("chevron", "chevron"));
  if (toggle instanceof HTMLButtonElement) toggle.addEventListener("click", options.toggleExpanded);
  const controls: HTMLElement[] = [toggle];
  if (bots > 0) {
    const label = `${options.showBots ? "Hide" : "Show"} ${bots === 1 ? "the comment" : `${bots} comments`} from bots and stack tools`;
    const botToggle = el("button", {
      type: "button",
      class: "tool",
      "aria-pressed": String(options.showBots),
      "aria-label": label,
      "data-tip": label,
      "data-focus-key": "discussion-bots",
    });
    botToggle.append(icon("bot"), el("span", { class: "tool-count", "aria-hidden": "true" }, String(bots)));
    botToggle.addEventListener("click", options.toggleBots);
    controls.push(botToggle);
  }
  return controls;
}

/**
 * Renders the pull request's review texts and general comments: the new ones by default, everything on demand,
 * bots and stack tools only when asked for.
 * @param options The items and display state.
 * @returns The list, or null when there is nothing to show.
 */
export function renderDiscussionList(options: DiscussionOptions): HTMLElement | null {
  if (options.items.length === 0) return null;
  const { shown } = select(options);
  if (shown.length === 0) return null;
  const list = el("ol", { class: "discussion-list", "aria-label": "Discussion" });
  for (const item of shown) list.append(renderItem(item, isUnread(item, options.seenAt, options.viewer), options.now));
  return list;
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
    const verdict = item.dismissedFrom ? DISMISSED_LABEL[item.dismissedFrom] : VERDICT_LABEL[item.verdict];
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
