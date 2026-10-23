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

/** Choices still on their way: how many places to hold for them, above the rest, and what is being waited for. */
interface PendingChoices {
  count: number;
  status: string;
}

/**
 * What the menu shows: the ways to look at the comment's code, with places held for those that need the comment
 * fetched, or why those are out of reach, beside the ways that aren't.
 */
export type JumpMenuState =
  | { kind: "ready"; choices: JumpChoice[]; pending?: PendingChoices; note?: string }
  | { kind: "failed"; message: string; fallback: () => void; choices?: JumpChoice[] };

const MENU_STYLES = `
:host {
  position: fixed;
  z-index: 2147482000;
  font: 14px/1.5 var(--fontStack-sansSerif, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif);
  color: var(--fgColor-default, #1f2328);
}
.menu {
  position: relative;
  overflow: hidden;
  width: 320px;
  padding: 4px;
  border: 1px solid var(--borderColor-default, #d1d9e0);
  border-radius: 12px;
  background: var(--overlay-bgColor, var(--bgColor-default, #ffffff));
  box-shadow: var(--shadow-floating-large, 0 8px 24px rgba(140, 149, 159, 0.2));
}
.note { margin: 0; padding: 8px 12px; border-top: 1px solid var(--borderColor-muted, #d1d9e0b3); color: var(--fgColor-muted, #59636e); font-size: 12px; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
/* Every choice holds a label and two lines of detail, so a placeholder and the choice that takes its place match. */
button, .placeholder {
  box-sizing: border-box;
  min-height: 69px;
  padding: 6px 12px;
  border-radius: 6px;
}
button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  border: 0;
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

/* While choices are on their way: a thin sweep along the menu's top edge, and a shimmer over their placeholders. */
.menu.waiting::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  width: 40%;
  height: 2px;
  border-radius: 2px;
  background: linear-gradient(90deg, transparent, var(--fgColor-accent, #0969da), transparent);
  animation: sweep 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}
.placeholder { display: flex; flex-direction: column; }
.bar {
  display: block;
  border-radius: 4px;
  background-color: var(--bgColor-neutral-muted, #818b981f);
  background-image: linear-gradient(
    100deg,
    transparent 30%,
    color-mix(in srgb, var(--fgColor-default, #1f2328) 9%, transparent) 50%,
    transparent 70%
  );
  background-size: 300% 100%;
  background-repeat: no-repeat;
  animation: shimmer 1.6s ease-in-out infinite;
  animation-delay: var(--delay, 0s);
}
/* A label line is 21px tall and a detail line 18px, as the text they stand in for. */
.bar.label-bar { height: 13px; margin: 4px 0; }
.bar.detail-bar { height: 9px; margin: 4.5px 0; }
.arrived { animation: arrive 220ms cubic-bezier(0.2, 0, 0, 1) both; animation-delay: var(--delay, 0s); }
@keyframes sweep { from { transform: translateX(-100%); } to { transform: translateX(250%); } }
@keyframes shimmer { from { background-position: 100% 0; } to { background-position: 0 0; } }
@keyframes arrive { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .menu.waiting::before { animation: none; width: 100%; opacity: 0.4; }
  .bar, .arrived { animation: none; }
}
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
  /** How many placeholders the menu shows, for the choices still on their way. */
  private held = 0;

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
    // A choice already on screen keeps the focus when the rest arrive.
    const focused = this.host.shadowRoot?.activeElement?.querySelector(".label")?.textContent;
    this.render(state);
    this.position(anchor);
    const buttons = [...this.menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    (buttons.find((button) => button.querySelector(".label")?.textContent === focused) ?? buttons[0])?.focus();
  }

  close(): void {
    this.release?.();
    this.release = null;
    this.host.remove();
    this.held = 0;
    if (this.anchor instanceof HTMLElement) this.anchor.focus({ preventScroll: true });
    this.anchor = null;
  }

  private render(state: JumpMenuState): void {
    const buttons = (choices: JumpChoice[]) =>
      choices.map((choice) => {
        const item = choiceButton(choice);
        item.addEventListener("click", () => this.close());
        return item;
      });
    const pending = state.kind === "ready" ? state.pending : undefined;
    // Choices fade in where their placeholders stood, once, when they arrive.
    const arriving = this.held;
    this.held = pending?.count ?? 0;
    this.menu.classList.toggle("waiting", pending !== undefined);
    switch (state.kind) {
      case "failed": {
        const fallback = { label: "Use GitHub's link", detail: "GitHub's own jump to the comment", run: state.fallback };
        this.menu.replaceChildren(el("p", { class: "error", role: "alert" }, state.message), ...buttons([fallback, ...(state.choices ?? [])]));
        return;
      }
      case "ready": {
        const items = buttons(state.choices);
        for (const [index, item] of items.slice(0, arriving).entries()) {
          item.classList.add("arrived");
          item.style.setProperty("--delay", `${index * 50}ms`);
        }
        this.menu.replaceChildren(
          ...(pending ? [el("p", { class: "visually-hidden", role: "status" }, pending.status), ...placeholders(pending.count)] : []),
          ...items,
          ...(state.note ? [el("p", { class: "note" }, state.note)] : []),
        );
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

/**
 * @param count How many choices to hold a place for.
 * @returns Placeholders the size of a choice, a label and two lines of detail, shimmering one after the other.
 */
function placeholders(count: number): HTMLElement[] {
  const widths = [
    ["52%", "94%", "58%"],
    ["40%", "88%", "46%"],
  ];
  return Array.from({ length: count }, (_, index) => {
    const [label, first, second] = widths[index % widths.length] ?? [];
    const item = el("div", { class: "placeholder", "aria-hidden": "true" });
    for (const [kind, width] of [["label-bar", label], ["detail-bar", first], ["detail-bar", second]] as const) {
      const bar = el("span", { class: `bar ${kind}` });
      bar.style.width = width ?? "50%";
      bar.style.setProperty("--delay", `${index * 120}ms`);
      item.append(bar);
    }
    return item;
  });
}

function choiceButton(choice: JumpChoice): HTMLButtonElement {
  const item = el("button", { type: "button", role: "menuitem" });
  item.disabled = choice.disabled === true;
  item.append(el("span", { class: "label" }, choice.label), el("span", { class: "detail" }, choice.detail));
  item.addEventListener("click", () => choice.run());
  return item;
}
