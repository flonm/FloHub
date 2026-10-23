import { el, icon, type IconName } from "./dom";

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
  display: flex;
  align-items: flex-start;
  gap: 10px;
  max-width: min(480px, calc(100vw - 32px));
  padding: 8px 14px 8px 10px;
  border: 1px solid var(--borderColor-default, #d1d9e0);
  border-radius: 999px;
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
/* The tone shows as an icon in a tinted circle: a check for success, a cross for a failure, a dot for news. */
.mark { display: flex; flex: none; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; }
.mark svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.mark svg .fill { fill: currentColor; stroke: none; }
.toast[data-tone="success"] .mark { background: var(--bgColor-success-muted, #dafbe1); color: var(--fgColor-success, #1a7f37); }
.toast[data-tone="danger"] { border-radius: 12px; }
.toast[data-tone="danger"] .mark { background: var(--bgColor-danger-muted, #ffebe9); color: var(--fgColor-danger, #d1242f); }
.toast[data-tone="info"] .mark { background: var(--bgColor-accent-muted, #ddf4ff); color: var(--fgColor-accent, #0969da); }
.text { padding-top: 1px; }
@keyframes rise { from { opacity: 0; transform: translateY(6px); } }
@media (prefers-reduced-motion: reduce) { .toast { animation: none; } }
`;

const MARK: Record<ToastTone, IconName> = { info: "dot", success: "check", danger: "cross" };

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
    idle.replaceChildren();
    active.dataset.tone = tone;
    const mark = el("span", { class: "mark", "aria-hidden": "true" });
    mark.append(icon(MARK[tone]));
    active.replaceChildren(mark, el("span", { class: "text" }, text));
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
      this.active?.replaceChildren();
    }, DURATION_MS[tone]);
  }
}
