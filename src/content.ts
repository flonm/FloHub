import { type BarState, ReviewBar } from "./ui/bar";
import { findInlineAnchor } from "./ui/anchor";
import { DiffHighlights, type HighlightStatus } from "./ui/diff-highlights";
import { Favicon, faviconUrl } from "./ui/favicon";
import { ViewedTree } from "./ui/file-tree";
import { send } from "./api/messages";
import { isWholeFilesTab, type PullRef, parsePullRef, pullKey, pullTab } from "./core/pull-ref";
import { ReviewDialog } from "./ui/review-dialog";
import { deriveDiscussion, lastReviewBy } from "./core/discussion";
import { deriveReviewers, type Reviewer } from "./core/reviewers";
import { type CopyTarget, createShortcutMatcher, type ReviewEvent } from "./core/shortcuts";
import type { Overview } from "./api/github";
import { readCachedOverview } from "./api/overview-cache";
import { deriveStack } from "./core/stack";
import { Toast } from "./ui/toast";
import {
  BASE,
  baseCandidates,
  formatRangeParam,
  keepRecentRanges,
  parseRangeParam,
  rangeParam,
  type SavedRange,
  type VersionHistory,
} from "./core/versions";
import { commentJump, type CommentJump, type CommentLink, type JumpTarget, parseCommentLink, storedVersionsWillDo } from "./core/comment-jump";
import { JumpMenu } from "./ui/jump-menu";
import { readCachedHistory } from "./api/version-cache";
import { VersionsView } from "./ui/versions-view";

const AUTO_REFRESH_GAP_MS = 15_000;
const STICKY_HEADER_HEIGHT = 96;
const ANCHOR_RETRY_MS = 1000;
const AGE_TICK_MS = 60_000;
const CACHE_WAIT_MS = 300;
const POKE_MEMORY_MS = 86_400_000;
const TEXT_FIELDS = "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox'], [role='combobox'], [role='searchbox']";

const SEEN_KEY = "discussionSeen";
const SEEN_MEMORY_MS = 60 * 86_400_000;
/** The range of versions the viewer last compared, by pull request. */
const RANGES_KEY = "versionRanges";
/** GitHub's comments panel beside the Files changed diff. */
const COMMENTS_PANEL = "#docked-side-panel-content";
/** The URL parameter that keeps the versions view open on the Files changed tab, with the range it compares. */
const VERSIONS_PARAM = "flohub-versions";

let current: PullRef | null = null;
let state: BarState = { kind: "loading" };
let lastLoad = 0;
let generation = 0;
let scheduled = false;
let lastAnchorSearch = 0;
let anchorRetry: ReturnType<typeof setTimeout> | undefined;
let stackCollapsed = false;
let showMerged = false;
let floatingMinimized = false;
let pendingNotice: string | null = null;
/** Whether a fresh overview arrived for this pull request; until then a ready state comes from the cache. */
let loadedFresh = false;
let viewerIsAuthor = false;
let claimedKey: string | null = null;
let pokes: Record<string, number> = {};
let highlight: HighlightStatus | null = null;
let discussionExpanded = false;
let showBots = false;
/**
 * The pull request whose Files changed tab shows the versions view in place of GitHub's diff. It outlasts GitHub's own
 * navigations, which drop the URL parameter that mirrors it.
 */
let versionsWanted: string | null = null;
/** The range the URL asked for, which the view opens on once. */
let versionsFromUrl: SavedRange | null = null;
/** The URL parameter's value for the range on screen. */
let versionsParam = "";
/** When the viewer last opened the pull request on screen before this visit, once read from storage. */
let visit: { key: string; previous: string | null } | null = null;
const busy = new Set<string>();
const dialog = new ReviewDialog();
const versionsView = new VersionsView();
const jumpMenu = new JumpMenu();
const toast = new Toast();
const favicon = new Favicon();
const matchShortcut = createShortcutMatcher();

const actions = {
  refresh: () => void load(true),
  rerequest: (reviewer: Reviewer) => void rerequest(reviewer),
  poke: (reviewer: Reviewer) => void poke(reviewer),
  openOptions: () => void send({ type: "open-options" }),
  toggleStack: () => {
    stackCollapsed = !stackCollapsed;
    void chrome.storage.local.set({ stackCollapsed });
    update({ stackCollapsed });
  },
  toggleMerged: () => {
    showMerged = !showMerged;
    update({ showMerged });
  },
  toggleMinimized: () => {
    floatingMinimized = !floatingMinimized;
    void chrome.storage.local.set({ floatingMinimized });
    floating.setMinimized(floatingMinimized);
  },
  compareVersions: () => compareVersions(),
  toggleDiscussion: () => {
    discussionExpanded = !discussionExpanded;
    update({ discussionExpanded });
  },
  toggleDiscussionBots: () => {
    showBots = !showBots;
    update({ showBots });
  },
  toggleHighlight: () => {
    if (highlight) highlights.setHidden(!highlight.hidden);
    schedule();
  },
};
const inline = new ReviewBar("inline", actions);
const floating = new ReviewBar("floating", actions);
const viewedTree = new ViewedTree(notify);
const highlights = new DiffHighlights((status) => {
  highlight = status;
  update({ highlight });
});

void restoreSettings();
setInterval(() => update({ now: Date.now() }), AGE_TICK_MS);

new IntersectionObserver(updateVisibility, { rootMargin: `-${STICKY_HEADER_HEIGHT}px 0px 0px 0px` }).observe(
  inline.host,
);

new MutationObserver(schedule).observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributeFilter: ["aria-pressed", "aria-checked"],
});
document.addEventListener("change", schedule, { capture: true });
document.addEventListener("click", schedule, { capture: true });
addEventListener("popstate", schedule);
document.addEventListener("turbo:load", schedule);
(globalThis as { navigation?: EventTarget }).navigation?.addEventListener("currententrychange", schedule);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void load(false);
});
addEventListener("focus", () => void load(false));
addEventListener("keydown", onKeydown, true);
document.addEventListener("click", onCommentLink, { capture: true });
addEventListener("keypress", swallowClaimedKey, true);
addEventListener("keyup", swallowClaimedKey, true);

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", sync, { once: true });
else sync();

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    sync();
  });
}

async function restoreSettings(): Promise<void> {
  const stored = await chrome.storage.local.get(["stackCollapsed", "floatingMinimized", "pokes"]);
  stackCollapsed = stored.stackCollapsed === true;
  floatingMinimized = stored.floatingMinimized === true;
  floating.setMinimized(floatingMinimized);
  pokes = (stored.pokes as Record<string, number> | undefined) ?? {};
  update({ stackCollapsed, ...(current && { pokedAt: pokedAtFor(current) }) });
}

function sync(): void {
  // The DOM types promise a body, but there is none while the page is still parsing.
  if (!(document.body as HTMLElement | null)) return;
  const ref = parsePullRef(location.href);
  if (!ref) {
    current = null;
    viewedTree.sync(null);
    highlights.sync(null);
    inline.host.remove();
    updateVisibility();
    favicon.set(null);
    return;
  }

  if (!current || pullKey(current) !== pullKey(ref)) {
    current = ref;
    state = { kind: "loading" };
    busy.clear();
    showMerged = false;
    pendingNotice = null;
    loadedFresh = false;
    viewedTree.sync(null);
    lastAnchorSearch = 0;
    discussionExpanded = false;
    showBots = false;
    visit = null;
    void startVisit(ref);
    void showFirst(ref);
    void load(true);
  }

  if (!floating.host.isConnected) document.body.append(floating.host);
  if (!inline.host.isConnected) mountInline(ref);
  viewedTree.sync(ref);
  highlights.sync(ref);
  syncVersions(ref);
  updateVisibility();
}

/** Shows the versions view on the Files changed tab while the viewer keeps it open, and nowhere else. */
function syncVersions(ref: PullRef): void {
  const key = pullKey(ref);
  const param = new URL(location.href).searchParams.get(VERSIONS_PARAM);
  if (param !== null && versionsWanted !== key) {
    versionsWanted = key;
    versionsFromUrl = parseRangeParam(param, Date.now());
    versionsParam = param;
  }
  if (versionsWanted !== key || !isWholeFilesTab(location.pathname)) {
    versionsView.close();
    return;
  }
  if (param === null) writeVersionsParam(versionsParam);
  if (versionsView.isOpen) versionsView.place();
  else openVersions(ref);
}

/** @param value The range to keep in the URL, or null to drop the parameter. */
function writeVersionsParam(value: string | null): void {
  const url = new URL(location.href);
  if (url.searchParams.get(VERSIONS_PARAM) === value) return;
  if (value === null) url.searchParams.delete(VERSIONS_PARAM);
  else url.searchParams.set(VERSIONS_PARAM, value);
  // GitHub's router keeps its own state in the history entry, so it stays.
  history.replaceState(history.state, "", url);
}

/**
 * Looks for the header to mount the inline bar in. Only failed searches wait {@link ANCHOR_RETRY_MS} for the next
 * one, so when GitHub re-renders the header and takes the bar with it, the bar is back on the next frame. A search
 * that is skipped runs once the wait is over, so the last change to a page that is still loading always gets a search.
 */
function mountInline(ref: PullRef): void {
  const wait = ANCHOR_RETRY_MS - (Date.now() - lastAnchorSearch);
  if (wait > 0) {
    anchorRetry ??= setTimeout(() => {
      anchorRetry = undefined;
      schedule();
    }, wait);
    return;
  }
  const anchor = findInlineAnchor(document, ref.number);
  lastAnchorSearch = anchor ? 0 : Date.now();
  anchor?.after(inline.host);
}

function updateVisibility(): void {
  const onPull = current !== null;
  inline.setHidden(!onPull);
  floating.setHidden(!onPull || isInlineInView());
}

function isInlineInView(): boolean {
  if (!inline.host.isConnected || inline.host.hidden !== false) return false;
  const rect = inline.host.getBoundingClientRect();
  return rect.height > 0 && rect.bottom > STICKY_HEADER_HEIGHT && rect.top < innerHeight;
}

function render(): void {
  inline.render(state);
  floating.render(state);
  const tone = state.kind === "ready" ? (state.stack.entries.find((entry) => entry.current)?.tone ?? null) : null;
  favicon.set(faviconUrl(tone));
}

/** @param message A notice to show in the bar, kept until the bar has loaded. */
function notify(message: string): void {
  if (state.kind !== "ready") {
    pendingNotice = message;
    return;
  }
  state = { ...state, notice: message };
  render();
}

function update(changes: Partial<Extract<BarState, { kind: "ready" }>>): void {
  if (state.kind !== "ready") return;
  state = { ...state, ...changes };
  render();
}

/**
 * Holds the loading state back until the cache answers, so a cached stack doesn't pop in after "Loading…".
 * The wait is capped, since a slow storage read must not delay the loading state for long.
 */
async function showFirst(ref: PullRef): Promise<void> {
  await Promise.race([showCached(ref), new Promise((resolve) => {
    setTimeout(resolve, CACHE_WAIT_MS);
  })]);
  if (state.kind === "loading" && current && pullKey(current) === pullKey(ref)) render();
}

/**
 * Shows the last overview fetched for this pull request, or the stack from another of its layers,
 * while the fresh one loads. It never replaces a state the fresh load already set.
 */
async function showCached(ref: PullRef): Promise<void> {
  const cached = await readCachedOverview(ref);
  if (!cached || state.kind !== "loading" || !current || pullKey(current) !== pullKey(ref)) return;
  const ready = readyState(cached.overview, ref, cached.exact);
  if (!ready) return;
  if (cached.exact) viewerIsAuthor = isAuthor(cached.overview);
  state = { ...ready, refreshing: true, notice: pendingNotice };
  render();
}

/**
 * @param overview An overview GitHub returned for this pull request or, when not exact, for another layer of its stack.
 * @param ref The pull request on screen.
 * @param exact Whether the overview is this pull request's own; otherwise only its stack is used.
 * @returns The bar state, or null when the overview does not cover the pull request.
 */
function readyState(overview: Overview, ref: PullRef, exact: boolean): Extract<BarState, { kind: "ready" }> | null {
  const pullRequest = overview.repository?.pullRequest;
  if (!pullRequest) return null;
  const lastReview = exact ? lastReviewBy(pullRequest, overview.viewer.login) : null;
  let stack;
  if (exact) {
    stack = deriveStack(pullRequest, pullRequest.baseRefName);
  } else {
    const sibling = pullRequest.stack?.entries.nodes.find((node) => node.pullRequest?.number === ref.number)?.pullRequest;
    if (!sibling || !pullRequest.stack) return null;
    stack = deriveStack({ ...sibling, stack: pullRequest.stack }, pullRequest.stack.baseRefName);
  }
  return {
    kind: "ready",
    reviewers: exact ? deriveReviewers(pullRequest, overview.viewer.login) : null,
    stack,
    stackCollapsed,
    showMerged,
    now: Date.now(),
    refreshing: false,
    busy,
    pokedAt: pokedAtFor(ref),
    forcePushes: {
      count: exact ? (pullRequest.forcePushes?.totalCount ?? 0) : 0,
      lastAt: exact ? (pullRequest.forcePushes?.nodes.at(-1)?.createdAt ?? null) : null,
    },
    highlight,
    notice: null,
    discussion: exact ? deriveDiscussion(pullRequest) : null,
    discussionSeenAt: seenAtFor(ref, lastReview),
    discussionLastReview: lastReview,
    discussionExpanded,
    showBots,
    viewer: overview.viewer.login,
  };
}

/** The visit's previous look, or the viewer's last review on a first visit; null until storage has answered. */
function seenAtFor(ref: PullRef, lastReview: string | null): string | null {
  if (visit?.key !== pullKey(ref)) return null;
  return visit.previous ?? lastReview;
}

/** Remembers that the viewer opened this pull request now, and what they last saw before, for the discussion's "new" marks. */
async function startVisit(ref: PullRef): Promise<void> {
  const key = pullKey(ref);
  const saved = await chrome.storage.local.get(SEEN_KEY);
  const stored = (saved[SEEN_KEY] as Record<string, string> | undefined) ?? {};
  if (current && pullKey(current) === key) {
    visit = { key, previous: stored[key] ?? null };
    if (state.kind === "ready") update({ discussionSeenAt: seenAtFor(ref, state.discussionLastReview) });
  }
  const now = Date.now();
  const kept = Object.fromEntries(Object.entries(stored).filter(([, at]) => now - Date.parse(at) < SEEN_MEMORY_MS));
  await chrome.storage.local.set({ [SEEN_KEY]: { ...kept, [key]: new Date(now).toISOString() } });
}

function isAuthor(overview: Overview): boolean {
  return overview.repository?.pullRequest?.author?.login === overview.viewer.login;
}

async function load(force: boolean): Promise<void> {
  const ref = current;
  if (!ref || (!force && Date.now() - lastLoad < AUTO_REFRESH_GAP_MS)) return;
  lastLoad = Date.now();
  const run = ++generation;
  viewedTree.refresh(ref);

  if (state.kind === "ready") {
    state = { ...state, refreshing: true };
    render();
  }

  const reply = await send({ type: "overview", ref });
  if (run !== generation || !current || pullKey(current) !== pullKey(ref)) return;

  if (reply.ok) {
    viewerIsAuthor = isAuthor(reply.value);
    const pullRequest = reply.value.repository?.pullRequest;
    if (pullRequest?.headRefOid && pullRequest.baseRefOid) {
      const viewer = reply.value.viewer.login;
      // A pending review is the viewer's unsubmitted draft, not a review of what they saw.
      const reviews = pullRequest.reviews.nodes.filter((review) => review.author?.login === viewer && review.state !== "PENDING");
      const reviewed = reviews.at(-1)?.commit?.oid ?? null;
      highlights.update(ref, { head: pullRequest.headRefOid, base: pullRequest.baseRefOid, reviewed });
    }
    const ready = readyState(reply.value, ref, true);
    loadedFresh = ready !== null;
    state = ready
      ? {
          ...ready,
          notice:
            reply.value.unreadable.length > 0
              ? `This token cannot read ${reply.value.unreadable.join(", ")}, so parts may be missing. Check its permissions.`
              : (state.kind === "ready" ? state.notice : pendingNotice),
        }
      : { kind: "error", message: "Pull request not found." };
  } else if (reply.code !== "failed") {
    state = { kind: "setup", message: reply.message };
  } else if (state.kind === "ready" && loadedFresh) {
    state = { ...state, refreshing: false, notice: reply.message };
  } else {
    state = { kind: "error", message: reply.message };
  }
  render();
}

async function rerequest(reviewer: Reviewer): Promise<void> {
  const ref = current;
  if (!ref || state.kind !== "ready") return;
  busy.add(reviewer.key);
  state = { ...state, notice: null };
  render();

  const reply = await send({ type: "rerequest", ref, login: reviewer.name });
  busy.delete(reviewer.key);
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- other handlers may change state during the await
  if (state.kind === "ready") {
    state = { ...state, notice: reply.ok ? null : `Could not re-request ${reviewer.name}: ${reply.message}` };
  }
  render();
  await load(true);
}

function onKeydown(event: KeyboardEvent): void {
  if (!current || dialog.isOpen) return;
  const { action, claim } = matchShortcut({
    key: event.key,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    repeat: event.repeat,
    editable: isTextField(event),
    time: event.timeStamp,
  });
  if (claim) {
    claimedKey = event.code;
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  if (!action) return;
  if (action.type === "navigate") navigateStack(action.direction);
  else if (action.type === "copy") void copyForPull(action.what);
  else if (action.withComment) openReview(action.event);
  else void approveNow();
}

async function copyForPull(what: CopyTarget): Promise<void> {
  const ref = current;
  if (!ref) return;
  const text =
    what === "checkout" ? `gh pr checkout ${ref.number}` : `https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}`;
  if (await copyText(text)) toast.show(`Copied ${text}`, "success");
  else toast.show(`Could not copy to the clipboard: ${text}`, "danger");
}

/** Copies through the Clipboard API, or through a hidden text field where that API is unavailable. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const field = Object.assign(document.createElement("textarea"), { value: text });
    field.setAttribute("aria-hidden", "true");
    field.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
    document.body.append(field);
    field.select();
    // oxlint-disable-next-line typescript/no-deprecated -- the fallback for pages where the Clipboard API is refused
    const copied = document.execCommand("copy");
    field.remove();
    return copied;
  }
}

/** Hides the rest of a key FloHub claimed from the page, whose own shortcuts may listen for keypress or keyup. */
function swallowClaimedKey(event: KeyboardEvent): void {
  if (event.code !== claimedKey) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.type === "keyup") claimedKey = null;
}

function isTextField(event: KeyboardEvent): boolean {
  const [target] = event.composedPath();
  if (!(target instanceof Element)) return false;
  return (target instanceof HTMLElement && target.isContentEditable) || Boolean(target.closest(TEXT_FIELDS));
}

function navigateStack(direction: 1 | -1): void {
  if (state.kind !== "ready") return;
  const position = state.stack.currentPosition + direction;
  const target = state.stack.entries.find((entry) => entry.position === position);
  if (!target) {
    toast.show(direction === 1 ? "Already at the top of the stack." : "Already at the bottom of the stack.", "info");
    return;
  }
  // The versions view is a setting of the page, so the next layer opens on it too, on its own range.
  const versions = versionsView.isOpen ? `?${VERSIONS_PARAM}=` : "";
  location.assign(`${target.url}${pullTab(location.pathname)}${versions}`);
}

async function approveNow(): Promise<void> {
  const ref = current;
  if (!ref || isOwnPull()) return;
  toast.show(`Approving #${ref.number}…`, "info");
  const failure = await submitReview(ref, "APPROVE", "");
  toast.show(failure ?? `Approved #${ref.number}.`, failure ? "danger" : "success");
}

function openReview(event: ReviewEvent): void {
  const ref = current;
  if (!ref || isOwnPull()) return;
  dialog.open({
    event,
    number: ref.number,
    pendingComments: pendingComments(ref),
    submit: async (body) => {
      const failure = await submitReview(ref, event, body);
      if (!failure) toast.show(event === "APPROVE" ? `Approved #${ref.number}.` : `Requested changes on #${ref.number}.`, "success");
      return failure;
    },
  });
}

async function pendingComments(ref: PullRef): Promise<number | null> {
  const reply = await send({ type: "pending-comments", ref });
  if (!reply.ok) throw new Error(reply.message);
  return reply.value;
}

async function submitReview(ref: PullRef, event: ReviewEvent, body: string): Promise<string | null> {
  const reply = await send({ type: "submit-review", ref, event, body });
  if (!reply.ok) return `Could not submit the review: ${reply.message}`;
  void load(true);
  return null;
}

/** Opens the versions view on the Files changed tab, or closes it when it's open. */
function compareVersions(): void {
  const ref = current;
  if (!ref) return;
  if (versionsView.isOpen) {
    closeVersions();
    return;
  }
  versionsWanted = pullKey(ref);
  if (isWholeFilesTab(location.pathname)) syncVersions(ref);
  else location.assign(`https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}/changes?${VERSIONS_PARAM}=${versionsParam}`);
}

/**
 * Takes over the links from a comment in GitHub's comments panel to its code. GitHub's own jump doesn't scroll while
 * the panel is open, and sends an outdated comment to the single-commit view (see docs/github-quirks.md); the menu
 * offers the versions view instead. The link alone says which comment it is: the panel draws a comment in more than
 * one shape, and not always around its links.
 * @param event A click anywhere on the page.
 */
function onCommentLink(event: MouseEvent): void {
  const ref = current;
  if (!ref || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const [target] = event.composedPath();
  if (!(target instanceof Element)) return;
  const link = target.closest<HTMLAnchorElement>("a[href]");
  // A link in a comment's text may point at another comment; only the comment's own links are its jump to the code.
  if (!link?.closest(COMMENTS_PANEL) || link.closest(".markdown-body")) return;
  const named = parseCommentLink(link.getAttribute("href") ?? "", location.href);
  if (!named) return;
  // The page's capture listeners sit below the document, so GitHub never sees the click.
  event.preventDefault();
  event.stopImmediatePropagation();
  void openJumpMenu(ref, link, named);
}

async function openJumpMenu(ref: PullRef, link: HTMLAnchorElement, named: CommentLink): Promise<void> {
  if (jumpMenu.openedFrom === link) {
    jumpMenu.close();
    return;
  }
  jumpMenu.open(link, { kind: "loading" });
  const fallback = () => location.assign(link.href);
  const [place, stored] = await Promise.all([send({ type: "review-comment", ref, link: named }), readCachedHistory(ref)]);
  if (jumpMenu.openedFrom !== link) return;
  if (!place.ok) {
    jumpMenu.open(link, { kind: "failed", message: place.message, fallback });
    return;
  }
  const comment = place.value;
  const history = storedVersionsWillDo(stored, comment.originalCommit) ? stored : await freshVersions(ref);
  if (jumpMenu.openedFrom !== link) return;
  if (typeof history === "string") {
    jumpMenu.open(link, { kind: "failed", message: history, fallback });
    return;
  }
  const jump = commentJump(history.versions, comment, Date.now());
  if (!jump) {
    jumpMenu.open(link, { kind: "failed", message: "FloHub knows no versions of this pull request.", fallback });
    return;
  }
  const name = `v${jump.version.number}`;
  const nearest = jump.exact
    ? undefined
    : `The comment was written on ${comment.originalCommit.slice(0, 7)}, which isn't a known version, so these show ${name}, the version current then.`;
  const choose = (show: () => void) => () => {
    if (nearest) toast.show(nearest, "info");
    show();
  };
  const { since } = jump;
  jumpMenu.open(link, {
    kind: "ready",
    choices: [
      {
        label: `Changes since ${name}`,
        detail: since ? `How the code changed from ${name}, where the comment was written, to the current version` : `${name}, where the comment was written, is the current version`,
        disabled: !since,
        run: choose(() => since && showInVersions(ref, since)),
      },
      { label: `Code at ${name}`, detail: `The pull request's changes as ${name} made them, as the comment saw them`, run: choose(() => showInVersions(ref, jump.at)) },
      {
        label: "In the current diff",
        detail: jump.current ? "Where the comment sits in the pull request's current changes" : "The comment is outdated: its lines are gone from the current diff",
        disabled: !jump.current,
        run: () => showCurrent(ref, named.kind === "comment" ? named.id : null, jump),
      },
    ],
    ...(nearest && { note: nearest }),
  });
}

/** @returns The pull request's versions as GitHub has them now, or why there are none. */
async function freshVersions(ref: PullRef): Promise<VersionHistory | string> {
  const reply = await send({ type: "versions", ref });
  return reply.ok ? reply.value : reply.message;
}

/** Opens the versions view on a range, and scrolls it to the commented line. */
function showInVersions(ref: PullRef, target: JumpTarget): void {
  versionsWanted = pullKey(ref);
  if (!isWholeFilesTab(location.pathname)) {
    location.assign(`https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}/changes?${VERSIONS_PARAM}=${rangeParam(target.range)}`);
    return;
  }
  if (!versionsView.isOpen) {
    versionsFromUrl = target.range;
    openVersions(ref);
  }
  versionsView.goTo(target.range, target.line);
}

/** Scrolls to the comment in the current diff: the versions view's, while it's open, or else GitHub's own. */
function showCurrent(ref: PullRef, id: number | null, jump: CommentJump): void {
  if (!jump.current) return;
  if (versionsView.isOpen) {
    showInVersions(ref, { range: { from: BASE, to: "", toCurrent: true, at: Date.now() }, line: jump.current });
    return;
  }
  // GitHub draws the thread in its diff too, under the comment's number.
  const thread = id === null ? null : document.getElementById(`r${id}`);
  if (thread) thread.scrollIntoView({ block: "center" });
  else toast.show(`GitHub hasn't drawn the comment in its diff yet. Scroll to ${jump.current.path} and it will.`, "info");
}

function closeVersions(): void {
  versionsWanted = null;
  versionsView.close();
  writeVersionsParam(null);
}

function openVersions(ref: PullRef): void {
  versionsView.open({
    key: pullKey(ref),
    number: ref.number,
    repoUrl: `https://github.com/${ref.owner}/${ref.repo}`,
    cachedVersions: async () => readCachedHistory(ref),
    versions: async () => {
      const reply = await send({ type: "versions", ref });
      if (!reply.ok) throw new Error(reply.message);
      return reply.value;
    },
    threads: async () => {
      const reply = await send({ type: "review-threads", ref });
      if (!reply.ok) throw new Error(reply.message);
      return reply.value;
    },
    patch: async (history, version) => {
      const reply = await send({ type: "version-patch", ref, head: version.oid, bases: baseCandidates(history, version) });
      if (!reply.ok) throw new Error(reply.message);
      return reply.value;
    },
    savedRange: async () => {
      const fromUrl = versionsFromUrl;
      versionsFromUrl = null;
      const ranges = await readSavedRanges();
      return fromUrl ?? ranges[pullKey(ref)] ?? null;
    },
    saveRange: (range) => void saveRange(pullKey(ref), range),
    onShow: (older, newer) => {
      versionsParam = formatRangeParam(older, newer);
      if (versionsView.isOpen) writeVersionsParam(versionsParam);
    },
    onClose: closeVersions,
  });
}

async function readSavedRanges(): Promise<Record<string, SavedRange>> {
  try {
    const stored = await chrome.storage.local.get(RANGES_KEY);
    return (stored[RANGES_KEY] as Record<string, SavedRange> | undefined) ?? {};
  } catch {
    return {};
  }
}

async function saveRange(key: string, range: SavedRange): Promise<void> {
  const ranges = { ...(await readSavedRanges()), [key]: range };
  try {
    await chrome.storage.local.set({ [RANGES_KEY]: keepRecentRanges(ranges, range.at) });
  } catch {
    // The next visit opens on the default range instead.
  }
}

function isOwnPull(): boolean {
  if (!viewerIsAuthor) return false;
  toast.show("GitHub doesn't let you review your own pull request.", "info");
  return true;
}

/** @returns When the viewer last poked each reviewer of a pull request, by reviewer key. */
function pokedAtFor(ref: PullRef): Map<string, number> {
  const prefix = `${pullKey(ref)}|`;
  return new Map(
    Object.entries(pokes)
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, at]) => [key.slice(prefix.length), at]),
  );
}

async function poke(reviewer: Reviewer): Promise<void> {
  const ref = current;
  if (!ref || state.kind !== "ready" || reviewer.kind === "bot" || busy.has(reviewer.key)) return;
  busy.add(reviewer.key);
  render();

  const reply = await send({ type: "poke", ref, reviewer: { kind: reviewer.kind, name: reviewer.name } });
  busy.delete(reviewer.key);
  if (reply.ok) {
    const now = Date.now();
    pokes = Object.fromEntries([
      ...Object.entries(pokes).filter(([, at]) => now - at < POKE_MEMORY_MS),
      [`${pullKey(ref)}|${reviewer.key}`, now],
    ]);
    void chrome.storage.local.set({ pokes });
    toast.show(`Poked ${reviewer.name}. GitHub notifies them within a minute.`, "success");
  } else {
    toast.show(reply.message, "danger");
  }
  if (current && pullKey(current) === pullKey(ref)) update({ pokedAt: pokedAtFor(ref) });
  await load(true);
}
