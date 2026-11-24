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

/** She dashes across in a blur, so fast that her words can't keep up: they drag along behind her, tilted back. */
const gallop: Show = {
  ms: 1700,
  css: `
.gallop { animation: gallop var(--show) linear both; }
.gallop .body { rotate: 4deg; }
.gallop .cow { animation-duration: 110ms; }
/* Pulled by its front edge, the bubble leans back and only slowly gathers speed. */
.gallop-moo { bottom: 96px; transform-origin: 100% 50%; animation: gallop-moo var(--show) both, gallop-drag var(--show) ease-out both; }
@keyframes gallop {
  0% { transform: translateX(var(--offstage-left)); }
  67%, 100% { transform: translateX(var(--offstage-right)); }
}
@keyframes gallop-moo {
  0%, 5% { transform: translateX(var(--offstage-left)); animation-timing-function: cubic-bezier(0.35, 0, 0.6, 1); }
  100% { transform: translateX(var(--offstage-right)); }
}
@keyframes gallop-drag {
  0%, 5% { rotate: 0deg; }
  20% { rotate: -12deg; }
  50% { rotate: -6deg; }
  75% { rotate: -9deg; }
  100% { rotate: -5deg; }
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

/** How many cows run in the stampede, the last one lagging behind and talking. */
const HERD = 7;

/** A herd of small cows thunders past; the last one is out of breath, well behind, and has the last word. */
const stampede: Show = {
  ms: 6600,
  css: `
.stampede { animation: stampede 2000ms linear both; }
.stampede .cow { font-size: 7px; padding: 3px 6px; animation-duration: 150ms; }
.stampede:nth-child(2) { bottom: 54px; animation-delay: 250ms; }
.stampede:nth-child(3) { bottom: 30px; animation-delay: 400ms; }
.stampede:nth-child(4) { bottom: 66px; animation-delay: 650ms; }
.stampede:nth-child(5) { bottom: 22px; animation-delay: 800ms; }
.stampede:nth-child(6) { bottom: 44px; animation-delay: 1050ms; }
.stampede.last { bottom: 16px; animation: stampede 4300ms linear 2300ms both; }
.stampede.last .cow { animation-duration: 450ms; }
.stampede.last .moo { margin-left: 24px; }
@keyframes stampede { from { transform: translateX(-160px); } to { transform: translateX(calc(100vw + 20px)); } }
`,
  build: (moo) => [
    ...Array.from({ length: HERD - 1 }, () => actor("stampede", cowBody())),
    actor("stampede last", bubble(moo), cowBody()),
  ],
};

/** She walks to the middle, a UFO beams her up and flies off with her. */
const abduction: Show = {
  ms: 8000,
  css: `
.abduction { transform-origin: 50% 50%; animation: abduction 8000ms both; }
.abduction .moo { animation: abduction-moo 8000ms step-end both; }
.abduction-ufo { top: 0; bottom: auto; left: calc(50vw - 100px); animation: abduction-ufo 8000ms both; }
.abduction-beam {
  top: calc(12vh + 70px);
  left: calc(50vw - 110px);
  width: 220px;
  background: linear-gradient(var(--bgColor-attention-emphasis, #9a6700), transparent);
  clip-path: polygon(38% 0, 62% 0, 100% 100%, 0 100%);
  animation: abduction-beam 8000ms both;
}
.ufo { margin: 0; color: var(--fgColor-default, #1f2328); font: 12px/1.15 var(--fontStack-monospace, ui-monospace, SFMono-Regular, Menlo, monospace); }
@keyframes abduction {
  0% { transform: translateX(-260px); opacity: 1; animation-timing-function: ease-out; }
  30%, 48% { transform: translateX(calc(50vw - 90px)); opacity: 1; animation-timing-function: ease-in; }
  80% { transform: translate(calc(50vw - 90px), calc(-88vh + 150px)) scale(0.25); opacity: 1; }
  82%, 100% { transform: translate(calc(50vw - 90px), calc(-88vh + 150px)) scale(0.25); opacity: 0; }
}
@keyframes abduction-moo { 0% { opacity: 0; } 46% { opacity: 1; } }
@keyframes abduction-ufo {
  0%, 30% { transform: translateY(-200px); animation-timing-function: ease-out; }
  40%, 84% { transform: translateY(12vh); animation-timing-function: ease-in; }
  100% { transform: translate(70vw, -40vh); }
}
@keyframes abduction-beam { 0%, 42% { opacity: 0; } 46%, 80% { opacity: 0.45; } 84%, 100% { opacity: 0; } }
`,
  build: (moo) => [
    actor("abduction-beam"),
    actor("abduction", bubble(moo), cowBody()),
    actor("abduction-ufo", el("pre", { class: "ufo" }, UFO)),
  ],
};

const UFO = String.raw`           .-=-.
      _.--'_____'--._
    .'  o    o    o  '.
   (_____________________)
        '-.________.-'`;

/** She rolls in on a skateboard, kickflips in the middle and rolls off. */
const skateboard: Show = {
  ms: 5000,
  css: `
.skateboard { animation: skateboard 5000ms linear both; }
.skateboard .moo { animation: skateboard-moo 5000ms step-end both; }
.skateboard .body { animation: skateboard-jump 5000ms ease-in-out both; }
.skateboard .cow { animation: none; rotate: -3deg; }
.board { margin: -2px 0 0 10px; color: var(--fgColor-default, #1f2328); font: 12px/1.15 var(--fontStack-monospace, ui-monospace, SFMono-Regular, Menlo, monospace); }
.skateboard .board { animation: skateboard-flip 5000ms linear both; }
@keyframes skateboard { from { transform: translateX(-260px); } to { transform: translateX(calc(100vw + 20px)); } }
@keyframes skateboard-moo { 0% { opacity: 0; } 58% { opacity: 1; } }
@keyframes skateboard-jump { 0%, 44% { translate: 0 0; } 51% { translate: 0 -70px; } 58%, 100% { translate: 0 0; } }
@keyframes skateboard-flip { 0%, 46% { rotate: x 0deg; } 56%, 100% { rotate: x 360deg; } }
`,
  build: (moo) => {
    const body = cowBody();
    body.append(el("pre", { class: "board" }, BOARD));
    return [actor("skateboard", bubble(moo), body)];
  },
};

const BOARD = String.raw`\______________/
   O        O`;

/** She drifts down from the top under a parachute, lands, drops it and walks off. */
const parachute: Show = {
  ms: 7000,
  css: `
.parachute { transform-origin: 50% 0; animation: parachute 7000ms both, parachute-sway 7000ms ease-in-out both; }
/* Beside her rather than above, so the strings reach her. */
.parachute .moo { position: absolute; left: 100%; bottom: 60px; margin: 0; animation: parachute-moo 7000ms step-end both; }
.canopy {
  margin: 0;
  color: var(--fgColor-danger, #d1242f);
  font: 12px/1.15 var(--fontStack-monospace, ui-monospace, SFMono-Regular, Menlo, monospace);
  animation: parachute-canopy 7000ms both;
}
@keyframes parachute {
  0% { transform: translate(30vw, -100vh); }
  55%, 64% { transform: translate(30vw, 0); }
  100% { transform: translate(calc(100vw + 20px), 0); }
}
@keyframes parachute-sway {
  0%, 30% { rotate: -8deg; }
  15%, 45% { rotate: 8deg; }
  55%, 100% { rotate: 0deg; }
}
@keyframes parachute-canopy {
  0%, 57% { opacity: 1; transform: none; }
  66%, 100% { opacity: 0; transform: translate(-30px, -20px) rotate(-25deg); }
}
@keyframes parachute-moo { 0% { opacity: 0; } 64% { opacity: 1; } }
`,
  build: (moo) => [actor("parachute", el("pre", { class: "canopy" }, CANOPY), bubble(moo), cowBody())],
};

const CANOPY = String.raw`      ___.-----.___
   .-'  /   |   \  '-.
  /____/____|____\____\
  \                   /
    \               /
      \           /`;

/** A fence stands in the middle of the page and she jumps it. */
const fence: Show = {
  ms: 6000,
  css: `
/* She jumps with her bubble, which would vanish behind her otherwise. */
.fence { animation: fence 6000ms linear both, fence-jump 6000ms ease-in-out both; }
.fence .moo { animation: fence-moo 6000ms step-end both; }
.fence-post { left: calc(50vw - 30px); }
.rail { margin: 0; color: var(--fgColor-default, #1f2328); font: 12px/1.15 var(--fontStack-monospace, ui-monospace, SFMono-Regular, Menlo, monospace); }
@keyframes fence {
  0% { transform: translateX(-260px); }
  38% { transform: translateX(calc(50vw - 230px)); }
  62% { transform: translateX(calc(50vw + 70px)); }
  100% { transform: translateX(calc(100vw + 20px)); }
}
@keyframes fence-jump {
  0%, 38%, 62%, 100% { translate: 0 0; rotate: 0deg; }
  44% { translate: 0 -70px; rotate: -10deg; }
  50% { translate: 0 -90px; rotate: 0deg; }
  56% { translate: 0 -70px; rotate: 10deg; }
}
@keyframes fence-moo { 0% { opacity: 0; } 40% { opacity: 1; } }
`,
  build: (moo) => [actor("fence-post", el("pre", { class: "rail" }, "|=|=|=|=|\n| | | | |\n| | | | |")), actor("fence", bubble(moo), cowBody())],
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
export const SHOWS: Record<CowTrick, Show> = { walk, backwards, gallop, stare, trip, peekaboo, stampede, abduction, skateboard, parachute, fence };
