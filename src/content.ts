import { type BarState, type DiffMode, PULL_STATE_BUSY, ReviewBar } from "./ui/bar";
import { moveDone, moveFor, MOVE_WORDS, noMoveReason, type PullMove, pullStateOf, type StateIntent, stateAfter } from "./core/pull-state";
import { findInlineAnchor } from "./ui/anchor";
import { POKE_COOLDOWN_MS } from "./ui/reviewer-look";
import { DiffHighlights, type HighlightStatus } from "./ui/diff-highlights";
import { Favicon, faviconUrl } from "./ui/favicon";
import { ViewedTree } from "./ui/file-tree";
import { type Reply, send } from "./api/messages";
import { isWholeFilesTab, type PullRef, parsePullRef, parseRepoPullsRef, pullKey, pullTab, type RepoRef } from "./core/pull-ref";
import type { Inbox } from "./core/inbox";
import { type InboxMarks, MARKS_KEY, NO_MARKS, readMarks, setSnooze, snoozeFor, togglePin } from "./core/inbox-marks";
import { repoInbox, repoViewCounts, type RepoView, viewFromHash } from "./core/repo-views";
import { writeReviewScope } from "./core/review-scope";
import { type InboxViewActions, type Problem, problemFor, type SectionKind } from "./ui/inbox-view";
import { RepoPullsViews } from "./ui/repo-pulls";
import { ReviewDialog } from "./ui/review-dialog";
import { deriveDiscussion, lastReviewBy } from "./core/discussion";
import { deriveReviewers, type DismissedVerdict, type Reviewer } from "./core/reviewers";
import { type AskTarget, chordHints, type CopyTarget, createShortcutMatcher, isMac, type ReviewEvent, shortcutHelp } from "./core/shortcuts";
import type { Overview, VersionPatch } from "./api/github";
import { readCachedOverview } from "./api/overview-cache";
import { overviewTurnInput, repliesAwaiting, type Turn, whoseTurn } from "./core/turn";
import { type ProgressCounts, roughProgress } from "./core/addressed";
import { nameList, pokeMessage, rangeFileStats, type StandingVerdict, staleReviewers, standingVerdict, unseenRange, VERSIONS_PARAM, versionsRangeUrl, waitingReviewers } from "./core/since-review";
import { interdiff } from "./core/interdiff";
import { deriveStack } from "./core/stack";
import { Toast } from "./ui/toast";
import { ChordHint } from "./ui/chord-hint";
import { type Landed, nextStop, READING_LINE, type Stop, stopToast } from "./core/steps";
import type { ReviewThread } from "./core/threads";
import {
  BASE,
  baseCandidates,
  formatRangeParam,
  keepRecentRanges,
  parseRangeParam,
  rangeParam,
  type SavedRange,
  type Version,
  type VersionHistory,
} from "./core/versions";
import { commentIsCurrent, commentJump, type CommentLink, type CommentPlace, currentLines, githubFileAnchor, githubLineSelector, type JumpTarget, parseCommentLink, storedVersionsWillDo } from "./core/comment-jump";
import { type JumpChoice, JumpMenu } from "./ui/jump-menu";
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
/** Whether the viewer reads the versions view side by side. */
const SPLIT_KEY = "versionsSplitView";
/** The URL parameter that keeps the versions view open on the Files changed tab, with the range it compares. */

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
/** The review threads ] and [ last fetched, and when. */
let fetchedThreads: { key: string; at: number; threads: ReviewThread[] } | null = null;
/** The head branch of the pull request on screen, for C then B, once an overview of its own named it. */
let headBranch: { key: string; name: string } | null = null;
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
const NO_REVIEWERS: Reviewer[] = [];
/** The versions of the pull request on screen, for how far each reviewer's standing verdict lags behind. */
let versionHistory: { key: string; versions: VersionHistory } | null = null;
const busy = new Set<string>();
const dialog = new ReviewDialog();
const versionsView = new VersionsView();
const jumpMenu = new JumpMenu();
const toast = new Toast();
const favicon = new Favicon();
const MAC = isMac(navigator.platform);
const matchShortcut = createShortcutMatcher(MAC);
const chordHint = new ChordHint();
/** How long the first key of a chord waits alone before the hint shows what may follow, in milliseconds. */
const HINT_DELAY_MS = 600;
let hintTimer: ReturnType<typeof setTimeout> | undefined;

const actions = {
  refresh: () => void load(true),
  rerequest: (reviewer: Reviewer) => void rerequest(reviewer),
  poke: (reviewer: Reviewer) => void poke(reviewer),
  dismiss: (reviewer: Reviewer, verdict: DismissedVerdict) => openDismissal(reviewer, verdict),
  showUnseen: (reviewer: Reviewer) => showUnseen(reviewer),
  nudge: (reviewer: Reviewer) => void openNudge(reviewer),
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
  chooseDiff: (mode: DiffMode) => chooseDiff(mode),
  toggleDiscussion: () => {
    discussionExpanded = !discussionExpanded;
    update({ discussionExpanded });
  },
  toggleDiscussionBots: () => {
    showBots = !showBots;
    update({ showBots });
  },
  movePull: (move: PullMove) => void movePull(move),
};
const inline = new ReviewBar("inline", actions);
const floating = new ReviewBar("floating", actions);
const viewedTree = new ViewedTree(notify);
const highlights = new DiffHighlights((status) => {
  highlight = status;
  update({ highlight });
});

/** How old the stored inbox may be for a repository's pull request list to skip asking GitHub, as for the popup. */
const REPO_PULLS_FRESH_MS = 60_000;

/** What FloHub's views on the repository's pull request list show, while the page is one. */
let repoPulls: {
  ref: RepoRef;
  view: RepoView | null;
  inbox: Inbox | null;
  problem: Problem | null;
  marks: InboxMarks;
  showSnoozed: Set<SectionKind>;
} | null = null;

const repoActions: InboxViewActions = {
  openPull: (url, background) => {
    if (background) window.open(url, "_blank", "noopener");
    else location.assign(url);
  },
  focusRow: () => undefined,
  toggleSection: () => undefined,
  hideTeamRequests: (repo) => void writeReviewScope(repo, "direct"),
  togglePin: (url) => {
    if (repoPulls) void saveRepoMarks(togglePin(repoPulls.marks, url));
  },
  snooze: (pull, preset) => {
    if (!repoPulls) return;
    const snooze = preset ? snoozeFor(preset, new Date(), pull) : null;
    void saveRepoMarks(setSnooze(repoPulls.marks, pull.url, snooze));
  },
  toggleSnoozed: (kind) => {
    if (!repoPulls) return;
    if (repoPulls.showSnoozed.has(kind)) repoPulls.showSnoozed.delete(kind);
    else repoPulls.showSnoozed.add(kind);
    renderRepoPulls();
  },
  loadEverything: () => undefined,
  retryRefresh: () => void refreshRepoPulls(),
  openSettings: () => void send({ type: "open-options" }),
};
const repoViews = new RepoPullsViews(repoActions);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !repoPulls) return;
  if (Object.hasOwn(changes, MARKS_KEY)) repoPulls.marks = readMarks(changes[MARKS_KEY]?.newValue);
  if (Object.hasOwn(changes, "inbox")) {
    const next = changes.inbox?.newValue as Inbox | undefined;
    if (next) repoPulls.inbox = next;
  }
  if (Object.hasOwn(changes, MARKS_KEY) || Object.hasOwn(changes, "inbox")) renderRepoPulls();
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
addEventListener("hashchange", schedule);
document.addEventListener("turbo:load", schedule);
(globalThis as { navigation?: EventTarget }).navigation?.addEventListener("currententrychange", schedule);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void load(false);
});
addEventListener("focus", () => void load(false));
addEventListener("keydown", onKeydown, true);
addEventListener("pointerdown", dropChordHint, true);
addEventListener("blur", dropChordHint);
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
  syncRepoPulls(parseRepoPullsRef(location.href));
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
    if (versionsView.isOpen) {
      versionsView.close();
      render();
    }
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
  const shown = state.kind === "ready" ? { ...state, versionsOpen: versionsView.isOpen } : state;
  inline.render(shown);
  floating.render(shown);
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

/** Keeps the head branch an overview of the pull request's own names, for C then B. */
function rememberBranch(ref: PullRef, overview: Overview): void {
  const name = overview.repository?.pullRequest?.headRefName;
  if (name) headBranch = { key: pullKey(ref), name };
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
  if (cached.exact) {
    viewerIsAuthor = isAuthor(cached.overview);
    rememberBranch(ref, cached.overview);
  }
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
  const reviewers = exact ? deriveReviewers(pullRequest, overview.viewer.login) : null;
  return {
    kind: "ready",
    reviewers,
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
    versionsOpen: versionsView.isOpen,
    ...turnOf(pullRequest, overview.viewer.login, exact),
    standings: standingsFor(ref, reviewers),
    pull: exact ? { state: pullStateOf(pullRequest), canUpdate: pullRequest.viewerCanUpdate, id: pullRequest.id ?? null } : null,
  };
}

/**
 * @param ref The pull request on screen.
 * @param reviewers Its reviewers.
 * @returns Each reviewer's standing approval or change request, by login, once the versions are known.
 */
function standingsFor(ref: PullRef, reviewers: Reviewer[] | null): ReadonlyMap<string, StandingVerdict> {
  const standings = new Map<string, StandingVerdict>();
  if (versionHistory?.key !== pullKey(ref)) return standings;
  const { versions } = versionHistory.versions;
  const everyone = reviewers ?? NO_REVIEWERS;
  for (const reviewer of everyone) {
    const standing = standingVerdict(versions, reviewer.name);
    if (standing) standings.set(reviewer.name, standing);
  }
  return standings;
}

/**
 * Fetches the versions when a reviewer's approval or change request is on an older commit than the head, so their
 * row can say how far behind it is. The cached versions show first; the fresh ones only when the cache lacks the head.
 * @param ref The pull request.
 * @param head Its head commit.
 * @param verdicts The commits the reviews were given on, with their states.
 */
async function loadHistory(ref: PullRef, head: string, verdicts: { state: string; commit?: { oid: string } | null }[]): Promise<void> {
  const key = pullKey(ref);
  const behind = verdicts.some((review) => (review.state === "APPROVED" || review.state === "CHANGES_REQUESTED") && review.commit && review.commit.oid !== head);
  if (!behind) return;
  const cached = versionHistory?.key === key ? versionHistory.versions : await readCachedHistory(ref);
  if (cached) showHistory(key, cached);
  // A history cached before versions kept their reviews can't say whose verdict is where.
  if (cached?.versions.at(-1)?.oid === head && cached.versions.every((version) => version.reviews !== undefined)) return;
  const fresh = await freshVersions(ref);
  if (typeof fresh !== "string") showHistory(key, fresh);
}

function showHistory(key: string, versions: VersionHistory): void {
  if (!current || pullKey(current) !== key) return;
  versionHistory = { key, versions };
  if (state.kind === "ready") update({ standings: standingsFor(current, state.reviewers) });
}

/** Opens the versions view from the version a reviewer's standing verdict is on to the head. */
function showUnseen(reviewer: Reviewer): void {
  const ref = current;
  const standing = state.kind === "ready" ? state.standings?.get(reviewer.name) : undefined;
  if (!ref || !standing || !unseenRange(standing)) return;
  showInVersions(ref, { range: { from: standing.version.oid, to: standing.current.oid, toCurrent: true, at: Date.now() } });
}

/**
 * Asks a reviewer to look again at what changed since their approval or change request: a comment that names the
 * files and links the range in the versions view, and a new review request when they aren't asked already.
 */
async function openNudge(reviewer: Reviewer): Promise<void> {
  const ref = current;
  const standing = state.kind === "ready" ? state.standings?.get(reviewer.name) : undefined;
  if (!ref || !standing || !versionHistory) return;
  const { versions } = versionHistory;
  const pullUrl = `https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}`;
  let files = null;
  try {
    const [before, after] = await Promise.all([versionPatch(ref, versions, standing.version), versionPatch(ref, versions, standing.current)]);
    files = rangeFileStats(interdiff(before.files, after.files, { sameBase: before.mergeBase === after.mergeBase }));
  } catch {
    // Without the patches the comment only counts the versions.
  }
  const body = pokeMessage(reviewer.name, standing, files, versionsRangeUrl(pullUrl, standing.version, standing.current));
  if (!body || !current || pullKey(current) !== pullKey(ref)) return;
  const asked = reviewer.status === "pending" || reviewer.status === "rerequested";
  dialog.open({
    event: "NUDGE",
    reviewer: reviewer.name,
    body,
    rerequest: !asked && reviewer.canRerequest,
    submit: async (text) => {
      const reply = await send({ type: "post-comment", ref, body: text });
      if (!reply.ok) return `Could not post the comment: ${reply.message}`;
      if (!asked && reviewer.canRerequest) await send({ type: "rerequest", ref, login: reviewer.name });
      toast.show(`Asked ${reviewer.name} to look again.`, "success");
      if (current && pullKey(current) === pullKey(ref)) void load(true);
      return null;
    },
  });
}

async function versionPatch(ref: PullRef, versions: VersionHistory, version: Version): Promise<VersionPatch> {
  const reply = await send({ type: "version-patch", ref, head: version.oid, bases: baseCandidates(versions, version) });
  if (!reply.ok) throw new Error(reply.message);
  return reply.value;
}

/**
 * @param pullRequest The overview's pull request.
 * @param viewer The viewer's login.
 * @param exact Whether the overview is the pull request's own.
 * @returns Whose move it waits for, which reviewers have answers to read, and how the open threads stand; nothing
 *   from another layer's overview.
 */
function turnOf(
  pullRequest: NonNullable<NonNullable<Overview["repository"]>["pullRequest"]>,
  viewer: string,
  exact: boolean,
): { turn: Turn | null; repliesFor: ReadonlyMap<string, number>; progress: ProgressCounts | null } {
  if (!exact) return { turn: null, repliesFor: new Map(), progress: null };
  const input = overviewTurnInput(pullRequest, viewer);
  const progress: ProgressCounts = { changed: 0, untouched: 0, replied: 0 };
  for (const thread of input.threads) {
    const each = roughProgress(thread, input.author);
    if (each) progress[each]++;
  }
  return { turn: whoseTurn(input), repliesFor: repliesAwaiting(input.threads, input.author), progress };
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
    rememberBranch(ref, reply.value);
    const pullRequest = reply.value.repository?.pullRequest;
    if (pullRequest?.headRefOid && pullRequest.baseRefOid) {
      const viewer = reply.value.viewer.login;
      // A pending review is the viewer's unsubmitted draft, not a review of what they saw.
      const reviews = pullRequest.reviews.nodes.filter((review) => review.author?.login === viewer && review.state !== "PENDING");
      const reviewed = reviews.at(-1)?.commit?.oid ?? null;
      highlights.update(ref, { head: pullRequest.headRefOid, base: pullRequest.baseRefOid, reviewed });
      void loadHistory(ref, pullRequest.headRefOid, pullRequest.reviews.nodes);
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

function openDismissal(reviewer: Reviewer, verdict: DismissedVerdict): void {
  const ref = current;
  const reviewId = reviewer.dismissId;
  if (!ref || !reviewId) return;
  const what = verdict === "approved" ? "approval" : "change request";
  dialog.open({
    event: "DISMISS",
    reviewer: reviewer.name,
    verdict,
    submit: async (reason) => {
      const reply = await send({ type: "dismiss-review", reviewId, message: reason });
      if (!reply.ok) return `Could not dismiss the review: ${reply.message}`;
      toast.show(`Dismissed ${reviewer.name}'s ${what}.`, "success");
      if (current && pullKey(current) === pullKey(ref)) void load(true);
      return null;
    },
  });
}

function onKeydown(event: KeyboardEvent): void {
  // macOS sends no keyup for a key pressed with ⌘ held, so a claimed ⌘Esc is let go once Esc goes down again.
  if (event.code === claimedKey) claimedKey = null;
  if (!current || dialog.isOpen) return;
  clearTimeout(hintTimer);
  if (chordHint.isOpen && !["Shift", "Meta", "Control", "Alt", "CapsLock"].includes(event.key)) {
    const listed = chordHint.listsAll;
    chordHint.hide();
    // Esc puts the hint away and drops the chord, and nothing else: not the versions view, not a GitHub dialog. ? puts
    // away the list it opened.
    if (event.key === "Escape" || (listed && event.key === "?")) {
      matchShortcut.cancel();
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
  }
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
  const pending = matchShortcut.pending(event.timeStamp);
  if (pending !== null) hintTimer = setTimeout(() => showChordHint(pending), HINT_DELAY_MS);
  if (!action) return;
  switch (action.type) {
    case "navigate": {
      navigateStack(action.direction);
      break;
    }
    case "copy": {
      void copyForPull(action.what);
      break;
    }
    case "state": {
      moveByShortcut(action.intent);
      break;
    }
    case "review": {
      if (action.withComment) openReview(action.event);
      else void approveNow();
      break;
    }
    case "thread": {
      void stepThread(action.direction);
      break;
    }
    case "file": {
      void stepFile(action.markViewed);
      break;
    }
    case "versions": {
      compareVersions();
      break;
    }
    case "ask": {
      void askAll(action.who);
      break;
    }
    case "help": {
      chordHint.showAll(shortcutHelp(MAC));
      break;
    }
  }
}

/**
 * Shows what may follow a chord's first key, once it has waited alone a while, and keeps the chord open until the next
 * key. Not when the key moved the focus into a text field, as R does when it quotes the selected text.
 * @param first The chord's first key, lower case.
 */
function showChordHint(first: string): void {
  if (matchShortcut.pending(performance.now()) !== first || typingIn(document.activeElement)) return;
  matchShortcut.hold();
  chordHint.show(first.toUpperCase(), chordHints(first, MAC));
}

/** Puts the hint away, and drops the chord it waits on, when the viewer clicks or leaves the window instead. */
function dropChordHint(): void {
  clearTimeout(hintTimer);
  if (!chordHint.isOpen) return;
  chordHint.hide();
  matchShortcut.cancel();
}

/**
 * @param element The focused element, which may be a shadow root's host.
 * @returns Whether it, or what is focused inside it, takes text.
 */
function typingIn(element: Element | null): boolean {
  let focused = element;
  while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
  if (!focused) return false;
  return (focused instanceof HTMLElement && focused.isContentEditable) || focused.matches(TEXT_FIELDS);
}

/** Makes the move a shortcut asks for, or says why it makes none. */
function moveByShortcut(intent: StateIntent): void {
  const pull = state.kind === "ready" ? state.pull : null;
  if (!pull?.id) {
    toast.show("FloHub is still loading the pull request. Try again in a moment.", "info");
    return;
  }
  const move = moveFor(intent, pull.state, pull.canUpdate);
  if (move) void movePull(move);
  else toast.show(noMoveReason(intent, pull.state, pull.canUpdate), "info");
}

/** Closes, reopens, converts to draft or marks ready for review, then shows the new state at once. */
async function movePull(move: PullMove): Promise<void> {
  const ref = current;
  const pull = state.kind === "ready" ? state.pull : null;
  if (!ref || !pull?.id || busy.has(PULL_STATE_BUSY)) return;
  busy.add(PULL_STATE_BUSY);
  render();
  const reply = await send({ type: "move-pull", pullRequestId: pull.id, move });
  busy.delete(PULL_STATE_BUSY);
  const here = current && pullKey(current) === pullKey(ref);
  if (reply.ok) {
    toast.show(moveDone(move, ref.number, isMac(navigator.platform)), "success");
    if (here) update({ pull: { ...pull, state: stateAfter(move) } });
  } else {
    toast.show(`Could not ${MOVE_WORDS[move].failed} #${ref.number}: ${reply.message}`, "danger");
    if (here) render();
  }
  await load(true);
}

async function copyForPull(what: CopyTarget): Promise<void> {
  const ref = current;
  if (!ref) return;
  let text: string;
  if (what === "branch") {
    if (headBranch?.key !== pullKey(ref)) {
      toast.show("FloHub is still loading the pull request. Try again in a moment.", "info");
      return;
    }
    text = headBranch.name;
  } else {
    text = what === "checkout" ? `gh pr checkout ${ref.number}` : `https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}`;
  }
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

/**
 * Switches what Files changed shows. The highlights belong to GitHub's diff, so choosing them, or GitHub's diff
 * without them, closes the versions view.
 * @param mode What to show.
 */
function chooseDiff(mode: DiffMode): void {
  if (mode === "versions") {
    if (!versionsView.isOpen) compareVersions();
    return;
  }
  if (versionsView.isOpen) closeVersions();
  if (highlight) highlights.setHidden(mode === "github");
  schedule();
  render();
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
  const fallback = () => location.assign(link.href);
  const fetched = send({ type: "review-comment", ref, link: named });
  // The link says whether the comment is in the current diff, so that choice needn't wait for the comment.
  const inCurrentDiff = (place: CommentPlace | null): JumpChoice => {
    const isCurrent = commentIsCurrent(named, place);
    return {
      label: "In the current diff",
      detail: isCurrent ? "Where the comment sits in the pull request's current changes" : "The comment is outdated: its lines are gone from the current diff",
      disabled: !isCurrent,
      icon: "target",
      run: () => void showCurrent(ref, named, fetched),
    };
  };
  jumpMenu.open(link, {
    kind: "ready",
    pending: { count: 2, status: "Finding the version the comment was written on…" },
    choices: [inCurrentDiff(null)],
  });
  const [place, stored] = await Promise.all([fetched, readCachedHistory(ref)]);
  if (jumpMenu.openedFrom !== link) return;
  if (!place.ok) {
    jumpMenu.open(link, { kind: "failed", message: place.message, fallback, choices: [inCurrentDiff(null)] });
    return;
  }
  const comment = place.value;
  const history = storedVersionsWillDo(stored, comment.originalCommit) ? stored : await freshVersions(ref);
  if (jumpMenu.openedFrom !== link) return;
  if (typeof history === "string") {
    jumpMenu.open(link, { kind: "failed", message: history, fallback, choices: [inCurrentDiff(comment)] });
    return;
  }
  const jump = commentJump(history.versions, comment, Date.now());
  if (!jump) {
    jumpMenu.open(link, { kind: "failed", message: "FloHub knows no versions of this pull request.", fallback, choices: [inCurrentDiff(comment)] });
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
        icon: "compare",
        run: choose(() => since && showInVersions(ref, since)),
      },
      {
        label: `Code at ${name}`,
        detail: `The pull request's changes as ${name} made them, as the comment saw them`,
        icon: "file",
        run: choose(() => showInVersions(ref, jump.at)),
      },
      inCurrentDiff(comment),
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

/**
 * Scrolls to the comment in the current diff: the versions view's, while it's open, or else GitHub's own. GitHub
 * draws an expanded thread under its comment's number, so that needs no wait for the comment; a collapsed one is only
 * avatars on its line, so that takes the comment's line (see docs/github-quirks.md).
 * @param ref The pull request.
 * @param named What the comment's link names.
 * @param fetched The comment, as it is being fetched.
 */
async function showCurrent(ref: PullRef, named: CommentLink, fetched: Promise<Reply<CommentPlace>>): Promise<void> {
  const drawn = !versionsView.isOpen && named.kind === "comment" ? document.getElementById(`r${named.id}`) : null;
  if (drawn) {
    drawn.scrollIntoView({ block: "center" });
    return;
  }
  const place = await fetched;
  if (!place.ok) {
    toast.show(`Could not read the comment: ${place.message}`, "danger");
    return;
  }
  const lines = currentLines(place.value);
  if (!lines) {
    toast.show("The comment is outdated: its lines are gone from the current diff.", "info");
    return;
  }
  if (versionsView.isOpen) {
    showInVersions(ref, { range: { from: BASE, to: "", toCurrent: true, at: Date.now() }, line: lines });
    return;
  }
  const last = document.querySelector(githubLineSelector(lines))?.closest("tr");
  if (last) {
    const first = lines.startLine === undefined ? last : (document.querySelector(githubLineSelector(lines, lines.startLine))?.closest("tr") ?? last);
    showRows(first, last);
    return;
  }
  // A file GitHub has collapsed, or not loaded yet, keeps its header.
  const file = document.getElementById(await githubFileAnchor(lines.path));
  if (file) {
    file.scrollIntoView({ block: "start" });
    toast.show(`GitHub's diff of ${lines.path} doesn't show the comment's line yet. If the file is collapsed, expand it.`, "info");
  } else toast.show(`GitHub hasn't drawn ${lines.path} yet. Scroll to it and it will.`, "info");
}

/** How long fetched threads serve ] and [ before they are fetched again, in milliseconds. */
const THREADS_FRESH_MS = 30_000;
/** Where the page's sticky header ends, give or take: a file whose header is above it is the one being read. */
const FILE_LINE_PX = 160;

/**
 * @param ref The pull request on screen.
 * @returns Its review threads, fetched at most {@link THREADS_FRESH_MS} ago, or why they could not be.
 */
async function reviewThreads(ref: PullRef): Promise<ReviewThread[] | string> {
  const key = pullKey(ref);
  if (fetchedThreads?.key === key && Date.now() - fetchedThreads.at < THREADS_FRESH_MS) return fetchedThreads.threads;
  const reply = await send({ type: "review-threads", ref });
  if (!reply.ok) return reply.message;
  fetchedThreads = { key, at: Date.now(), threads: reply.value.threads };
  return reply.value.threads;
}

/**
 * ] and [: goes to the next or previous unresolved thread, in the versions view while it's open and in GitHub's diff
 * otherwise. From another tab, it opens Files changed on the first or last one.
 * @param direction 1 for the next, -1 for the previous.
 */
async function stepThread(direction: 1 | -1): Promise<void> {
  const ref = current;
  if (!ref) return;
  if (versionsView.isOpen) {
    const view = versionsView.threadStops();
    if (view === null) toast.show("The versions view is still loading.", "info");
    else if (view === "hidden") toast.show("Comments are switched off in the versions view. Switch them on to step through the threads.", "info");
    else await land(view.stops, view.line, direction, view.go, "unresolved thread", "No unresolved threads in this diff.");
    return;
  }
  const threads = await reviewThreads(ref);
  if (!current || pullKey(current) !== pullKey(ref)) return;
  if (typeof threads === "string") {
    toast.show(`Could not read the threads: ${threads}`, "danger");
    return;
  }
  const open = threads.filter((thread) => !thread.resolved);
  const live = open.filter((thread) => thread.line !== null);
  const outdated = open.length - live.length;
  const elsewhere = outdated === 0 ? "" : ` ${outdated === 1 ? "1 outdated one isn't" : `${outdated} outdated ones aren't`} in the current diff; the versions view shows ${outdated === 1 ? "it" : "them"}.`;
  if (live.length === 0) {
    toast.show(`No unresolved threads in the current diff.${elsewhere}`, "info");
    return;
  }
  if (!isWholeFilesTab(location.pathname)) {
    const ordered = live.toSorted((a, b) => (a.path === b.path ? (a.line ?? 0) - (b.line ?? 0) : a.path.localeCompare(b.path)));
    const target = direction === 1 ? ordered[0] : ordered.at(-1);
    const comment = target?.comments[0]?.id;
    if (comment !== undefined) location.assign(`https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}/changes#r${comment}`);
    return;
  }
  const placed = await Promise.all(live.map(async (thread) => ({ thread, element: await threadOnPage(thread) })));
  const line = innerHeight * READING_LINE;
  const found = placed
    .filter((each): each is { thread: ReviewThread; element: Element } => each.element !== null)
    .map(({ thread, element }) => ({ id: thread.id, thread, element, top: element.getBoundingClientRect().top }))
    .toSorted((a, b) => (a.top === b.top ? (a.thread.line ?? 0) - (b.thread.line ?? 0) : a.top - b.top));
  const go = async (id: string): Promise<number> => {
    const stop = found.find((each) => each.id === id);
    if (!stop) return 0;
    scrollToLine(stop.element, line);
    if (stop.element instanceof HTMLTableRowElement) {
      await unfoldThread(stop.thread, stop.element);
      scrollToLine(stop.element, line);
      flashRows([stop.element]);
    } else if (!/^r\d+$/u.test(stop.element.id)) {
      toast.show(`GitHub hasn't drawn this thread in ${stop.thread.path} yet. If the file is collapsed, expand it.`, "info");
    }
    markInPanel(stop.thread);
    return stop.element.getBoundingClientRect().top;
  };
  await land(found, line, direction, go, "unresolved thread", "GitHub hasn't drawn the files with unresolved threads yet.", elsewhere);
}

/** How long GitHub may take to draw a thread FloHub unfolded, in milliseconds. */
const UNFOLD_WAIT_MS = 1000;

/**
 * Unfolds a thread GitHub draws folded on its line, as it does with the comments panel open. Its only way to unfold
 * is a "View comments" button GitHub puts in the line's cell while the mouse is over it (see docs/github-quirks.md),
 * so FloHub plays the mouse over the cell and presses that. The button toggles, so a thread already drawn is left.
 * @param thread The thread.
 * @param row Its line's row in GitHub's diff.
 */
async function unfoldThread(thread: ReviewThread, row: HTMLTableRowElement): Promise<void> {
  const first = thread.comments[0]?.id;
  if (first === undefined) return;
  const drawn = () => {
    const box = document.getElementById(`r${first}`)?.getBoundingClientRect();
    return box !== undefined && box.height > 0;
  };
  if (drawn()) return;
  const cell = row.querySelector(githubLineSelector({ path: thread.path, line: thread.line ?? 0, side: thread.side })) ?? row.querySelector("td.diff-text-cell");
  if (!cell) return;
  cell.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body }));
  const button = await waitFor(() => cell.querySelector<HTMLButtonElement>('button[aria-label="View comments"]'));
  button?.click();
  cell.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
  if (button) await waitFor(() => (drawn() ? true : null));
}

/**
 * @param find What to wait for, null until it is there.
 * @returns It, once there, or null after {@link UNFOLD_WAIT_MS}.
 */
async function waitFor<T>(find: () => T | null): Promise<T | null> {
  const until = performance.now() + UNFOLD_WAIT_MS;
  for (let found = find(); ; found = find()) {
    if (found !== null || performance.now() > until) return found;
    // oxlint-disable-next-line no-await-in-loop -- each look waits for GitHub's next frame
    await new Promise((resolve) => {
      requestAnimationFrame(resolve);
    });
  }
}

/** The comments panel's entry FloHub marked as the thread ] and [ went to. */
const PANEL_MARK = "data-flohub-current-thread";
const PANEL_MARKED = "[data-flohub-current-thread]";

/**
 * Scrolls the comments panel to a thread's entry, when the panel is open, and marks it until the next thread.
 * @param thread The thread ] or [ went to.
 */
function markInPanel(thread: ReviewThread): void {
  for (const marked of document.querySelectorAll(PANEL_MARKED)) marked.removeAttribute(PANEL_MARK);
  const first = thread.comments[0]?.id;
  const entry = first === undefined ? null : document.getElementById(`paneldiscussion_r${first}`);
  if (!(entry instanceof HTMLElement) || !entry.closest(COMMENTS_PANEL)) return;
  ensurePanelStyles();
  // The entry is its thread's first comment; the thread's card, an article, holds its file, line and replies too.
  const box = entry.closest("article") ?? entry;
  box.setAttribute(PANEL_MARK, "");
  let scroller = box.parentElement;
  while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /auto|scroll/u.test(getComputedStyle(scroller).overflowY))) {
    scroller = scroller.parentElement;
  }
  // Scrolling the panel itself, since scrolling the entry into view would move the diff too.
  if (scroller) scroller.scrollTop += box.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12;
}

function ensurePanelStyles(): void {
  if (document.getElementById("flohub-panel-mark")) return;
  document.head.append(
    Object.assign(document.createElement("style"), {
      id: "flohub-panel-mark",
      // Inside the card, since the panel clips what reaches past it.
      textContent: `${PANEL_MARKED} { outline: 2px solid var(--fgColor-accent, #0969da); outline-offset: -2px; }`,
    }),
  );
}

/**
 * Scrolls an element of GitHub's page to the reading line, at once. GitHub's diff may scroll in a pane of its own
 * rather than the window, so the element is scrolled into view, with a margin as tall as the space above the line.
 * @param element The element.
 * @param line How far down the window its top should go, in pixels.
 */
function scrollToLine(element: Element, line: number): void {
  if (!(element instanceof HTMLElement)) {
    element.scrollIntoView({ block: "start", behavior: "instant" });
    return;
  }
  const margin = element.style.scrollMarginTop;
  // The page's scroll padding, which keeps its sticky header clear, adds to the margin.
  const padding = Number(getComputedStyle(document.documentElement).scrollPaddingTop.replace(/px$/u, ""));
  element.style.scrollMarginTop = `${Math.round(line - (Number.isNaN(padding) ? 0 : padding))}px`;
  // GitHub scrolls smoothly, which would leave the stop short of where it lands when it's measured.
  element.scrollIntoView({ block: "start", behavior: "instant" });
  element.style.scrollMarginTop = margin;
}

/**
 * Where GitHub's diff shows a thread: its line, else the thread itself, else its file's header. The line comes first:
 * a folded thread unfolds below it, which would move a stop measured by the thread.
 * @param thread An unresolved thread with lines in the current diff.
 * @returns The element, or null when GitHub hasn't drawn even the file.
 */
async function threadOnPage(thread: ReviewThread): Promise<Element | null> {
  if (thread.line !== null) {
    const row = document.querySelector(githubLineSelector({ path: thread.path, line: thread.line, side: thread.side }))?.closest("tr");
    if (row) return row;
  }
  const first = thread.comments[0]?.id;
  const drawn = first === undefined ? null : document.getElementById(`r${first}`);
  return drawn ?? document.getElementById(await githubFileAnchor(thread.path));
}

/**
 * F goes to the next file not marked Viewed; ⇧F marks the file being read as viewed first. Both work in GitHub's
 * diff and in the versions view while it ends at the current version, the one GitHub keeps the marks for.
 * @param markViewed Whether to mark the file being read first.
 */
async function stepFile(markViewed: boolean): Promise<void> {
  const ref = current;
  if (!ref) return;
  if (versionsView.isOpen) {
    await stepVersionsFile(markViewed);
    return;
  }
  if (!isWholeFilesTab(location.pathname)) {
    toast.show(`${markViewed ? "⇧F" : "F"} works in GitHub's own Files changed diff, where the Viewed marks are.`, "info");
    return;
  }
  const files = viewedTree.files(ref);
  if (!files) {
    toast.show("FloHub is still loading which files you viewed. Try again in a moment.", "info");
    return;
  }
  const onPage = files
    .map((file) => ({ path: file.path, state: file.state, id: file.path, element: document.getElementById(file.anchor), top: 0 }))
    .filter((file): file is typeof file & { element: HTMLElement } => file.element !== null)
    .map((file) => Object.assign(file, { top: file.element.getBoundingClientRect().top }))
    .toSorted((a, b) => a.top - b.top);
  if (onPage.length === 0) {
    toast.show("GitHub hasn't drawn the files yet. Try again in a moment.", "info");
    return;
  }
  const reading = markViewed ? (onPage.findLast((file) => file.top <= FILE_LINE_PX) ?? onPage[0]) : undefined;
  if (reading) await viewedTree.markViewed(reading.path);
  const left = onPage.filter((file) => file.state !== "VIEWED" && file !== reading);
  const done = reading ? `Marked ${reading.path} as viewed. ` : "";
  if (left.length === 0) {
    toast.show(`${done}Every file is marked as viewed.`, "success");
    return;
  }
  // Marking a file viewed folds it, which moves the files below: they are measured again.
  for (const file of left) file.top = file.element.getBoundingClientRect().top;
  const go = (id: string): number => {
    const file = left.find((each) => each.id === id);
    if (!file) return 0;
    file.element.scrollIntoView({ block: "start", behavior: "instant" });
    return file.element.getBoundingClientRect().top;
  };
  const line = reading ? reading.element.getBoundingClientRect().top : FILE_LINE_PX;
  await land(left, line, 1, go, "file not viewed yet", "", "", done);
}

/**
 * F and ⇧F in the versions view.
 * @param markViewed Whether to mark the file being read first.
 */
async function stepVersionsFile(markViewed: boolean): Promise<void> {
  const key = markViewed ? "⇧F" : "F";
  const steps = versionsView.fileSteps();
  if (steps === null) {
    toast.show("The versions view is still loading.", "info");
    return;
  }
  if (steps === "not-head") {
    toast.show(`GitHub keeps the Viewed marks for the current version only. Compare up to it to use ${key}.`, "info");
    return;
  }
  if (steps === "unknown") {
    toast.show("FloHub is still loading which files you viewed. Try again in a moment.", "info");
    return;
  }
  const reading = markViewed ? steps.reading : null;
  if (markViewed && !reading) {
    toast.show("No file in view can be marked as viewed.", "info");
    return;
  }
  if (reading) await steps.markViewed(reading);
  // Marking a file viewed folds it, which moves the files below: they are measured again.
  const after = reading ? versionsView.fileSteps() : steps;
  if (after === null || typeof after === "string") return;
  const done = reading ? `Marked ${reading} as viewed. ` : "";
  const left = after.stops.filter((stop) => stop.id !== reading);
  if (left.length === 0) {
    toast.show(`${done}Every file in this diff is marked as viewed.`, "success");
    return;
  }
  await land(left, after.line, 1, after.go, "file not viewed yet", "", "", done);
}

/** The stop ] and [, or U, last went to, and where it landed. */
let landed: Landed | null = null;

/**
 * Goes to the next stop, and says which one of how many it is.
 * @param stops The stops, top to bottom.
 * @param line The reading line, in the stops' pixels.
 * @param direction 1 to go down, -1 to go up.
 * @param go Scrolls to a stop by id, and returns where it landed, once it has.
 * @param noun What a stop is, for the toast.
 * @param none What the toast says when there are none.
 * @param after What the toast adds at the end.
 * @param before What the toast starts with.
 */
async function land(
  stops: Stop[],
  line: number,
  direction: 1 | -1,
  go: (id: string) => number | Promise<number>,
  noun: string,
  none: string,
  after = "",
  before = "",
): Promise<void> {
  const next = nextStop(stops, line, direction, landed);
  const stop = next ? stops[next.index] : undefined;
  if (!next || !stop) {
    toast.show(none, "info");
    return;
  }
  landed = { id: stop.id, top: await go(stop.id) };
  toast.show(`${before}${stopToast(next.index, stops.length, next.wrapped, noun)}${after}`, "info");
}

/** Scrolls GitHub's diff to a comment's rows and flashes them, so the eye finds them. */
function showRows(first: Element, last: Element): void {
  const rows: Element[] = [];
  for (let row: Element | null = first; row; row = row === last ? null : row.nextElementSibling) rows.push(row);
  rows[Math.floor(rows.length / 2)]?.scrollIntoView({ block: "center" });
  flashRows(rows);
}

/** Flashes rows of GitHub's diff, so the eye finds them. */
function flashRows(rows: readonly Element[]): void {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (const row of rows) {
    for (const cell of row.querySelectorAll("td")) {
      cell.animate(
        [{ boxShadow: "inset 0 0 0 999px var(--bgColor-attention-muted, #fff8c5)" }, { boxShadow: "inset 0 0 0 999px transparent" }],
        { duration: 1600, easing: "ease-out" },
      );
    }
  }
}

function closeVersions(): void {
  versionsWanted = null;
  versionsView.close();
  writeVersionsParam(null);
  render();
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
    viewer: () => (state.kind === "ready" ? state.viewer : null),
    post: async (action) => {
      const reply = await send({ type: "review-action", ref, action });
      if (!reply.ok) throw new Error(reply.message);
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
    splitView: async () => {
      try {
        const stored = await chrome.storage.local.get(SPLIT_KEY);
        return stored[SPLIT_KEY] === true;
      } catch {
        return false;
      }
    },
    saveSplitView: (split) => void chrome.storage.local.set({ [SPLIT_KEY]: split }).catch(() => undefined),
    viewed: {
      states: () => viewedTree.states(ref),
      set: async (path, viewed) => viewedTree.setViewed(path, viewed),
      watch: (listener) => viewedTree.watch(ref, listener),
    },
  });
  render();
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
    rememberPokes(ref, [reviewer]);
    toast.show(`Poked ${reviewer.name}. GitHub notifies them within a minute.`, "success");
  } else {
    toast.show(reply.message, "danger");
  }
  if (current && pullKey(current) === pullKey(ref)) update({ pokedAt: pokedAtFor(ref) });
  await load(true);
}

/** Stores when the viewer poked these reviewers, for the cooldown, forgetting pokes older than the memory keeps. */
function rememberPokes(ref: PullRef, reviewers: readonly Reviewer[]): void {
  const now = Date.now();
  pokes = Object.fromEntries([
    ...Object.entries(pokes).filter(([, at]) => now - at < POKE_MEMORY_MS),
    ...reviewers.map((reviewer) => [`${pullKey(ref)}|${reviewer.key}`, now] as const),
  ]);
  void chrome.storage.local.set({ pokes });
}

/**
 * R then R re-requests everyone whose approval or change request is on an older version; P then P pokes every
 * requested reviewer who hasn't answered. Both act at once, like each reviewer's own button, and say whom they asked.
 * @param who Which of the two.
 */
async function askAll(who: AskTarget): Promise<void> {
  const ref = current;
  if (!ref || state.kind !== "ready" || !state.reviewers || (who === "stale" && !state.standings)) {
    toast.show("FloHub is still loading the reviewers. Try again in a moment.", "info");
    return;
  }
  const asked =
    who === "stale"
      ? staleReviewers(state.reviewers, state.standings ?? new Map())
      : waitingReviewers(state.reviewers, state.pokedAt, Date.now(), POKE_COOLDOWN_MS);
  if (asked.length === 0) {
    toast.show(
      who === "stale"
        ? "Nobody's verdict is on an older version, or they're asked to review again already."
        : "Nobody requested is waiting: everyone answered, or was poked within the hour.",
      "info",
    );
    return;
  }
  if (asked.some((reviewer) => busy.has(reviewer.key))) return;
  for (const reviewer of asked) busy.add(reviewer.key);
  render();
  const replies = await Promise.all(
    asked.map(async (reviewer) =>
      send(
        who === "stale"
          ? { type: "rerequest", ref, login: reviewer.name }
          : { type: "poke", ref, reviewer: { kind: reviewer.kind === "team" ? "team" : "user", name: reviewer.name } },
      ),
    ),
  );
  for (const reviewer of asked) busy.delete(reviewer.key);
  const done = asked.filter((_, index) => replies[index]?.ok);
  const missed = asked.filter((_, index) => !replies[index]?.ok);
  if (who === "waiting") rememberPokes(ref, done);
  const names = nameList(done.map((reviewer) => reviewer.name));
  const said = done.length === 0 ? "" : (who === "stale" ? `Re-requested review from ${names}.` : `Poked ${names}. GitHub notifies them within a minute.`);
  const problem = replies.map((reply) => (reply.ok ? null : reply.message)).find((message) => message !== null) ?? null;
  if (problem === null) toast.show(said, "success");
  else {
    const verb = who === "stale" ? "re-request" : "poke";
    toast.show(`${said} Could not ${verb} ${nameList(missed.map((reviewer) => reviewer.name))}: ${problem}`.trim(), "danger");
  }
  if (current && pullKey(current) === pullKey(ref)) update({ pokedAt: pokedAtFor(ref) });
  await load(true);
}

/**
 * Shows FloHub's views on a repository's pull request list, and takes them away on any other page.
 * @param ref The repository whose list the page shows, or null.
 */
function syncRepoPulls(ref: RepoRef | null): void {
  if (!ref) {
    if (repoPulls) repoViews.remove();
    repoPulls = null;
    return;
  }
  const view = viewFromHash(location.hash);
  if (!repoPulls || `${repoPulls.ref.owner}/${repoPulls.ref.repo}`.toLowerCase() !== `${ref.owner}/${ref.repo}`.toLowerCase()) {
    repoPulls = { ref, view, inbox: null, problem: null, marks: NO_MARKS, showSnoozed: new Set() };
    renderRepoPulls();
    void showStoredInbox();
    void refreshRepoPulls(REPO_PULLS_FRESH_MS);
  } else if (repoPulls.view !== view) {
    repoPulls.view = view;
    renderRepoPulls();
  }
  repoViews.place(ref, view !== null);
}

async function showStoredInbox(): Promise<void> {
  const stored = await chrome.storage.local.get(["inbox", MARKS_KEY]);
  if (!repoPulls) return;
  repoPulls.inbox ??= (stored.inbox as Inbox | undefined) ?? null;
  repoPulls.marks = readMarks(stored[MARKS_KEY]);
  renderRepoPulls();
}

/** @param maxAgeMs How old a stored inbox may be to answer instead of fetching; omit it to always fetch. */
async function refreshRepoPulls(maxAgeMs?: number): Promise<void> {
  const reply = await send({ type: "inbox", maxAgeMs });
  if (!repoPulls) return;
  if (reply.ok) {
    repoPulls.inbox = reply.value;
    repoPulls.problem = null;
  } else {
    repoPulls.problem = problemFor(reply.code, reply.message);
  }
  renderRepoPulls();
}

function renderRepoPulls(): void {
  if (!repoPulls) return;
  const { ref, view, inbox, problem, marks, showSnoozed } = repoPulls;
  const now = Date.now();
  const shown = inbox && repoInbox(inbox, ref);
  repoViews.render({
    view,
    counts: shown && repoViewCounts(shown, marks, now),
    inbox: { inbox: shown, problem, collapsed: new Set(), marks, showSnoozed, now, scope: `${ref.owner}/${ref.repo}` },
  });
}

async function saveRepoMarks(next: InboxMarks): Promise<void> {
  if (repoPulls) repoPulls.marks = next;
  renderRepoPulls();
  await chrome.storage.local.set({ [MARKS_KEY]: next });
}
