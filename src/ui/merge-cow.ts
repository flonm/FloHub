import { conflictLinesFor, type CowSetting, type CowTrick, lineFor, pickTrick } from "../core/cow";
import { type ShowLines, type ShowName, SHOWS } from "./cow-tricks";

/**
 * What every show shares: the stage over the whole window, the bubble, the cow, her trot and her ASCII props. A show
 * reads its own length as `var(--show)`, and the spots just off either edge as `--offstage-left` and
 * `--offstage-right`.
 */
const STAGE_STYLES = `
:host {
  --offstage-left: -260px;
  --offstage-right: calc(100vw + 20px);
  position: fixed;
  inset: 0;
  z-index: 2147483001;
  overflow: hidden;
  pointer-events: none;
}
pre {
  margin: 0;
  color: var(--fgColor-default, #1f2328);
  font: 12px/1.15 var(--fontStack-monospace, ui-monospace, SFMono-Regular, Menlo, monospace);
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
  padding: 6px 12px;
  border: 1px solid var(--borderColor-default, #d1d9e0);
  border-radius: 12px;
  background: var(--bgColor-default, #ffffff);
  box-shadow: var(--shadow-floating-small, 0 1px 3px rgba(31, 35, 40, 0.12));
  animation: trot 300ms ease-in-out infinite alternate;
}
.eyes { position: relative; }
.eyes .shut { position: absolute; inset: 0; opacity: 0; }
@keyframes trot { from { translate: 0 0; } to { translate: 0 -3px; } }
/* Two blinks a little before and after the middle of a show, for her eyes to run over its length. */
@keyframes blink-open { 0% { opacity: 1; } 42% { opacity: 0; } 44% { opacity: 1; } 54% { opacity: 0; } 56% { opacity: 1; } }
@keyframes blink-shut { 0% { opacity: 0; } 42% { opacity: 1; } 44% { opacity: 0; } 54% { opacity: 1; } 56% { opacity: 0; } }
`;

/**
 * The merge cow: she performs a trick across the page when the viewer watches a pull request join the merge queue or
 * get merged. Every show plays for everyone, reduced motion or not: she is a few seconds of decoration the viewer opted
 * into with fun mode.
 */
export class MergeCow {
  private readonly host: HTMLElement;
  private readonly shadow: ShadowRoot;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** The trick she performed last, which she doesn't repeat. */
  private last: CowTrick | undefined;

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
   * Puts a show on the stage, without clearing it afterwards. {@link perform} and {@link conflict} are what the
   * extension uses.
   * @param name The show.
   * @param lines What the cows in it say.
   * @param moment Where in the show to hold it still, from 0 at its start to 1 at its end, as a story pictures her;
   *   left out, the show plays.
   * @returns How long the show lasts, in milliseconds.
   */
  render<Name extends ShowName>(name: Name, lines: ShowLines<Name>, moment?: number): number {
    if (!this.host.isConnected) document.body.append(this.host);
    const show = SHOWS[name];
    // The lines fit the show by its name; TypeScript can't follow a generic key into the table.
    const build = show.build as (...lines: ShowLines<Name>) => HTMLElement[];
    const stage = document.createElement("div");
    stage.className = "stage";
    stage.style.setProperty("--show", `${show.ms}ms`);
    stage.append(...build(...lines));
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

  /** @param setting The trick she performs, or random for one picked at random, never the one she did last time. */
  perform(setting: CowSetting): void {
    const trick = pickTrick(setting, this.last, Math.random());
    const ms = this.render(trick, [lineFor(trick, Math.random())]);
    this.last = trick;
    this.play(ms);
  }

  /** Two cows lock horns over a merge conflict. */
  conflict(): void {
    const ms = this.render("conflict", conflictLinesFor(Math.random()));
    this.play(ms);
  }

  /** Ends the show on stage, as when the viewer leaves the pull request it was for. */
  stop(): void {
    clearTimeout(this.timer);
    this.host.remove();
  }

  /** @param ms How long the show on stage lasts, after which she leaves. */
  private play(ms: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.host.remove(), ms);
  }
}
