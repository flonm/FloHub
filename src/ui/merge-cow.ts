import { type CowTrick, lineFor } from "../core/cow";
import { SHOWS } from "./cow-tricks";

/** What every show shares: the stage over the whole window, the bubble, the cow and her trot. */
const STAGE_STYLES = `
:host {
  position: fixed;
  inset: 0;
  z-index: 2147483001;
  overflow: hidden;
  pointer-events: none;
}
.stage { position: absolute; inset: 0; }
.actor {
  position: absolute;
  bottom: 16px;
  left: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
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
.eyes { position: relative; }
.eyes .shut { position: absolute; inset: 0; opacity: 0; }
@keyframes trot { from { translate: 0 0; } to { translate: 0 -3px; } }
`;

/**
 * The merge cow: she performs a trick across the page when the viewer watches a pull request get merged. Every show
 * plays for everyone, reduced motion or not: she is a few seconds of decoration the viewer opted into with fun mode.
 */
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
    style.textContent = [STAGE_STYLES, ...Object.values(SHOWS).map((show) => show.css)].join("\n");
    this.shadow.append(style);
  }

  /**
   * Puts a show on the stage, without clearing it afterwards. {@link perform} is what the extension uses.
   * @param trick The trick she performs.
   * @param moo What she says.
   * @param moment Where in the show to hold it still, from 0 at its start to 1 at its end, as a story pictures her;
   *   left out, the show plays.
   * @returns How long the show lasts, in milliseconds.
   */
  render(trick: CowTrick, moo: string, moment?: number): number {
    if (!this.host.isConnected) document.body.append(this.host);
    const show = SHOWS[trick];
    const stage = document.createElement("div");
    stage.className = "stage";
    stage.append(...show.build(moo));
    this.shadow.querySelector(".stage")?.remove();
    this.shadow.append(stage);
    if (moment !== undefined) {
      const animations = stage.getAnimations({ subtree: true });
      for (const animation of animations) {
        animation.pause();
        animation.currentTime = moment * show.ms;
      }
    }
    return show.ms;
  }

  /**
   * @param trick The trick she performs.
   * @param roll A number in [0, 1), like `Math.random()`, that picks what she says.
   */
  perform(trick: CowTrick, roll = Math.random()): void {
    const ms = this.render(trick, lineFor(trick, roll));
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.host.remove(), ms);
  }
}
