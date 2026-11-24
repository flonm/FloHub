import { pickByRoll } from "./fun";
import type { PullState } from "./pull-state";

/**
 * Each trick the merge cow knows: the lines she says doing it, one picked at random each time, and its weight, how
 * often a random pick lands on it next to the others, 1 unless it says otherwise.
 */
export const TRICKS = tricks({
  walk: {
    lines: [
      "Moo. Merged.",
      "MOOOOO-RGED!",
      "Another one for main.",
      "Ship it. Moo.",
      "I have seen your diff. It is good.",
      "Leader of the herd, you know her well.",
      "Finally back to kick some tail.",
    ],
  },
  backwards: {
    lines: ["Smooth criminal. Smooth merge.", "Reverting… just kidding.", "git reset --hard? Never heard of her.", "Moonwalked it into main."],
  },
  gallop: {
    lines: ["MOOOOOOOOOO—", "Gotta go fast.", "Faster than your CI.", "Can't stop, shipping."],
  },
  stare: {
    lines: ["…", "I know what you merged.", "Did you write tests? Moo.", "I'm watching you. Good merge."],
  },
  trip: {
    lines: ["Nobody saw that.", "I meant to do that.", "Flaky test, flaky legs.", "Still merged, though."],
  },
  peekaboo: {
    lines: ["Psst. Merged.", "Moo-ve along, nothing to see.", "Peekaboo!", "Don't mind me."],
  },
});

/** What the merge cow says doing a trick, and how often a random pick lands on it. */
interface Trick {
  lines: readonly [string, ...string[]];
  weight?: number;
}

/** @param table The tricks by name. @returns The same table, its names kept as a type and its tricks checked. */
function tricks<Name extends string>(table: Record<Name, Trick>): Record<Name, Trick> {
  return table;
}

/** A trick the merge cow knows. */
export type CowTrick = keyof typeof TRICKS;

/** Every trick's name, in the order {@link TRICKS} lists them. */
export const TRICK_NAMES = Object.keys(TRICKS) as CowTrick[];

/**
 * @param trick The trick she performs.
 * @param roll A number in [0, 1), like `Math.random()`, that picks the line.
 * @returns What she says doing it.
 */
export function lineFor(trick: CowTrick, roll: number): string {
  return pickByRoll(TRICKS[trick].lines, roll);
}

/**
 * @param previous The trick she performed last time, which a random pick never repeats.
 * @param roll A number in [0, 1), like `Math.random()`, that picks the trick.
 * @returns A trick picked at random by the weights.
 */
export function pickTrick(previous: CowTrick | undefined, roll: number): CowTrick {
  const candidates = TRICK_NAMES.filter((trick) => trick !== previous);
  const weights = candidates.map((trick) => TRICKS[trick].weight ?? 1);
  let left = Math.min(Math.max(roll, 0), 1 - Number.EPSILON) * weights.reduce((sum, weight) => sum + weight, 0);
  for (const [index, trick] of candidates.entries()) {
    left -= weights[index] ?? 0;
    if (left < 0) return trick;
  }
  return candidates.at(-1) ?? "walk";
}

/**
 * @param previous The pull request's state last time the bar drew it, or undefined before it knew one.
 * @param next Its state now.
 * @returns Whether the viewer just watched it get merged, which is the merge cow's cue. Opening a pull request that was
 *   merged long ago is no cue: the cow only comes for news.
 */
export function cowDue(previous: PullState | undefined, next: PullState | undefined): boolean {
  return previous !== undefined && previous !== "merged" && next === "merged";
}
