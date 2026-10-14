import { formatAge } from "./age";
import { BAR_STYLES } from "./bar-styles";
import type { HighlightStatus } from "./diff-highlights";
import { button, el, icon, iconButton, type IconName } from "./dom";
import type { Reviewer, ReviewerStatus, Verdict } from "./reviewers";
import type { StackView } from "./stack";
import { describePosition, renderStackSection, renderStrip } from "./stack-view";
import type { DiscussionItem } from "./discussion";
import { renderDiscussionSection } from "./discussion-view";

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
    };

export interface BarActions {
  refresh(): void;
  rerequest(reviewer: Reviewer): void;
  poke(reviewer: Reviewer): void;
  openOptions(): void;
  toggleStack(): void;
  toggleMerged(): void;
  toggleMinimized(): void;
  compareVersions(): void;
  toggleHighlight(): void;
  toggleDiscussion(): void;
  toggleDiscussionBots(): void;
}

type Tone = "success" | "danger" | "attention" | "muted";

const STATUS: Record<ReviewerStatus, { label: string; tone: Tone; icon: IconName }> = {
  approved: { label: "Approved", tone: "success", icon: "check" },
  changes_requested: { label: "Changes requested", tone: "attention", icon: "cross" },
  dismissed: { label: "Dismissed", tone: "muted", icon: "slash" },
  commented: { label: "Commented", tone: "muted", icon: "comment" },
  pending: { label: "Review pending", tone: "attention", icon: "dot" },
  rerequested: { label: "Re-requested", tone: "attention", icon: "sync" },
};

const PREVIOUS: Record<Verdict, string> = {
  approved: "was approved",
  changes_requested: "had requested changes",
  dismissed: "was dismissed",
  commented: "had commented",
};

const MAX_FACES = 6;
const POKE_COOLDOWN_MS = 3_600_000;

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
    this.shadow.append(style, this.root);
    if (mode === "floating") {
      this.shadow.addEventListener("keydown", (event) => {
        if ((event as KeyboardEvent).key === "Escape" && this.expanded) this.toggle(false);
      });
      document.addEventListener("pointerdown", (event) => {
        if (this.expanded && !event.composedPath().includes(this.host)) this.toggle(false);
      });
    }
  }

  /** @param state What to show. */
  render(state: BarState): void {
    this.state = state;
    const focusKey = (this.shadow.activeElement as HTMLElement | null)?.dataset.focusKey;
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
    if (hadFocus) this.shadow.querySelector<HTMLElement>(`[data-focus-key="${minimized ? "restore" : "pill"}"]`)?.focus();
  }

  private toggle(expanded: boolean): void {
    this.expanded = expanded;
    this.entering = expanded;
    this.render(this.state);
  }

  private renderFull(): HTMLElement {
    const overview = el("div", { class: "overview" });
    const state = this.state;
    if (state.kind === "ready") {
      overview.append(
        renderStackSection(state.stack, {
          collapsed: this.mode === "inline" && state.stackCollapsed,
          showMerged: state.showMerged,
          now: state.now,
          toggleCollapsed: () => this.actions.toggleStack(),
          toggleMerged: () => this.actions.toggleMerged(),
        }),
      );
    }
    overview.append(this.renderReviewers());
    if (state.kind === "ready" && (state.forcePushes.count > 0 || state.highlight)) overview.append(this.renderVersions(state));
    if (state.kind === "ready" && state.discussion) {
      const discussion = renderDiscussionSection({
        items: state.discussion,
        seenAt: state.discussionSeenAt,
        viewer: state.viewer,
        expanded: state.discussionExpanded,
        showBots: state.showBots,
        now: state.now,
        toggleExpanded: () => this.actions.toggleDiscussion(),
        toggleBots: () => this.actions.toggleDiscussionBots(),
      });
      if (discussion) overview.append(discussion);
    }
    return overview;
  }

  private renderVersions(state: Extract<BarState, { kind: "ready" }>): HTMLElement {
    const { count, lastAt } = state.forcePushes;
    const times = count === 1 ? "once" : `${count} times`;
    const last = lastAt && count > 1 ? `, last ${formatAge(lastAt, state.now).spoken}` : lastAt ? ` ${formatAge(lastAt, state.now).spoken}` : "";
    const bar = el("div", { class: "bar" });
    bar.append(el("span", { class: "label" }, "Versions"));
    if (count > 0) bar.append(el("span", { class: "message" }, `Force-pushed ${times}${last}`));
    bar.append(button("text-button", "Compare versions", () => this.actions.compareVersions(), "compare-versions"));
    const highlight = state.highlight;
    if (highlight) {
      const files = highlight.changedFiles === 1 ? "1 file" : `${highlight.changedFiles} files`;
      const text = highlight.hidden
        ? `Highlights of what changed since your review (v${highlight.since.number}) are hidden`
        : highlight.changedFiles === 0 && highlight.droppedFiles.length === 0
          ? `Nothing changed since your review (v${highlight.since.number})`
          : `${files} changed since your review (v${highlight.since.number}), highlighted in Files changed`;
      bar.append(el("span", { class: "message" }, `· ${text}`));
      if (highlight.truncated && !highlight.hidden) {
        bar.append(el("span", { class: "message" }, "· GitHub lists at most 300 files, so files past that weren't compared"));
      }
      bar.append(
        button("text-button", highlight.hidden ? "Show" : "Hide", () => this.actions.toggleHighlight(), "toggle-highlight"),
      );
      if (highlight.droppedFiles.length > 0 && !highlight.hidden) {
        const dropped = highlight.droppedFiles.length;
        const details = el("details", { class: "dropped" });
        details.open = this.droppedOpen;
        details.addEventListener("toggle", () => (this.droppedOpen = details.open));
        const list = el("ul");
        for (const path of highlight.droppedFiles) list.append(el("li", {}, path));
        details.append(
          el("summary", { "data-focus-key": "dropped-files" }, `${dropped} ${dropped === 1 ? "file is" : "files are"} no longer changed`),
          list,
        );
        bar.append(details);
      }
    }
    return bar;
  }

  private renderReviewers(): HTMLElement {
    const bar = el("div", { class: "bar" });
    bar.append(el("span", { class: "label" }, "Reviewers"));
    const state = this.state;
    if (state.kind === "ready") {
      const refresh = iconButton("refresh", "Refresh reviewers", () => this.actions.refresh(), "refresh");
      refresh.classList.add("refresh");
      if (state.refreshing) {
        refresh.classList.add("spinning");
        refresh.setAttribute("aria-busy", "true");
      }
      bar.append(refresh);
    }

    if (state.kind === "loading" || (state.kind === "ready" && state.reviewers === null)) {
      bar.append(el("span", { class: "message", role: "status" }, "Loading reviewers…"));
      return bar;
    }
    if (state.kind === "setup" || state.kind === "error") {
      const action =
        state.kind === "setup"
          ? button("text-button", "Set up token", () => this.actions.openOptions(), "setup")
          : button("text-button", "Retry", () => this.actions.refresh(), "retry");
      bar.append(el("span", { class: "message", role: "status" }, state.message), action);
      return bar;
    }

    const reviewers = state.reviewers ?? [];
    if (reviewers.length === 0) {
      bar.append(el("span", { class: "message" }, "No reviews or review requests yet."));
    } else {
      const list = el("ul", { class: "chips" });
      for (const reviewer of reviewers) {
        list.append(this.renderChip(reviewer, state.busy.has(reviewer.key), state.pokedAt.get(reviewer.key), state.now));
      }
      bar.append(list);
    }

    bar.append(el("p", { class: "notice", role: "alert" }, state.notice ?? ""));
    return bar;
  }

  private renderChip(reviewer: Reviewer, busy: boolean, pokedAt: number | undefined, now: number): HTMLElement {
    const status = STATUS[reviewer.status];
    const chip = el("li", { class: "chip" });
    chip.append(
      avatar(reviewer),
      el(
        "a",
        { class: "name", href: reviewer.url, target: "_top", "data-focus-key": `reviewer:${reviewer.key}` },
        reviewer.name,
      ),
    );
    const label = el("span", { class: "status", "data-tone": status.tone });
    label.append(icon(status.icon), status.label);
    chip.append(label);
    if (reviewer.previous) chip.append(el("span", { class: "previous" }, `· ${PREVIOUS[reviewer.previous]}`));
    if (reviewer.canRerequest) {
      const rerequest = iconButton(
        "sync",
        `Re-request review from ${reviewer.name}`,
        () => this.actions.rerequest(reviewer),
        `rerequest:${reviewer.key}`,
      );
      if (busy) {
        rerequest.disabled = true;
        rerequest.classList.add("spinning");
        rerequest.setAttribute("aria-busy", "true");
      }
      chip.append(rerequest);
    }
    if (reviewer.canPoke && pokedAt !== undefined && now - pokedAt < POKE_COOLDOWN_MS) {
      const when = formatAge(new Date(pokedAt).toISOString(), now).spoken;
      chip.append(el("span", { class: "previous" }, `· poked ${when}`));
    } else if (reviewer.canPoke) {
      const poke = iconButton(
        "pointer",
        `Poke ${reviewer.name}: send them a new review request notification`,
        () => this.actions.poke(reviewer),
        `poke:${reviewer.key}`,
      );
      if (busy) {
        poke.disabled = true;
        poke.setAttribute("aria-busy", "true");
      }
      chip.append(poke);
    }
    return chip;
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
    const state = this.state;
    if (state.kind !== "ready") {
      const text = state.kind === "loading" ? "Reviewers…" : "Reviewers";
      return [icon("people"), el("span", { class: "summary" }, text)];
    }
    const stack = this.renderPillStack(state.stack);
    if (state.reviewers === null) return [...stack, icon("people"), el("span", { class: "summary" }, "Reviewers…")];
    if (state.reviewers.length === 0) {
      return [...stack, icon("people"), el("span", { class: "summary" }, "No reviewers")];
    }

    const faces = el("span", { class: "faces", "aria-hidden": "true" });
    for (const reviewer of state.reviewers.slice(0, MAX_FACES)) {
      const status = STATUS[reviewer.status];
      const face = el("span", { class: "face" });
      const badge = el("span", { class: "badge", "data-tone": status.tone });
      badge.append(icon(status.icon));
      face.append(avatar(reviewer), badge);
      faces.append(face);
    }
    const hidden = state.reviewers.length - MAX_FACES;
    if (hidden > 0) faces.append(el("span", { class: "more" }, `+${hidden}`));

    const description = state.reviewers
      .map((reviewer) => `${reviewer.name}: ${STATUS[reviewer.status].label.toLowerCase()}`)
      .join(", ");
    return [
      ...stack,
      faces,
      el("span", { class: "summary" }, summarize(state.reviewers)),
      el("span", { class: "visually-hidden" }, `. ${description}`),
    ];
  }

  private renderPillStack(view: StackView): Node[] {
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
  return sized.toString();
}
