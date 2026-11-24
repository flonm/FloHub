import { pickByRoll } from "./fun";
import type { PullState } from "./pull-state";

/** Each trick the merge cow knows, with what she says doing it, picked at random each time she performs. */
export const TRICKS = {
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
} as const satisfies Record<string, { lines: readonly [string, ...string[]] }>;

/** A trick the merge cow knows. */
export type CowTrick = keyof typeof TRICKS;

/**
 * @param trick The trick she performs.
 * @param roll A number in [0, 1), like `Math.random()`, that picks the line.
 * @returns What she says doing it.
 */
export function lineFor(trick: CowTrick, roll: number): string {
  return pickByRoll(TRICKS[trick].lines, roll);
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
