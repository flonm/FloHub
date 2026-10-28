import { el } from "./dom";

const HINT_STYLES = `
:host {
  position: fixed;
  left: 50%;
  bottom: 72px;
  z-index: 2147483000;
  transform: translateX(-50%);
  font: 13px/1.5 var(--fontStack-sansSerif, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif);
  pointer-events: none;
}
.hint {
  min-width: 240px;
  max-width: min(420px, calc(100vw - 32px));
  padding: 10px 14px 12px;
  border: 1px solid var(--borderColor-default, #d1d9e0);
  border-radius: 12px;
  background: var(--bgColor-default, #ffffff);
  color: var(--fgColor-default, #1f2328);
  box-shadow: var(--shadow-floating-large, 0 8px 24px rgba(140, 149, 159, 0.2));
  animation: rise 140ms ease-out;
}
.head { display: flex; align-items: center; gap: 6px; margin: 0 0 8px; color: var(--fgColor-muted, #59636e); }
.head .esc { margin-left: auto; font-size: 12px; }
dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 10px; align-items: baseline; margin: 0; }
dt { justify-self: start; }
dd { margin: 0; }
kbd {
  display: inline-block;
  min-width: 20px;
  padding: 1px 6px;
  border: 1px solid var(--borderColor-default, #d1d9e0);
  border-bottom-width: 2px;
  border-radius: 6px;
  background: var(--bgColor-muted, #f6f8fa);
  color: var(--fgColor-default, #1f2328);
  font: 12px/1.5 var(--fontStack-monospace, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  text-align: center;
}
@keyframes rise { from { opacity: 0; transform: translateY(6px); } }
@media (prefers-reduced-motion: reduce) { .hint { animation: none; } }
`;

/** What may follow the first key of a chord: the second key and what it does. */
export interface ChordChoice {
  key: string;
  action: string;
}

/**
 * The hint that shows, after a pause, what may follow the first key of a chord, as Graphite's does. It only shows:
 * the keys themselves go to the shortcut matcher.
 */
export class ChordHint {
  private readonly host: HTMLElement;
  private readonly panel: HTMLElement;

  constructor() {
    this.host = document.createElement("flohub-chord-hint");
    const shadow = this.host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = HINT_STYLES;
    this.panel = el("div", { class: "hint", role: "status" });
    shadow.append(style, this.panel);
  }

  /** @returns Whether the hint is on screen. */
  get isOpen(): boolean {
    return this.host.isConnected;
  }

  /**
   * @param first The chord's first key, as the shortcut list names it.
   * @param choices What may follow.
   */
  show(first: string, choices: readonly ChordChoice[]): void {
    const head = el("p", { class: "head" });
    head.append(el("kbd", {}, first), "then…", el("span", { class: "esc" }, "Esc cancels"));
    const list = el("dl");
    for (const choice of choices) {
      const key = el("dt");
      key.append(el("kbd", {}, choice.key));
      list.append(key, el("dd", {}, choice.action));
    }
    this.panel.replaceChildren(head, list);
    if (!this.host.isConnected) document.body.append(this.host);
  }

  hide(): void {
    this.host.remove();
  }
}
