import { formatAge } from "../core/age";
import { BAR_STYLES } from "./bar-styles";
import type { HighlightStatus } from "./diff-highlights";
import { button, el, icon, iconButton } from "./dom";
import type { DismissedVerdict, Reviewer, ReviewerStatus } from "../core/reviewers";
import type { StackView } from "../core/stack";
import { describePosition, renderStackSection, renderStrip } from "./stack-view";
import type { DiscussionItem } from "../core/discussion";
import { renderDiscussionControls, renderDiscussionList } from "./discussion-view";
import { dismissedName, POKE_COOLDOWN_MS, reviewerLook, standingVerdict } from "./reviewer-look";
import { Tooltip } from "./tooltip";
import { isMac, shortcutHelp } from "../core/shortcuts";
import { renderShortcutList } from "./shortcut-list";

export type BarState =
  | { kind: "loading" }
  | { kind: "setup"; message: string }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      /** Null while only a cached stack from another layer is shown. */
      reviewers: Reviewer[] | null;
      stack: StackView;
      stackCollapsed: boolean;
      showMerged: boolean;
      now: number;
      refreshing: boolean;
      busy: ReadonlySet<string>;
      /** When the viewer last poked each reviewer of this pull request, by reviewer key. */
      pokedAt: ReadonlyMap<string, number>;
      notice: string | null;
      /** How often the head branch was force-pushed, and when last. */
      forcePushes: { count: number; lastAt: string | null };
      /** What the Files changed diff highlights, or null when the viewer has not reviewed an older version. */
      highlight: HighlightStatus | null;
      /** Review texts and general comments, newest first; null while only a cached stack from another layer is shown. */
      discussion: DiscussionItem[] | null;
      /** When the viewer last looked at this pull request, or null to mark nothing as new. */
      discussionSeenAt: string | null;
      /** When the viewer last reviewed it, the fallback for a first visit. */
      discussionLastReview: string | null;
      discussionExpanded: boolean;
      showBots: boolean;
      viewer: string;
      /** Whether the versions view stands in for GitHub's diff in Files changed. */
      versionsOpen: boolean;
    };

/** What Files changed shows: GitHub's diff, the same with what changed since the viewer's review highlighted, or the versions view. */
export type DiffMode = "github" | "since" | "versions";

export interface BarActions {
  refresh: () => void;
  rerequest: (reviewer: Reviewer) => void;
  poke: (reviewer: Reviewer) => void;
  /** Asks for the reason and dismisses the reviewer's standing approval or change request. */
  dismiss: (reviewer: Reviewer, verdict: DismissedVerdict) => void;
  openOptions: () => void;
  toggleStack: () => void;
  toggleMerged: () => void;
  toggleMinimized: () => void;
  /** Switches what Files changed shows, opening it for the versions view. */
  chooseDiff: (mode: DiffMode) => void;
  toggleDiscussion: () => void;
  toggleDiscussionBots: () => void;
}

const MAX_FACES = 6;

/** A reviewer summary rendered into its own shadow root, either inline in the header or floating. */
export class ReviewBar {
  readonly host: HTMLElement;
  private readonly shadow: ShadowRoot;
  private readonly root: HTMLElement;
  private state: BarState = { kind: "loading" };
  private expanded = false;
  /** Whether the list of files the pull request no longer changes is open, kept across re-renders. */
  private droppedOpen = false;
  private entering = false;
  private minimized = false;
  private readonly tooltip = new Tooltip();
  /** Whether the toolbar's list of shortcuts is open, kept across re-renders. */
  private shortcutsOpen = false;

  constructor(
    private readonly mode: "inline" | "floating",
    private readonly actions: BarActions,
  ) {
    this.host = document.createElement("flohub-bar");
    this.host.dataset.mode = mode;
    this.shadow = this.host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = BAR_STYLES;
    this.root = document.createElement("div");
    this.root.setAttribute("role", "region");
    this.root.setAttribute("aria-label", "Reviewers");
    this.shadow.append(style, this.root, this.tooltip.element);
    this.tooltip.watch(this.shadow);
    this.shadow.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key !== "Escape" || !this.shortcutsOpen) return;
      event.stopPropagation();
      this.showShortcuts(false);
    });
    document.addEventListener("pointerdown", (event) => {
      if (this.shortcutsOpen && event.composedPath().every((target) => !(target instanceof Element) || !target.classList.contains("shortcuts"))) {
        this.showShortcuts(false);
      }
    });
    if (mode !== "floating") return;
    this.shadow.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key === "Escape" && this.expanded) this.toggle(false);
    });
    document.addEventListener("pointerdown", (event) => {
      if (this.expanded && !event.composedPath().includes(this.host)) this.toggle(false);
    });
  }

  /** @param state What to show. */
  render(state: BarState): void {
    this.state = state;
    const focusKey = (this.shadow.activeElement as HTMLElement | null)?.dataset.focusKey;
    this.tooltip.hide();
    this.root.replaceChildren(this.mode === "inline" ? this.renderFull() : this.renderFloating());
    this.entering = false;
    if (focusKey) this.shadow.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus();
  }

  /** @param hidden Whether to take the bar out of the page. */
  setHidden(hidden: boolean): void {
    this.host.hidden = hidden;
    if (hidden && this.expanded) this.toggle(false);
  }

  /**
   * Shrinks the floating bar to a tab at the window's left edge, so it stops covering the page beneath it.
   * @param minimized Whether to show only the tab.
   */
  setMinimized(minimized: boolean): void {
    if (minimized === this.minimized) return;
    const hadFocus = this.shadow.activeElement !== null;
    this.minimized = minimized;
    this.expanded = false;
    this.host.toggleAttribute("data-minimized", minimized);
    this.render(this.state);
    if (hadFocus) this.shadow.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(minimized ? "restore" : "pill")}"]`)?.focus();
  }

  private toggle(expanded: boolean): void {
    this.expanded = expanded;
    this.entering = expanded;
    this.render(this.state);
  }

  private renderFull(): HTMLElement {
    const overview = el("div", { class: "overview" });
    const layout = el("div", { class: "layout" });
    overview.append(layout);
    const { state } = this;
    const collapsed = state.kind === "ready" && this.mode === "inline" && state.stackCollapsed;
    if (state.kind === "ready") {
      const stack = renderStackSection(state.stack, {
        collapsed,
        showMerged: state.showMerged,
        now: state.now,
        toggleCollapsed: () => this.actions.toggleStack(),
        toggleMerged: () => this.actions.toggleMerged(),
      });
      stack.classList.add("area-stack");
      layout.append(stack);
    }
    layout.append(this.renderReviewers(collapsed));
    if (state.kind !== "ready") return overview;

    const discussion = state.discussion
      ? {
          items: state.discussion,
          seenAt: state.discussionSeenAt,
          viewer: state.viewer,
          expanded: state.discussionExpanded,
          showBots: state.showBots,
          now: state.now,
          toggleExpanded: () => this.actions.toggleDiscussion(),
          toggleBots: () => this.actions.toggleDiscussionBots(),
        }
      : null;
    const toolbar = el("div", { class: "toolbar area-tools", role: "toolbar", "aria-label": "Pull request" });
    if (state.forcePushes.count > 0 || state.highlight) toolbar.append(...this.renderDiff(state));
    const talk = discussion ? renderDiscussionControls(discussion) : [];
    const group = el("div", { class: "tool-group end" });
    group.append(...talk, this.renderShortcuts());
    toolbar.append(group);
    layout.append(toolbar);
    const list = discussion ? renderDiscussionList(discussion) : null;
    if (list) {
      list.classList.add("area-discussion");
      layout.append(list);
    }
    return overview;
  }

  /**
   * The switch for what Files changed shows, the force-pushes, and the files the highlighting leaves out.
   * @param state The bar's state.
   * @returns The toolbar's diff controls.
   */
  private renderDiff(state: Extract<BarState, { kind: "ready" }>): HTMLElement[] {
    const { highlight } = state;
    const mode = diffMode(state);
    const group = el("div", { class: "segmented", role: "group", "aria-label": "What Files changed shows" });
    const segment = (value: DiffMode, label: string, tip: string, glyph: Parameters<typeof icon>[0], count?: string) => {
      const option = el("button", {
        type: "button",
        class: "segment-option",
        "aria-pressed": String(mode === value),
        "data-tip": tip,
        "data-focus-key": `diff:${value}`,
      });
      option.append(icon(glyph), el("span", {}, label));
      if (count !== undefined) option.append(el("span", { class: "tool-count" }, count));
      option.addEventListener("click", () => {
        if (mode !== value) this.actions.chooseDiff(value);
      });
      group.append(option);
    };
    segment("github", "GitHub's diff", "GitHub's own diff of the pull request, without FloHub's highlights", "file");
    if (highlight) {
      const since = `v${highlight.since.number}`;
      const files = highlight.changedFiles === 1 ? "1 file" : `${highlight.changedFiles} files`;
      const tip =
        highlight.changedFiles === 0 && highlight.droppedFiles.length === 0
          ? `Nothing changed since your review (${since})`
          : `${files} changed since your review (${since}), highlighted in GitHub's diff`;
      segment("since", `Since ${since}`, tip, "highlight", String(highlight.changedFiles));
    }
    segment("versions", "Versions", "Compare any two versions of the pull request, in place of GitHub's diff", "compare");
    const controls: HTMLElement[] = [group];

    const { count, lastAt } = state.forcePushes;
    if (count > 0) {
      const times = count === 1 ? "once" : `${count} times`;
      const when = lastAt ? formatAge(lastAt, state.now) : null;
      const tip = `Force-pushed ${times}${when ? `${count > 1 ? ", last" : ""} ${when.spoken}` : ""}`;
      const pushes = el("span", { class: "tool static", "data-tip": tip, "aria-label": tip, role: "img" });
      pushes.append(icon("push"), el("span", { "aria-hidden": "true" }, `Force-pushed ${count === 1 ? "once" : `${count}×`}`));
      controls.push(pushes);
    }
    if (highlight && !highlight.hidden && highlight.truncated) {
      const tip = "GitHub lists at most 300 files, so files past that weren't compared";
      const warning = el("span", { class: "tool static warning", "data-tip": tip, "aria-label": tip, role: "img" });
      warning.append(icon("warning"), el("span", { "aria-hidden": "true" }, "300+ files"));
      controls.push(warning);
    }
    if (highlight && !highlight.hidden && highlight.droppedFiles.length > 0) {
      const dropped = highlight.droppedFiles.length;
      const details = el("details", { class: "dropped" });
      details.open = this.droppedOpen;
      details.addEventListener("toggle", () => (this.droppedOpen = details.open));
      const list = el("ul");
      for (const path of highlight.droppedFiles) list.append(el("li", {}, path));
      const summary = el("summary", { class: "tool", "data-focus-key": "dropped-files" });
      summary.append(icon("file"), `${dropped} no longer changed`);
      summary.setAttribute("aria-label", `${dropped} ${dropped === 1 ? "file is" : "files are"} no longer changed`);
      details.append(summary, list);
      controls.push(details);
    }
    return controls;
  }

  /** @returns The keyboard button, and the list of shortcuts it opens under it. */
  private renderShortcuts(): HTMLElement {
    const wrapper = el("div", { class: "shortcuts" });
    const toggle = el("button", {
      type: "button",
      class: "tool icon-only",
      "aria-expanded": String(this.shortcutsOpen),
      "aria-label": "Keyboard shortcuts",
      "data-tip": "Keyboard shortcuts",
      "data-focus-key": "shortcuts",
    });
    toggle.append(icon("keyboard"));
    toggle.addEventListener("click", () => this.showShortcuts(!this.shortcutsOpen));
    wrapper.append(toggle);
    if (this.shortcutsOpen) {
      const panel = el("div", { class: "shortcuts-panel", role: "dialog", "aria-label": "Keyboard shortcuts" });
      const shortcuts = shortcutHelp(isMac(navigator.platform));
      panel.append(el("p", { class: "label" }, "Keyboard shortcuts"), renderShortcutList(shortcuts));
      wrapper.append(panel);
    }
    return wrapper;
  }

  private showShortcuts(open: boolean): void {
    this.shortcutsOpen = open;
    this.render(this.state);
    if (!open) this.shadow.querySelector<HTMLElement>('[data-focus-key="shortcuts"]')?.focus();
  }

  private renderReviewers(compact: boolean): HTMLElement {
    const section = el("section", { class: "reviewers area-reviewers", "aria-label": "Reviewers" });
    const header = el("div", { class: "reviewers-header" });
    header.append(el("span", { class: "label" }, "Reviewers"));
    section.append(header);
    const { state } = this;
    if (state.kind === "ready") {
      const refresh = iconButton("refresh", "Refresh reviewers", () => this.actions.refresh(), "refresh");
      refresh.classList.add("refresh");
      if (state.refreshing) {
        refresh.classList.add("spinning");
        refresh.setAttribute("aria-busy", "true");
      }
      header.append(tipped(refresh));
    }

    if (state.kind === "loading" || (state.kind === "ready" && state.reviewers === null)) {
      section.append(el("p", { class: "message", role: "status" }, "Loading reviewers…"));
      return section;
    }
    if (state.kind === "setup" || state.kind === "error") {
      const action =
        state.kind === "setup"
          ? button("text-button", "Set up token", () => this.actions.openOptions(), "setup")
          : button("text-button", "Retry", () => this.actions.refresh(), "retry");
      const message = el("p", { class: "message", role: "status" }, state.message);
      message.append(" ", action);
      section.append(message);
      return section;
    }

    const reviewers = state.reviewers ?? [];
    if (reviewers.length === 0) {
      section.append(el("p", { class: "message" }, "No reviews or review requests yet."));
    } else if (compact) {
      const faces = el("ul", { class: "faces" });
      for (const reviewer of reviewers) {
        const look = reviewerLook(reviewer, state.now, state.pokedAt.get(reviewer.key));
        const item = el("li", { "data-tip": `${reviewer.name}: ${look.detail}` });
        item.append(face(reviewer, look), el("span", { class: "visually-hidden" }, `${reviewer.name}: ${look.label}. ${look.detail}`));
        faces.append(item);
      }
      section.append(faces);
    } else {
      const list = el("ul", { class: "reviewer-list" });
      for (const reviewer of reviewers) {
        list.append(this.renderReviewer(reviewer, state.busy.has(reviewer.key), state.pokedAt.get(reviewer.key), state.now));
      }
      section.append(list);
    }

    section.append(el("p", { class: "notice", role: "alert" }, state.notice ?? ""));
    return section;
  }

  private renderReviewer(reviewer: Reviewer, busy: boolean, pokedAt: number | undefined, now: number): HTMLElement {
    const look = reviewerLook(reviewer, now, pokedAt);
    const row = el("li", {
      class: busy ? "reviewer busy" : "reviewer",
      "data-ring": look.ring,
      "data-tip": `${reviewer.name}: ${look.detail}`,
    });
    if (look.waiting) row.dataset.waiting = "";
    row.append(
      avatar(reviewer),
      el(
        "a",
        { class: "name", href: reviewer.url, target: "_top", "data-focus-key": `reviewer:${reviewer.key}` },
        reviewer.name,
      ),
      el("span", { class: "visually-hidden" }, `: ${look.label}. ${look.detail}`),
    );
    if (reviewer.kind === "bot") row.append(icon("bot", "kind"));

    const actions = el("span", { class: "actions" });
    if (reviewer.canRerequest) {
      const rerequest = iconButton("sync", `Re-request review from ${reviewer.name}`, () => this.actions.rerequest(reviewer), `rerequest:${reviewer.key}`);
      if (busy) {
        rerequest.disabled = true;
        rerequest.classList.add("spinning");
        rerequest.setAttribute("aria-busy", "true");
      }
      actions.append(tipped(rerequest));
    }
    const recentlyPoked = reviewer.canPoke && pokedAt !== undefined && now - pokedAt < POKE_COOLDOWN_MS;
    if (reviewer.canPoke && !recentlyPoked) {
      const poke = iconButton("pointer", `Poke ${reviewer.name}: send them a new review request notification`, () => this.actions.poke(reviewer), `poke:${reviewer.key}`);
      if (busy) {
        poke.disabled = true;
        poke.setAttribute("aria-busy", "true");
      }
      actions.append(tipped(poke));
    }
    const standing = standingVerdict(reviewer);
    if (standing) {
      const dismiss = iconButton("cross", `Dismiss ${reviewer.name}'s ${dismissedName(standing)}`, () => this.actions.dismiss(reviewer, standing), `dismiss:${reviewer.key}`);
      dismiss.classList.add("dismiss");
      actions.append(tipped(dismiss));
    }
    if (actions.childElementCount > 0) row.append(actions);

    const state = el("span", { class: "reviewer-state", "aria-hidden": "true" });
    if (recentlyPoked) state.append(icon("pointer", "poked"));
    const glyph = icon(look.glyph, "glyph");
    glyph.dataset.tone = look.tone;
    state.append(glyph);
    row.append(state);
    return row;
  }

  private renderFloating(): HTMLElement {
    if (this.minimized) {
      const tab = iconButton("chevron", "Show FloHub", () => this.actions.toggleMinimized(), "restore");
      tab.className = "tab";
      return tab;
    }

    const wrapper = el("div", { class: "dock" });
    const pill = el("button", {
      type: "button",
      class: "pill",
      "aria-expanded": String(this.expanded),
      "data-focus-key": "pill",
    });
    pill.addEventListener("click", () => this.toggle(!this.expanded));
    pill.append(...this.renderPillContent(), icon("chevron", "chevron"));
    const minimize = iconButton("chevron", "Minimize FloHub to the window edge", () => this.actions.toggleMinimized(), "minimize");
    minimize.classList.add("minimize");
    wrapper.append(pill, minimize);

    if (this.expanded) {
      const panel = el("div", { class: this.entering ? "panel entering" : "panel" });
      panel.append(this.renderFull());
      wrapper.append(panel);
    }
    return wrapper;
  }

  private renderPillContent(): Node[] {
    const { state } = this;
    if (state.kind !== "ready") {
      const text = state.kind === "loading" ? "Reviewers…" : "Reviewers";
      return [icon("people"), el("span", { class: "summary" }, text)];
    }
    const stack = renderPillStack(state.stack);
    if (state.reviewers === null) return [...stack, icon("people"), el("span", { class: "summary" }, "Reviewers…")];
    if (state.reviewers.length === 0) {
      return [...stack, icon("people"), el("span", { class: "summary" }, "No reviewers")];
    }

    const faces = el("span", { class: "faces", "aria-hidden": "true" });
    const looked = state.reviewers.map((reviewer) => ({ reviewer, look: reviewerLook(reviewer, state.now, state.pokedAt.get(reviewer.key)) }));
    for (const { reviewer, look } of looked.slice(0, MAX_FACES)) faces.append(face(reviewer, look));
    const hidden = state.reviewers.length - MAX_FACES;
    if (hidden > 0) faces.append(el("span", { class: "more" }, `+${hidden}`));

    const description = looked.map(({ reviewer, look }) => `${reviewer.name}: ${look.label.toLowerCase()}`).join(", ");
    return [
      ...stack,
      faces,
      el("span", { class: "summary" }, summarize(state.reviewers)),
      el("span", { class: "visually-hidden" }, `. ${description}`),
    ];
  }
}

/**
 * @param state The bar's state.
 * @returns What Files changed shows now.
 */
function diffMode(state: Pick<Extract<BarState, { kind: "ready" }>, "versionsOpen" | "highlight">): DiffMode {
  if (state.versionsOpen) return "versions";
  return state.highlight && !state.highlight.hidden ? "since" : "github";
}

/**
 * A reviewer's avatar with their state as a small badge, ringed and dashed like their row.
 * @param reviewer The reviewer.
 * @param look Their state.
 * @returns The face.
 */
function face(reviewer: Reviewer, look: ReturnType<typeof reviewerLook>): HTMLElement {
  const element = el("span", { class: "face" });
  const badge = el("span", { class: "badge", "data-ring": look.ring });
  if (look.waiting) badge.dataset.waiting = "";
  const glyph = icon(look.glyph);
  glyph.dataset.tone = look.tone;
  badge.append(glyph);
  element.append(avatar(reviewer), badge);
  return element;
}

/**
 * Moves a button's native tooltip to the bar's own, which shows at once and on keyboard focus.
 * @param element The button, named by its aria-label.
 * @returns The same button.
 */
function tipped<T extends HTMLElement>(element: T): T {
  const label = element.getAttribute("title");
  if (label) {
    element.dataset.tip = label;
    element.removeAttribute("title");
  }
  return element;
}


function renderPillStack(view: StackView): Node[] {
  const current = view.entries.find((entry) => entry.current);
  const position = view.number === null ? (current?.label ?? "") : `${view.currentPosition}/${view.size}`;
  const spoken = `${describePosition(view)}${current ? `, ${current.label}` : ""}. `;
  return [
    renderStrip(view),
    el("span", { class: "summary", "aria-hidden": "true" }, position),
    el("span", { class: "visually-hidden" }, spoken),
    el("span", { class: "divider", "aria-hidden": "true" }),
  ];
}

function summarize(reviewers: Reviewer[]): string {
  const count = (status: ReviewerStatus) => reviewers.filter((reviewer) => reviewer.status === status).length;
  const parts = [
    [count("changes_requested"), "requested changes"],
    [count("pending") + count("rerequested"), "waiting"],
    [count("approved"), "approved"],
  ] as const;
  const text = parts.filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`);
  return text.length > 0 ? text.join(" · ") : "Reviewers";
}

function avatar(reviewer: Reviewer): HTMLElement {
  const className = reviewer.kind === "team" ? "avatar team" : "avatar";
  if (!reviewer.avatarUrl) {
    const placeholder = el("span", { class: `${className} placeholder` });
    placeholder.append(icon("people"));
    return placeholder;
  }
  return el("img", { class: className, src: avatarUrl(reviewer.avatarUrl), alt: "", width: "20", height: "20" });
}

function avatarUrl(url: string): string {
  const sized = new URL(url);
  sized.searchParams.set("s", "48");
  return sized.href;
}
