import { type BarState, ReviewBar } from "./bar";
import { findInlineAnchor } from "./anchor";
import { ViewedTree } from "./file-tree";
import { send } from "./messages";
import { type PullRef, parsePullRef, pullKey } from "./pull-ref";
import { deriveReviewers, type Reviewer } from "./reviewers";
import { deriveStack } from "./stack";

const AUTO_REFRESH_GAP_MS = 15_000;
const STICKY_HEADER_HEIGHT = 96;
const ANCHOR_RETRY_MS = 1_000;
const AGE_TICK_MS = 60_000;

let current: PullRef | null = null;
let state: BarState = { kind: "loading" };
let lastLoad = 0;
let generation = 0;
let scheduled = false;
let lastAnchorSearch = 0;
let stackCollapsed = false;
let showMerged = false;
let pendingNotice: string | null = null;
const busy = new Set<string>();

const actions = {
  refresh: () => void load(true),
  rerequest: (reviewer: Reviewer) => void rerequest(reviewer),
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

void chrome.storage.local.get("stackCollapsed").then((stored) => {
  stackCollapsed = stored.stackCollapsed === true;
  update({ stackCollapsed });
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

sync();

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    sync();
  });
}

function sync(): void {
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
  if (!inline.host.isConnected && Date.now() - lastAnchorSearch >= ANCHOR_RETRY_MS) {
    lastAnchorSearch = Date.now();
    findInlineAnchor(document, ref.number)?.after(inline.host);
  }
  viewedTree.sync(ref);
  updateVisibility();
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
