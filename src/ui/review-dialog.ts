import { el } from "./dom";
import type { ReviewEvent } from "../core/shortcuts";

export interface ReviewDialogRequest {
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

const COPY: Record<ReviewEvent, { title: string; action: string; busy: string }> = {
  APPROVE: { title: "Approve", action: "Approve", busy: "Approving…" },
  REQUEST_CHANGES: { title: "Request changes on", action: "Request changes", busy: "Requesting changes…" },
};

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
button.submit[data-event="REQUEST_CHANGES"] { border-color: transparent; background: var(--rd-changes-bg); color: var(--rd-changes-fg); }
button:disabled { cursor: not-allowed; opacity: 0.6; }
:focus-visible { outline: 2px solid var(--rd-focus); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { dialog[open] { animation: none; } }
`;

/** A modal for approving or requesting changes with a comment, submitting any pending review. */
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
    const label = el("label", { for: "review-body" }, "Comment ");
    label.append(el("span", { class: "optional" }, "(optional)"));
    const body = el("textarea", { id: "review-body", rows: "6", placeholder: "Leave a comment" });
    const hint = el("p", { class: "hint", "aria-live": "polite" }, "Checking for pending comments…");
    const error = el("p", { class: "error", role: "alert" });
    const cancel = el("button", { type: "button" }, "Cancel");
    const submit = el("button", { type: "submit", class: "submit", "data-event": request.event }, copy.action);
    const actions = el("div", { class: "actions" });
    actions.append(el("span", { class: "keys" }, "⌘↵ to submit · Esc to cancel"), cancel, submit);
    form.append(el("h2", { id: "review-title" }, `${copy.title} #${request.number}`), label, body, hint, error, actions);
    this.dialog.replaceChildren(form);

    const send = async () => {
      if (submit.disabled) return;
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
      submit.disabled = false;
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

    void (async () => {
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
    })();

    if (!this.dialog.open) this.dialog.showModal();
    body.focus();
  }
}
