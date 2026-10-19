import { BAR_STYLES } from "../ui/bar-styles";
import type { RawStack, RawStackPull } from "../core/stack";
import popupCss from "../styles/popup.css?inline";

/**
 * GitHub's Primer tokens the bar reads. On github.com the page defines them, and they reach into the shadow root.
 * Storybook sets one theme's map on the frame, so a story renders in the theme the toolbar picked whatever the
 * machine's own color scheme is.
 */
export const PRIMER_LIGHT: Record<string, string> = {
  "--fgColor-default": "#1f2328",
  "--fgColor-muted": "#59636e",
  "--bgColor-default": "#ffffff",
  "--bgColor-muted": "#f6f8fa",
  "--borderColor-default": "#d1d9e0",
  "--fgColor-success": "#1a7f37",
  "--fgColor-danger": "#d1242f",
  "--fgColor-attention": "#9a6700",
  "--fgColor-accent": "#0969da",
  "--fgColor-done": "#8250df",
  "--focus-outlineColor": "#0969da",
  "--bgColor-success-muted": "#dafbe1",
  "--bgColor-attention-muted": "#fff8c5",
  "--bgColor-accent-muted": "#ddf4ff",
  "--bgColor-danger-muted": "#ffebe9",
  "--bgColor-done-muted": "#fbefff",
  "--bgColor-neutral-muted": "rgba(175, 184, 193, 0.2)",
  "--borderColor-success-muted": "rgba(74, 194, 107, 0.4)",
  "--borderColor-attention-muted": "rgba(212, 167, 44, 0.4)",
  "--borderColor-accent-muted": "rgba(84, 174, 255, 0.4)",
  "--borderColor-danger-muted": "rgba(255, 129, 130, 0.4)",
  "--borderColor-done-muted": "rgba(194, 151, 255, 0.4)",
  "--borderColor-neutral-muted": "rgba(175, 184, 193, 0.4)",
  "--diffBlob-additionLine-bgColor": "#dafbe1",
  "--diffBlob-additionNum-bgColor": "#d1f8d9",
  "--diffBlob-deletionLine-bgColor": "#ffebe9",
  "--diffBlob-deletionNum-bgColor": "#ffcecb",
  "--diffBlob-hunkLine-bgColor": "#ddf4ff",
  "--diffBlob-hunkNum-bgColor-rest": "#b6e3ff",
};

/** The same tokens with GitHub's dark values. */
export const PRIMER_DARK: Record<string, string> = {
  "--fgColor-default": "#f0f6fc",
  "--fgColor-muted": "#9198a1",
  "--bgColor-default": "#0d1117",
  "--bgColor-muted": "#151b23",
  "--borderColor-default": "#3d444d",
  "--fgColor-success": "#3fb950",
  "--fgColor-danger": "#f85149",
  "--fgColor-attention": "#d29922",
  "--fgColor-accent": "#4493f8",
  "--fgColor-done": "#ab7df8",
  "--focus-outlineColor": "#1f6feb",
  "--bgColor-success-muted": "rgba(46, 160, 67, 0.15)",
  "--bgColor-attention-muted": "rgba(187, 128, 9, 0.15)",
  "--bgColor-accent-muted": "rgba(56, 139, 253, 0.1)",
  "--bgColor-danger-muted": "rgba(248, 81, 73, 0.1)",
  "--bgColor-done-muted": "rgba(171, 125, 248, 0.15)",
  "--bgColor-neutral-muted": "rgba(101, 108, 118, 0.2)",
  "--borderColor-success-muted": "rgba(46, 160, 67, 0.4)",
  "--borderColor-attention-muted": "rgba(187, 128, 9, 0.4)",
  "--borderColor-accent-muted": "rgba(56, 139, 253, 0.4)",
  "--borderColor-danger-muted": "rgba(248, 81, 73, 0.4)",
  "--borderColor-done-muted": "rgba(171, 125, 248, 0.4)",
  "--borderColor-neutral-muted": "rgba(61, 68, 77, 0.7)",
  "--diffBlob-additionLine-bgColor": "rgba(46, 160, 67, 0.15)",
  "--diffBlob-additionNum-bgColor": "rgba(63, 185, 80, 0.3)",
  "--diffBlob-deletionLine-bgColor": "rgba(248, 81, 73, 0.1)",
  "--diffBlob-deletionNum-bgColor": "rgba(248, 81, 73, 0.3)",
  "--diffBlob-hunkLine-bgColor": "rgba(56, 139, 253, 0.1)",
  "--diffBlob-hunkNum-bgColor-rest": "rgba(56, 139, 253, 0.4)",
};

/**
 * Mounts content in a shadow root with the bar's styles, as the extension does on GitHub.
 * @param content The rendered UI.
 * @returns The shadow host.
 */
export function inShadow(content: Node): HTMLElement {
  const host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = BAR_STYLES;
  const overview = document.createElement("div");
  overview.className = "overview";
  overview.append(content);
  shadow.append(style, overview);
  return host;
}

/**
 * Mounts content the way the popup page does: popup.css inside a shadow root of a 504px frame. The shadow keeps the
 * page's element styles (`body`, `main`, `ul`, …) from reaching the rest of Storybook.
 * @param content The rendered UI.
 * @returns The shadow host.
 */
export function inPopup(content: Node): HTMLElement {
  const host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `:host {\n  display: block;\n  max-height: 580px;\n  overflow: auto;\n}\n${popupCss}`;
  const page = document.createElement("div");
  page.className = "popup";
  page.append(content);
  shadow.append(style, page);
  return host;
}

const HOUR = 3_600_000;
/** A fixed clock, so ages in the stories never drift. */
export const NOW = Date.parse("2026-10-14T12:00:00Z");

/**
 * @param number The pull request number.
 * @param title Its title.
 * @param overrides Fields that set its status.
 * @param threads Resolved and total conversations.
 * @param pushedHoursAgo When it was last pushed.
 * @returns A pull request as the GraphQL query returns it.
 */
export function pull(
  number: number,
  title: string,
  overrides: Partial<RawStackPull> = {},
  threads: [resolved: number, total: number] = [0, 0],
  pushedHoursAgo = 30,
): RawStackPull {
  const [resolved, total] = threads;
  return {
    number,
    title,
    url: `https://github.com/octo-org/octo-repo/pull/${number}`,
    state: "OPEN",
    isDraft: false,
    isInMergeQueue: false,
    mergeable: "MERGEABLE",
    reviewDecision: "REVIEW_REQUIRED",
    createdAt: new Date(NOW - 200 * HOUR).toISOString(),
    lastEditedAt: null,
    mergedAt: null,
    statusCheckRollup: { state: "SUCCESS" },
    latestOpinionatedReviews: { nodes: [] },
    reviewThreads: { totalCount: total, nodes: Array.from({ length: total }, (_, index) => ({ isResolved: index < resolved })) },
    timelineItems: { nodes: [{ __typename: "HeadRefForcePushedEvent", createdAt: new Date(NOW - pushedHoursAgo * HOUR).toISOString() }] },
    ...overrides,
  };
}

/**
 * @param pulls The layers, base first.
 * @returns A stack of them on main.
 */
export function stack(pulls: RawStackPull[]): RawStack {
  return {
    number: 900,
    size: pulls.length,
    baseRefName: "main",
    entries: { nodes: pulls.map((pullRequest, index) => ({ position: index + 1, pullRequest })) },
  };
}
