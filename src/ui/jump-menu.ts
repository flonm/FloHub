import { el } from "./dom";

/** One way to look at the code a review comment is on. */
export interface JumpChoice {
  label: string;
  /** What the choice shows, in a line below its label. */
  detail: string;
  /** Leaves the choice out of reach, with the detail saying why. */
  disabled?: boolean;
  run: () => void;
}

/** What the menu shows: a wait for the comment, the ways to look at its code, or why there are none. */
export type JumpMenuState =
  | { kind: "loading" }
  | { kind: "ready"; choices: JumpChoice[]; note?: string }
  | { kind: "failed"; message: string; fallback: () => void };

const MENU_STYLES = `
:host {
  position: fixed;
  z-index: 2147482000;
  font: 14px/1.5 var(--fontStack-sansSerif, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif);
  color: var(--fgColor-default, #1f2328);
}
.menu {
  width: 320px;
  padding: 4px;
  border: 1px solid var(--borderColor-default, #d1d9e0);
  border-radius: 12px;
  background: var(--overlay-bgColor, var(--bgColor-default, #ffffff));
  box-shadow: var(--shadow-floating-large, 0 8px 24px rgba(140, 149, 159, 0.2));
}
.status, .note { margin: 0; padding: 8px 12px; color: var(--fgColor-muted, #59636e); font-size: 12px; }
.note { border-top: 1px solid var(--borderColor-muted, #d1d9e0b3); }
button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  padding: 6px 12px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
button:hover:not(:disabled), button:focus-visible { background: var(--control-transparent-bgColor-hover, #818b981a); }
button:focus-visible { outline: 2px solid var(--focus-outlineColor, #0969da); outline-offset: -2px; }
button:disabled { cursor: default; color: var(--fgColor-disabled, #818b98); }
.label { font-weight: 600; }
.detail { color: var(--fgColor-muted, #59636e); font-size: 12px; }
button:disabled .detail { color: inherit; }
.error { margin: 0; padding: 8px 12px; color: var(--fgColor-danger, #d1242f); }
`;

/**
 * A small menu beside a review comment's link to its code, offering the versions view's ways to see that code in
 * place of GitHub's own jump. It closes on a choice, Escape, or a click elsewhere.
 */
export class JumpMenu {
  readonly host: HTMLElement;
  private readonly menu: HTMLElement;
  private anchor: Element | null = null;
  private release: (() => void) | null = null;

  constructor() {
    this.host = document.createElement("flohub-jump-menu");
    const shadow = this.host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = MENU_STYLES;
    this.menu = el("div", { class: "menu", role: "menu", "aria-label": "Show the code" });
    shadow.append(style, this.menu);
    for (const type of ["keydown", "keyup", "keypress"]) shadow.addEventListener(type, (event) => event.stopPropagation());
    shadow.addEventListener("keydown", (event) => this.onKey(event as KeyboardEvent));
  }

  /** @returns The element the menu opened from, while it is open. */
  get openedFrom(): Element | null {
    return this.host.isConnected ? this.anchor : null;
  }

  /**
   * @param anchor The link the menu opens from.
   * @param state What the menu shows.
   */
  open(anchor: Element, state: JumpMenuState): void {
    if (this.anchor !== anchor || !this.host.isConnected) {
      this.close();
      this.anchor = anchor;
      document.body.append(this.host);
      const outside = (event: Event) => {
        if (!event.composedPath().includes(this.host)) this.close();
      };
      addEventListener("pointerdown", outside, true);
      this.release = () => removeEventListener("pointerdown", outside, true);
    }
    this.render(state);
    this.position(anchor);
    this.menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }

  close(): void {
    this.release?.();
    this.release = null;
    this.host.remove();
    if (this.anchor instanceof HTMLElement) this.anchor.focus({ preventScroll: true });
    this.anchor = null;
  }

  private render(state: JumpMenuState): void {
    switch (state.kind) {
      case "loading": {
        this.menu.replaceChildren(el("p", { class: "status", role: "status" }, "Finding the version the comment was written on…"));
        return;
      }
      case "failed": {
        const fallback = choiceButton({ label: "Use GitHub's link", detail: "GitHub's own jump to the comment", run: state.fallback });
        fallback.addEventListener("click", () => this.close());
        this.menu.replaceChildren(el("p", { class: "error", role: "alert" }, state.message), fallback);
        return;
      }
      case "ready": {
        const buttons = state.choices.map((choice) => {
          const item = choiceButton(choice);
          item.addEventListener("click", () => this.close());
          return item;
        });
        this.menu.replaceChildren(...buttons, ...(state.note ? [el("p", { class: "note" }, state.note)] : []));
      }
    }
  }

  /** Puts the menu under its link, kept inside the window. */
  private position(anchor: Element): void {
    const box = anchor.getBoundingClientRect();
    const width = this.menu.offsetWidth > 0 ? this.menu.offsetWidth : 320;
    this.host.style.left = `${Math.max(8, Math.min(box.left, innerWidth - width - 8))}px`;
    const below = box.bottom + 4;
    const height = this.menu.offsetHeight;
    this.host.style.top = `${below + height > innerHeight - 8 ? Math.max(8, box.top - height - 4) : below}px`;
  }

  private onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [...this.menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const at = items.indexOf(this.host.shadowRoot?.activeElement as HTMLButtonElement);
    const next = items[(at + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length];
    next?.focus();
  }
}

function choiceButton(choice: JumpChoice): HTMLButtonElement {
  const item = el("button", { type: "button", role: "menuitem" });
  item.disabled = choice.disabled === true;
  item.append(el("span", { class: "label" }, choice.label), el("span", { class: "detail" }, choice.detail));
  item.addEventListener("click", () => choice.run());
  return item;
}
