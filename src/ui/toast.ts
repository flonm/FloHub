import { el } from "./dom";

export type ToastTone = "info" | "success" | "danger";

const TOAST_STYLES = `
:host {
  position: fixed;
  left: 50%;
  bottom: 24px;
  z-index: 2147483000;
  transform: translateX(-50%);
  font: 14px/1.5 var(--fontStack-sansSerif, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif);
  pointer-events: none;
}
.toast {
  max-width: min(480px, calc(100vw - 32px));
  padding: 8px 16px;
  border: 1px solid var(--borderColor-default, #d1d9e0);
  border-left-width: 4px;
  border-radius: 8px;
  background: var(--bgColor-default, #ffffff);
  color: var(--fgColor-default, #1f2328);
  box-shadow: var(--shadow-floating-large, 0 8px 24px rgba(140, 149, 159, 0.2));
  animation: rise 140ms ease-out;
}
.toast:empty {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  border: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  animation: none;
}
.toast[data-tone="success"] { border-left-color: var(--fgColor-success, #1a7f37); }
.toast[data-tone="danger"] { border-left-color: var(--fgColor-danger, #d1242f); }
.toast[data-tone="info"] { border-left-color: var(--fgColor-accent, #0969da); }
@keyframes rise { from { opacity: 0; transform: translateY(6px); } }
@media (prefers-reduced-motion: reduce) { .toast { animation: none; } }
`;

const DURATION_MS: Record<ToastTone, number> = { info: 4000, success: 4000, danger: 8000 };

/** A short message at the bottom of the page, announced politely, or assertively for errors. */
export class Toast {
  private readonly host: HTMLElement;
  private readonly polite: HTMLElement;
  private readonly assertive: HTMLElement;
  private active: HTMLElement | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.host = document.createElement("flohub-toast");
    const shadow = this.host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = TOAST_STYLES;
    this.polite = el("div", { class: "toast", role: "status" });
    this.assertive = el("div", { class: "toast", role: "alert" });
    shadow.append(style, this.polite, this.assertive);
  }

  /**
   * Paints the message, without scheduling its removal. {@link show} is what the extension uses.
   * @param text The message.
   * @param tone Info and success are announced politely, danger interrupts.
   */
  render(text: string, tone: ToastTone): void {
    if (!this.host.isConnected) document.body.append(this.host);
    const [active, idle] = tone === "danger" ? [this.assertive, this.polite] : [this.polite, this.assertive];
    idle.textContent = "";
    active.dataset.tone = tone;
    active.textContent = text;
    this.active = active;
  }

  /**
   * @param text The message.
   * @param tone Info and success are announced politely, danger interrupts.
   */
  show(text: string, tone: ToastTone): void {
    this.render(text, tone);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.active) this.active.textContent = "";
    }, DURATION_MS[tone]);
  }
}
