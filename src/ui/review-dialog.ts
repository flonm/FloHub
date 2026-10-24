import { el, icon } from "./dom";
import type { DismissedVerdict } from "../core/reviewers";
import type { ReviewEvent } from "../core/shortcuts";

export type ReviewDialogRequest = SubmitRequest | DismissRequest | NudgeRequest;

interface SubmitRequest {
  event: ReviewEvent;
  number: number;
  /** Resolves to the draft comments a pending review holds, or null when there is none. */
  pendingComments: Promise<number | null>;
  /**
   * Submits the review.
   * @returns An error message to show, or null on success.
   */
  submit: (body: string) => Promise<string | null>;
}

interface DismissRequest {
  event: "DISMISS";
  reviewer: string;
  verdict: DismissedVerdict;
  /**
   * Dismisses the review.
   * @returns An error message to show, or null on success.
   */
  submit: (reason: string) => Promise<string | null>;
}

interface NudgeRequest {
  event: "NUDGE";
  reviewer: string;
  /** The comment as composed, which the viewer may edit. */
  body: string;
  /** Whether posting it also asks the reviewer to review again. */
  rerequest: boolean;
  /**
   * Posts the comment.
   * @returns An error message to show, or null on success.
   */
  submit: (body: string) => Promise<string | null>;
}

type DialogEvent = ReviewDialogRequest["event"];

const COPY: Record<DialogEvent, { title: string; action: string; busy: string }> = {
  APPROVE: { title: "Approve", action: "Approve", busy: "Approving…" },
  REQUEST_CHANGES: { title: "Request changes on", action: "Request changes", busy: "Requesting changes…" },
  DISMISS: { title: "Dismiss", action: "Dismiss review", busy: "Dismissing…" },
  NUDGE: { title: "Ask", action: "Post and ask", busy: "Posting…" },
};

const GLYPH: Record<DialogEvent, "check" | "changes" | "slash" | "comment"> = {
  APPROVE: "check",
  REQUEST_CHANGES: "changes",
  DISMISS: "slash",
  NUDGE: "comment",
};

const DISMISSED_NAME: Record<DismissedVerdict, string> = { approved: "approval", changes_requested: "change request" };

const DIALOG_STYLES = `
:host {
  --rd-fg: var(--fgColor-default, #1f2328);
  --rd-muted: var(--fgColor-muted, #59636e);
  --rd-bg: var(--bgColor-default, #ffffff);
  --rd-border: var(--borderColor-default, #d1d9e0);
  --rd-danger: var(--fgColor-danger, #d1242f);
  --rd-focus: var(--focus-outlineColor, #0969da);
  --rd-shadow: var(--shadow-floating-xlarge, 0 12px 48px rgba(31, 35, 40, 0.3));
  --rd-approve-bg: var(--button-primary-bgColor-rest, #1f883d);
  --rd-approve-fg: var(--button-primary-fgColor-rest, #ffffff);
  --rd-changes-bg: var(--button-danger-bgColor-hover, #cf222e);
  --rd-changes-fg: var(--button-danger-fgColor-hover, #ffffff);
  --rd-nudge-bg: var(--bgColor-accent-emphasis, #0969da);
  --rd-nudge-fg: var(--fgColor-onEmphasis, #ffffff);
  font: 14px/1.5 var(--fontStack-sansSerif, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif);
  color: var(--rd-fg);
}
* { box-sizing: border-box; }
dialog {
  width: min(560px, calc(100vw - 32px));
  padding: 0;
  border: 1px solid var(--rd-border);
  border-radius: 12px;
  background: var(--rd-bg);
  color: var(--rd-fg);
  box-shadow: var(--rd-shadow);
}
dialog[open] { animation: appear 140ms ease-out; }
dialog::backdrop { background: rgba(31, 35, 40, 0.4); }
@keyframes appear { from { opacity: 0; transform: translateY(6px); } }
form { display: flex; flex-direction: column; gap: 12px; padding: 16px; }
h2 { margin: 0; font-size: 16px; }
/* The verdict's icon in a tinted circle beside the title, in the reviewer rows' colours. */
.title-row { display: flex; align-items: center; gap: 10px; }
.glyph { display: flex; flex: none; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; }
.glyph svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
.glyph[data-event="APPROVE"] { background: var(--bgColor-success-muted, #dafbe1); color: var(--fgColor-success, #1a7f37); }
.glyph[data-event="REQUEST_CHANGES"] { background: var(--bgColor-attention-muted, #fff8c5); color: var(--fgColor-attention, #9a6700); }
.glyph[data-event="NUDGE"] { background: var(--bgColor-accent-muted, #ddf4ff); color: var(--fgColor-accent, #0969da); }
.glyph[data-event="DISMISS"] { background: var(--bgColor-neutral-muted, #818b981f); color: var(--rd-muted); }
kbd { padding: 0 5px; border: 1px solid var(--rd-border); border-bottom-width: 2px; border-radius: 4px; font: 11px/16px var(--fontStack-monospace, ui-monospace, monospace); }
label { font-weight: 600; }
.optional { color: var(--rd-muted); font-weight: 400; }
textarea {
  width: 100%;
  min-height: 120px;
  padding: 8px 10px;
  border: 1px solid var(--rd-border);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  resize: vertical;
}
.hint { margin: 0; color: var(--rd-muted); font-size: 12px; }
.error { margin: 0; color: var(--rd-danger); }
.error:empty { display: none; }
.actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
.keys { margin-right: auto; color: var(--rd-muted); font-size: 12px; }
button {
  min-height: 32px;
  padding: 0 14px;
  border: 1px solid var(--rd-border);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
button.submit[data-event="APPROVE"] { border-color: transparent; background: var(--rd-approve-bg); color: var(--rd-approve-fg); }
button.submit[data-event="NUDGE"] { border-color: transparent; background: var(--rd-nudge-bg); color: var(--rd-nudge-fg); }
button.submit:is([data-event="REQUEST_CHANGES"], [data-event="DISMISS"]) { border-color: transparent; background: var(--rd-changes-bg); color: var(--rd-changes-fg); }
button:disabled { cursor: not-allowed; opacity: 0.6; }
:focus-visible { outline: 2px solid var(--rd-focus); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { dialog[open] { animation: none; } }
`;

/**
 * @param request What the dialog submits.
 * @returns Its title.
 */
function titleFor(request: ReviewDialogRequest): string {
  switch (request.event) {
    case "DISMISS": {
      return `${COPY.DISMISS.title} ${request.reviewer}'s ${DISMISSED_NAME[request.verdict]}`;
    }
    case "NUDGE": {
      return `Ask ${request.reviewer} to look again`;
    }
    case "APPROVE":
    case "REQUEST_CHANGES": {
      return `${COPY[request.event].title} #${request.number}`;
    }
  }
}

/**
 * @param request What the dialog submits.
 * @returns The line under the text box, until a review's pending comments are counted.
 */
function hintFor(request: ReviewDialogRequest): string {
  switch (request.event) {
    case "DISMISS": {
      return `GitHub posts the reason on the pull request and notifies ${request.reviewer}.`;
    }
    case "NUDGE": {
      return `Posts this comment on the pull request, which notifies ${request.reviewer}${request.rerequest ? ", and asks them to review again" : ""}.`;
    }
    case "APPROVE":
    case "REQUEST_CHANGES": {
      return "Checking for pending comments…";
    }
  }
}

/**
 * A modal for approving or requesting changes with a comment, submitting any pending review, or for dismissing
 * someone's review with the reason GitHub requires.
 */
export class ReviewDialog {
  private readonly host: HTMLElement;
  private readonly dialog: HTMLDialogElement;
  private generation = 0;

  constructor() {
    this.host = document.createElement("flohub-dialog");
    const shadow = this.host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = DIALOG_STYLES;
    this.dialog = el("dialog", { "aria-labelledby": "review-title" });
    shadow.append(style, this.dialog);
    for (const type of ["keydown", "keyup", "keypress"]) {
      shadow.addEventListener(type, (event) => event.stopPropagation());
    }
    this.dialog.addEventListener("close", () => this.dialog.replaceChildren());
  }

  /** @returns Whether the dialog is showing. */
  get isOpen(): boolean {
    return this.dialog.open;
  }

  /** @param request What to submit and how. */
  open(request: ReviewDialogRequest): void {
    if (!this.host.isConnected) document.body.append(this.host);
    const run = ++this.generation;
    const copy = COPY[request.event];
    const form = el("form", { method: "dialog" });
    const dismissing = request.event === "DISMISS";
    const nudging = request.event === "NUDGE";
    // A dismissal needs its reason and a nudge its comment; a review's comment is optional.
    const required = dismissing || nudging;
    const label = el("label", { for: "review-body" }, dismissing ? "Reason" : "Comment ");
    if (!required) label.append(el("span", { class: "optional" }, "(optional)"));
    const body = el("textarea", {
      id: "review-body",
      rows: nudging ? "8" : "6",
      placeholder: dismissing ? "Why the review no longer applies" : "Leave a comment",
      ...(required && { required: "" }),
    });
    if (nudging) body.value = request.body;
    const hint = el("p", { class: "hint", "aria-live": "polite" }, hintFor(request));
    const error = el("p", { class: "error", role: "alert" });
    const cancel = el("button", { type: "button" }, "Cancel");
    const submit = el("button", { type: "submit", class: "submit", "data-event": request.event }, copy.action);
    const blank = () => required && body.value.trim() === "";
    submit.disabled = blank();
    const actions = el("div", { class: "actions" });
    const keys = el("span", { class: "keys" });
    keys.append(el("kbd", {}, "⌘↵"), " to submit · ", el("kbd", {}, "Esc"), " to cancel");
    actions.append(keys, cancel, submit);
    const title = titleFor(request);
    const titleRow = el("div", { class: "title-row" });
    const glyph = el("span", { class: "glyph", "data-event": request.event, "aria-hidden": "true" });
    glyph.append(icon(GLYPH[request.event]));
    titleRow.append(glyph, el("h2", { id: "review-title" }, title));
    form.append(titleRow, label, body, hint, error, actions);
    this.dialog.replaceChildren(form);

    const send = async () => {
      if (submit.disabled || blank()) return;
      error.textContent = "";
      submit.disabled = true;
      cancel.disabled = true;
      submit.textContent = copy.busy;
      form.setAttribute("aria-busy", "true");
      const failure = await request.submit(body.value.trim());
      if (run !== this.generation) return;
      if (failure === null) {
        this.dialog.close();
        return;
      }
      error.textContent = failure;
      submit.disabled = blank();
      cancel.disabled = false;
      submit.textContent = copy.action;
      form.removeAttribute("aria-busy");
    };

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void send();
    });
    body.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      void send();
    });
    cancel.addEventListener("click", () => this.dialog.close());
    body.addEventListener("input", () => {
      if (form.getAttribute("aria-busy") !== "true") submit.disabled = blank();
    });

    if (request.event !== "DISMISS" && request.event !== "NUDGE") void this.showPending(request, hint, run);
    if (!this.dialog.open) this.dialog.showModal();
    body.focus();
    if (nudging) body.setSelectionRange(0, 0);
  }

  private async showPending(request: SubmitRequest, hint: HTMLElement, run: number): Promise<void> {
    let count: number | null;
    try {
      count = await request.pendingComments;
    } catch {
      if (run === this.generation) hint.textContent = "Could not check for pending comments.";
      return;
    }
    if (run !== this.generation) return;
    hint.textContent =
      count === null
        ? "No pending review comments."
        : `Submits your pending review with its ${count} draft ${count === 1 ? "comment" : "comments"}.`;
  }
}
