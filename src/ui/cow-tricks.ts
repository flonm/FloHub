import type { CowTrick } from "../core/cow";
import { el } from "./dom";

/** A show the merge cow puts on: what it puts on the stage, its keyframes, and how long it lasts. */
interface Show {
  /** How long it lasts, in milliseconds, after which the stage is cleared; its CSS reads it as `var(--show)`. */
  ms: number;
  /**
   * The keyframes and rules of this show. Every class and keyframe name it adds starts with the show's own name, since
   * all shows share one style sheet; what they share lives in the stage's styles.
   */
  css: string;
  /** @param moo What she says. @returns The actors, each placed on the full-window stage by its own class. */
  build: (moo: string) => HTMLElement[];
}

/**
 * @returns The cow, facing right, the way she walks. Her eyes can shut: `.eyes .shut` lies over `.eyes .open`, hidden
 *   until a show blinks them. She trots in `.cow`; a show turns, flips or lifts her by `.body` around it, so a pose never
 *   fights the trot.
 */
function cowBody(): HTMLElement {
  const eyes = el("span", { class: "eyes" });
  eyes.append(el("span", { class: "open" }, "oo"), el("span", { class: "shut" }, "--"));
  const cow = el("pre", { class: "cow" });
  cow.append("            ^__^\n    _______/(", eyes, ")\n/\\/(       /(__)\n   | w----||\n   ||     ||");
  const body = el("div", { class: "body" });
  body.append(cow);
  return body;
}

/**
 * @param className The actor's class, which places and moves it.
 * @param parts What the actor is made of, top first.
 * @returns An actor on the stage.
 */
function actor(className: string, ...parts: HTMLElement[]): HTMLElement {
  const element = el("div", { class: `actor ${className}` });
  element.append(...parts);
  return element;
}

/** @param moo What she says. @returns Her speech bubble. */
function bubble(moo: string): HTMLElement {
  return el("div", { class: "moo" }, moo);
}

/** She walks across the bottom of the page, left to right. */
const walk: Show = {
  ms: 6000,
  css: `
.walk { animation: walk var(--show) linear both; }
@keyframes walk { from { transform: translateX(var(--offstage-left)); } to { transform: translateX(var(--offstage-right)); } }
`,
  build: (moo) => [actor("walk", bubble(moo), cowBody())],
};

/** Every show, by the trick it performs. */
export const SHOWS: Record<CowTrick, Show> = { walk };
