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
  const cow = el("pre", { class: "cow" });
  cow.append("            ^__^\n    _______/(", eyes(), ")\n/\\/(       /(__)\n   | w----||\n   ||     ||");
  const body = el("div", { class: "body" });
  body.append(cow);
  return body;
}

/** @returns Her eyes, open, with shut ones lying hidden over them. */
function eyes(): HTMLElement {
  const both = el("span", { class: "eyes" });
  both.append(el("span", { class: "open" }, "oo"), el("span", { class: "shut" }, "--"));
  return both;
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

/** She moonwalks: facing right, she glides from the right edge to the left. */
const backwards: Show = {
  ms: 7000,
  css: `
/* Not plain "backwards", which CSS would read as the fill mode. */
.backwards { animation: backwards-moonwalk var(--show) linear both; }
.backwards .cow { animation: backwards-glide 700ms ease-in-out infinite; }
@keyframes backwards-moonwalk { from { transform: translateX(var(--offstage-right)); } to { transform: translateX(var(--offstage-left)); } }
@keyframes backwards-glide {
  0%, 100% { translate: 0 0; rotate: 0deg; }
  50% { translate: -10px -2px; rotate: -3deg; }
}
`,
  build: (moo) => [actor("backwards", bubble(moo), cowBody())],
};

/** She dashes across in a blur, so fast that her words stay hanging where she passed, then drop. */
const gallop: Show = {
  ms: 2600,
  css: `
.gallop { animation: gallop var(--show) linear both; }
.gallop .body { rotate: 4deg; }
.gallop .cow { animation-duration: 110ms; }
.gallop-moo { left: calc(50vw - 100px); bottom: 104px; animation: gallop-moo var(--show) both; }
@keyframes gallop {
  0% { transform: translateX(var(--offstage-left)); }
  45%, 100% { transform: translateX(var(--offstage-right)); }
}
@keyframes gallop-moo {
  0%, 22% { opacity: 0; transform: none; }
  24%, 65% { opacity: 1; transform: none; }
  100% { opacity: 1; transform: translateY(160px) rotate(25deg); }
}
`,
  build: (moo) => [actor("gallop", cowBody()), actor("gallop-moo", bubble(moo))],
};

/** She walks to the middle, leans in to the viewer, blinks, says her piece and walks on. */
const stare: Show = {
  ms: 7000,
  css: `
.stare { animation: stare var(--show) both; }
.stare .body { transform-origin: 50% 100%; animation: stare-lean var(--show) both; }
.stare .moo { margin-bottom: 18px; animation: stare-moo var(--show) both; }
.stare .open { animation: blink-open var(--show) step-end both; }
.stare .shut { animation: blink-shut var(--show) step-end both; }
@keyframes stare {
  0% { transform: translateX(var(--offstage-left)); animation-timing-function: ease-out; }
  30%, 70% { transform: translateX(calc(50vw - 90px)); animation-timing-function: ease-in; }
  100% { transform: translateX(var(--offstage-right)); }
}
@keyframes stare-lean { 0%, 32%, 68%, 100% { scale: 1; } 38%, 62% { scale: 1.15; } }
@keyframes stare-moo { 0%, 36% { opacity: 0; } 40%, 66% { opacity: 1; } 70%, 100% { opacity: 0; } }
`,
  build: (moo) => [actor("stare", bubble(moo), cowBody())],
};

/** She trips in the middle, lands on her back with her legs in the air, gets up and pretends nothing happened. */
const trip: Show = {
  ms: 7000,
  css: `
.trip { animation: trip var(--show) both; }
.trip .body { transform-origin: 50% 60%; animation: trip-fall var(--show) both; }
.trip .cow { animation: trot 300ms ease-in-out infinite alternate, trip-wiggle var(--show) both; }
.trip .moo { animation: trip-moo var(--show) step-end both; }
@keyframes trip {
  0% { transform: translateX(var(--offstage-left)); }
  40%, 74% { transform: translateX(calc(50vw - 90px)); }
  100% { transform: translateX(var(--offstage-right)); }
}
@keyframes trip-fall {
  0%, 38% { rotate: 0deg; translate: 0 0; }
  42% { rotate: 25deg; translate: 16px 0; }
  48% { rotate: 180deg; translate: 20px -50px; }
  52%, 66% { rotate: 180deg; translate: 20px -8px; }
  72%, 100% { rotate: 360deg; translate: 0 0; }
}
@keyframes trip-wiggle {
  0%, 52%, 66%, 100% { transform: none; }
  54%, 58%, 62% { transform: skewX(8deg); }
  56%, 60%, 64% { transform: skewX(-8deg); }
}
@keyframes trip-moo { 0% { opacity: 0; } 74% { opacity: 1; } }
`,
  build: (moo) => [actor("trip", bubble(moo), cowBody())],
};

/** Only her head rises from the bottom edge; she looks about, says her piece and sinks again. */
const peekaboo: Show = {
  ms: 5000,
  css: `
/* Far enough from the right edge for her longest line. */
.peekaboo { left: min(68vw, calc(100vw - 320px)); bottom: 0; animation: peekaboo var(--show) both; }
.peekaboo .moo { margin-left: 44px; animation: peekaboo-moo var(--show) both; }
.peekaboo .body { transform-origin: 50% 100%; animation: peekaboo-tilt var(--show) ease-in-out both; }
.peekaboo .cow { animation: none; border-bottom: 0; border-radius: 12px 12px 0 0; padding-bottom: 10px; }
.peekaboo .open { animation: blink-open var(--show) step-end both; }
.peekaboo .shut { animation: blink-shut var(--show) step-end both; }
@keyframes peekaboo {
  0%, 100% { transform: translateY(110%); }
  18%, 80% { transform: translateY(0); }
}
@keyframes peekaboo-moo { 0%, 24% { opacity: 0; } 28%, 74% { opacity: 1; } 78%, 100% { opacity: 0; } }
@keyframes peekaboo-tilt { 0%, 26%, 74%, 100% { rotate: 0deg; } 34%, 46% { rotate: -10deg; } 54%, 66% { rotate: 10deg; } }
`,
  build: (moo) => [actor("peekaboo", bubble(moo), cowHead())],
};

/** @returns Only her head, facing the viewer, with eyes that can shut like {@link cowBody}'s. */
function cowHead(): HTMLElement {
  const head = el("pre", { class: "cow" });
  head.append(" ^__^\n (", eyes(), ")\n (__)");
  const body = el("div", { class: "body" });
  body.append(head);
  return body;
}

/** Every show, by the trick it performs. */
export const SHOWS: Record<CowTrick, Show> = { walk, backwards, gallop, stare, trip, peekaboo };
