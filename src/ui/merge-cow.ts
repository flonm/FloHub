import { el } from "./dom";

/** The cow, facing right, the way she walks. */
const COW = String.raw`            ^__^
    _______/(oo)
/\/(       /(__)
   | w----||
   ||     ||`;

/** What she says, picked at random each time she crosses. */
export const MOOS = [
  "Moo. Merged.",
  "MOOOOO-RGED!",
  "Another one for main.",
  "Ship it. Moo.",
  "I have seen your diff. It is good.",
  "Leader of the herd, you know her well.",
  "Finally back to kick some tail.",
] as const;

/** How long one crossing takes, in milliseconds. */
const CROSSING_MS = 6000;

const COW_STYLES = `
:host {
  position: fixed;
  inset: auto 0 16px 0;
  z-index: 2147483001;
  height: 140px;
  overflow: hidden;
  pointer-events: none;
}
.herd {
  position: absolute;
  bottom: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  animation: cross var(--crossing, 6000ms) linear forwards;
}
/* Only a story stands her still; she walks for everyone, reduced motion or not. */
.herd.still { animation: none; left: 50%; transform: translateX(-50%); }
.moo {
  margin: 0 0 4px 64px;
  padding: 4px 10px;
  border: 1px solid var(--borderColor-default, #d1d9e0);
  border-radius: 12px;
  background: var(--bgColor-default, #ffffff);
  color: var(--fgColor-default, #1f2328);
  font: 600 13px/1.4 var(--fontStack-sansSerif, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif);
  white-space: nowrap;
  box-shadow: var(--shadow-floating-small, 0 1px 3px rgba(31, 35, 40, 0.12));
}
.cow {
  margin: 0;
  padding: 6px 12px;
  border: 1px solid var(--borderColor-default, #d1d9e0);
  border-radius: 12px;
  background: var(--bgColor-default, #ffffff);
  box-shadow: var(--shadow-floating-small, 0 1px 3px rgba(31, 35, 40, 0.12));
  color: var(--fgColor-default, #1f2328);
  font: 12px/1.15 var(--fontStack-monospace, ui-monospace, SFMono-Regular, Menlo, monospace);
  animation: trot 300ms ease-in-out infinite alternate;
}
.herd.still .cow { animation: none; }
@keyframes cross { from { transform: translateX(-260px); } to { transform: translateX(calc(100vw + 20px)); } }
@keyframes trot { from { transform: translateY(0); } to { transform: translateY(-3px); } }
`;

/** The merge cow: she walks across the bottom of the page when the viewer watches a pull request get merged. */
export class MergeCow {
  private readonly host: HTMLElement;
  private readonly shadow: ShadowRoot;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.host = document.createElement("flohub-merge-cow");
    // She is decoration; the toast that comes with her says the news in words.
    this.host.setAttribute("aria-hidden", "true");
    this.shadow = this.host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = COW_STYLES;
    this.shadow.append(style);
  }

  /**
   * Paints the cow, without sending her on her way. {@link cross} is what the extension uses.
   * @param moo What she says.
   * @param still Whether she stands in the middle instead of walking, as a story pictures her.
   */
  render(moo: string, still = false): void {
    if (!this.host.isConnected) document.body.append(this.host);
    const herd = el("div", { class: still ? "herd still" : "herd" });
    herd.style.setProperty("--crossing", `${CROSSING_MS}ms`);
    herd.append(el("div", { class: "moo" }, moo), el("pre", { class: "cow" }, COW));
    this.shadow.querySelector(".herd")?.remove();
    this.shadow.append(herd);
  }

  /** @param roll A number in [0, 1), like `Math.random()`, that picks what she says. */
  cross(roll = Math.random()): void {
    this.render(MOOS[Math.min(MOOS.length - 1, Math.floor(roll * MOOS.length))] ?? MOOS[0]);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.host.remove(), CROSSING_MS);
  }
}
