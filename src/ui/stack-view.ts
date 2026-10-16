import { formatAge } from "../core/age";
import { el, icon } from "./dom";
import { pullTab } from "../core/pull-ref";
import type { StackEntry, StackView } from "../core/stack";

export interface StackSectionOptions {
  collapsed: boolean;
  showMerged: boolean;
  now: number;
  toggleCollapsed: () => void;
  toggleMerged: () => void;
}

/**
 * Renders the stack as a list from its top layer down to the base branch, collapsible to a strip.
 * @param view The stack.
 * @param options Display state and its toggles.
 * @returns The section.
 */
export function renderStackSection(view: StackView, options: StackSectionOptions): HTMLElement {
  const section = el("section", { class: "stack", "aria-label": "Stack" });
  const header = el("div", { class: "stack-header" });
  const toggle = el("button", {
    type: "button",
    class: "section-toggle",
    "aria-expanded": String(!options.collapsed),
    "data-focus-key": "stack-toggle",
  });
  toggle.append(icon("chevron", "chevron"), el("span", { class: "label" }, view.number === null ? "Status" : "Stack"));
  toggle.addEventListener("click", options.toggleCollapsed);
  header.append(toggle, el("span", { class: "message" }, describePosition(view)));
  if (options.collapsed) header.append(renderStrip(view), renderCurrentBadge(view));
  section.append(header);
  if (!options.collapsed) section.append(renderList(view, options));
  return section;
}

/**
 * @param view The stack.
 * @returns Small colored segments, one per layer from the base up, with the current layer marked.
 */
export function renderStrip(view: StackView): HTMLElement {
  const strip = el("span", { class: "strip", "aria-hidden": "true" });
  for (const entry of view.entries.toReversed()) {
    strip.append(el("span", { class: entry.current ? "segment current" : "segment", "data-stack-tone": entry.tone }));
  }
  return strip;
}

/**
 * @param view The stack.
 * @returns How the current pull request sits in its stack, e.g. "Layer 3 of 7 on main".
 */
export function describePosition(view: StackView): string {
  if (view.number === null) return `Not stacked · into ${view.baseRefName}`;
  return `Layer ${view.currentPosition} of ${view.size} · on ${view.baseRefName}`;
}

function renderCurrentBadge(view: StackView): HTMLElement {
  const current = view.entries.find((entry) => entry.current);
  return current ? badge(current) : el("span");
}

function renderList(view: StackView, options: StackSectionOptions): HTMLElement {
  const list = el("ol", { class: "stack-list" });
  const merged = view.entries.filter((entry) => entry.merged && !entry.current);
  let mergedToggleShown = false;

  for (const entry of view.entries) {
    const hideable = entry.merged && !entry.current;
    if (hideable && !mergedToggleShown) {
      mergedToggleShown = true;
      list.append(renderMergedToggle(merged.length, options));
    }
    if (hideable && !options.showMerged) continue;
    list.append(renderEntry(entry, options.now));
  }

  const trunk = el("li", { class: "trunk" });
  const rail = el("span", { class: "rail" });
  rail.append(icon("branch", "trunk-icon"));
  trunk.append(rail, el("span", { class: "trunk-name" }, view.baseRefName));
  list.append(trunk);
  return list;
}

function renderMergedToggle(count: number, options: StackSectionOptions): HTMLElement {
  const item = el("li", { class: "merged-toggle" });
  const rail = el("span", { class: "rail" });
  rail.append(el("span", { class: "node", "data-stack-tone": "done" }));
  const toggle = el("button", {
    type: "button",
    class: "text-button",
    "aria-expanded": String(options.showMerged),
    "data-focus-key": "merged-toggle",
  });
  toggle.append(icon("chevron", "chevron"), `${count} merged`);
  toggle.addEventListener("click", options.toggleMerged);
  item.append(rail, toggle);
  return item;
}

function renderEntry(entry: StackEntry, now: number): HTMLElement {
  const item = el("li", { class: entry.current ? "entry current" : "entry" });
  const link = el("a", {
    class: "entry-link",
    href: `${entry.url}${pullTab(location.pathname)}`,
    target: "_top",
    "data-focus-key": `entry:${entry.number}`,
  });
  if (entry.current) link.setAttribute("aria-current", "page");

  const rail = el("span", { class: "rail" });
  rail.append(el("span", { class: "node", "data-stack-tone": entry.tone }));

  const title = el("span", { class: "entry-title" });
  title.append(el("span", { class: "entry-number" }, `#${entry.number}`), ` ${entry.title}`);

  const age = formatAge(entry.lastActivity, now);
  const time = el("time", { class: "age", datetime: entry.lastActivity, title: `Last push, edit or review ${age.spoken}` }, age.short);

  link.append(rail, badge(entry), title, renderThreads(entry), time);
  item.append(link);
  return item;
}

function renderThreads(entry: StackEntry): HTMLElement {
  if (entry.totalThreads === 0) return el("span", { class: "threads" });
  const done = entry.resolvedThreads === entry.totalThreads;
  const label = `${entry.resolvedThreads} of ${entry.totalThreads} conversations resolved`;
  const threads = el("span", { class: done ? "threads done" : "threads open", title: label });
  threads.append(icon("comment"), el("span", { "aria-hidden": "true" }, `${entry.resolvedThreads}/${entry.totalThreads}`));
  threads.append(el("span", { class: "visually-hidden" }, label));
  return threads;
}

/**
 * @param entry The layer.
 * @returns Its colored status badge, with the detail as a tooltip.
 */
export function badge(entry: Pick<StackEntry, "tone" | "label" | "detail">): HTMLElement {
  const element = el("span", { class: "state", "data-stack-tone": entry.tone }, entry.label);
  if (entry.detail) {
    element.title = entry.detail;
    element.append(el("span", { class: "visually-hidden" }, `. ${entry.detail}`));
  }
  return element;
}
