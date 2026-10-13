import { type BarState, ReviewBar } from "./bar";
import { findInlineAnchor } from "./anchor";
import { ViewedTree } from "./file-tree";
import { send } from "./messages";
import { type PullRef, parsePullRef, pullKey, pullTab } from "./pull-ref";
import { ReviewDialog } from "./review-dialog";
import { deriveReviewers, type Reviewer } from "./reviewers";
import { createShortcutMatcher, type ReviewEvent } from "./shortcuts";
import { deriveStack } from "./stack";
import { Toast } from "./toast";

const AUTO_REFRESH_GAP_MS = 15_000;
const STICKY_HEADER_HEIGHT = 96;
const ANCHOR_RETRY_MS = 1_000;
const AGE_TICK_MS = 60_000;
const POKE_MEMORY_MS = 86_400_000;
const TEXT_FIELDS = "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox'], [role='combobox'], [role='searchbox']";

let current: PullRef | null = null;
let state: BarState = { kind: "loading" };
let lastLoad = 0;
let generation = 0;
let scheduled = false;
let lastAnchorSearch = 0;
let anchorRetry: ReturnType<typeof setTimeout> | undefined;
let stackCollapsed = false;
let showMerged = false;
let pendingNotice: string | null = null;
let viewerIsAuthor = false;
let claimedKey: string | null = null;
let pokes: Record<string, number> = {};
const busy = new Set<string>();
const dialog = new ReviewDialog();
const toast = new Toast();
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
};
const inline = new ReviewBar("inline", actions);
const floating = new ReviewBar("floating", actions);
const viewedTree = new ViewedTree(notify);

void chrome.storage.local.get(["stackCollapsed", "pokes"]).then((stored) => {
  stackCollapsed = stored.stackCollapsed === true;
  pokes = (stored.pokes as Record<string, number> | undefined) ?? {};
  update({ stackCollapsed, ...(current ? { pokedAt: pokedAtFor(current) } : {}) });
});
setInterval(() => update({ now: Date.now() }), AGE_TICK_MS);

new IntersectionObserver(updateVisibility, { rootMargin: `-${STICKY_HEADER_HEIGHT}px 0px 0px 0px` }).observe(
  inline.host,
);

new MutationObserver(schedule).observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributeFilter: ["aria-pressed", "aria-checked"],
});
document.addEventListener("change", schedule, true);
document.addEventListener("click", schedule, true);
addEventListener("popstate", schedule);
document.addEventListener("turbo:load", schedule);
(window as { navigation?: EventTarget }).navigation?.addEventListener("currententrychange", schedule);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void load(false);
});
addEventListener("focus", () => void load(false));
addEventListener("keydown", onKeydown, true);
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

function sync(): void {
  if (!document.body) return;
  const ref = parsePullRef(location.href);
  if (!ref) {
    current = null;
    viewedTree.sync(null);
    inline.host.remove();
    updateVisibility();
    return;
  }

  if (!current || pullKey(current) !== pullKey(ref)) {
    current = ref;
    state = { kind: "loading" };
    busy.clear();
    showMerged = false;
    pendingNotice = null;
    viewedTree.sync(null);
    lastAnchorSearch = 0;
    render();
    void load(true);
  }

  if (!floating.host.isConnected) document.body.append(floating.host);
  if (!inline.host.isConnected) mountInline(ref);
  viewedTree.sync(ref);
  updateVisibility();
}

/**
 * Looks for the header to mount the inline bar in, at most once per {@link ANCHOR_RETRY_MS}. A search that is
 * skipped runs once the wait is over, so the last change to a page that is still loading always gets a search.
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
  lastAnchorSearch = Date.now();
  findInlineAnchor(document, ref.number)?.after(inline.host);
}

function updateVisibility(): void {
  const onPull = current !== null;
  inline.setHidden(!onPull);
  floating.setHidden(!onPull || isInlineInView());
}

function isInlineInView(): boolean {
  if (!inline.host.isConnected || inline.host.hidden) return false;
  const rect = inline.host.getBoundingClientRect();
  return rect.height > 0 && rect.bottom > STICKY_HEADER_HEIGHT && rect.top < innerHeight;
}

function render(): void {
  inline.render(state);
  floating.render(state);
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
    const pullRequest = reply.value.repository?.pullRequest;
    viewerIsAuthor = pullRequest?.author?.login === reply.value.viewer.login;
    state = pullRequest
      ? {
          kind: "ready",
          reviewers: deriveReviewers(pullRequest, reply.value.viewer.login),
          stack: deriveStack(pullRequest, pullRequest.baseRefName),
          stackCollapsed,
          showMerged,
          now: Date.now(),
          refreshing: false,
          busy,
          pokedAt: pokedAtFor(ref),
          notice:
            reply.value.unreadable.length > 0
              ? `This token cannot read ${reply.value.unreadable.join(", ")}, so parts may be missing. Check its permissions.`
              : state.kind === "ready"
                ? state.notice
                : pendingNotice,
        }
      : { kind: "error", message: "Pull request not found." };
  } else if (reply.code !== "failed") {
    state = { kind: "setup", message: reply.message };
  } else if (state.kind === "ready") {
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
  if (state.kind === "ready") {
    state = { ...state, notice: reply.ok ? null : `Could not re-request ${reviewer.name}: ${reply.message}` };
  }
  render();
  await load(true);
}

function onKeydown(event: KeyboardEvent): void {
  if (!current || dialog.isOpen) return;
  const action = matchShortcut({
    key: event.key,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    repeat: event.repeat,
    editable: isTextField(event),
    time: event.timeStamp,
  });
  if (!action) return;
  claimedKey = event.code;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (action.type === "navigate") navigateStack(action.direction);
  else if (action.withComment) openReview(action.event);
  else void approveNow();
}

/** Hides the rest of a key FloHub claimed from the page, whose own shortcuts may listen for keypress or keyup. */
function swallowClaimedKey(event: KeyboardEvent): void {
  if (event.code !== claimedKey) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.type === "keyup") claimedKey = null;
}

function isTextField(event: KeyboardEvent): boolean {
  const target = event.composedPath()[0];
  if (!(target instanceof Element)) return false;
  return (target instanceof HTMLElement && target.isContentEditable) || !!target.closest(TEXT_FIELDS);
}

function navigateStack(direction: 1 | -1): void {
  if (state.kind !== "ready") return;
  const position = state.stack.currentPosition + direction;
  const target = state.stack.entries.find((entry) => entry.position === position);
  if (!target) {
    toast.show(direction === 1 ? "Already at the top of the stack." : "Already at the bottom of the stack.", "info");
    return;
  }
  location.assign(`${target.url}${pullTab(location.pathname)}`);
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
    pendingComments: send({ type: "pending-comments", ref }).then((reply) => {
      if (!reply.ok) throw new Error(reply.message);
      return reply.value;
    }),
    submit: async (body) => {
      const failure = await submitReview(ref, event, body);
      if (!failure) toast.show(event === "APPROVE" ? `Approved #${ref.number}.` : `Requested changes on #${ref.number}.`, "success");
      return failure;
    },
  });
}

async function submitReview(ref: PullRef, event: ReviewEvent, body: string): Promise<string | null> {
  const reply = await send({ type: "submit-review", ref, event, body });
  if (!reply.ok) return `Could not submit the review: ${reply.message}`;
  void load(true);
  return null;
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
