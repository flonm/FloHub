import { pickByRoll } from "./fun";
import type { PullState } from "./pull-state";

/**
 * Each trick the merge cow knows, in the order the options page lists them: its name there, the lines she says doing
 * it, one picked at random each time, and its weight, how often a random pick lands on it next to the others, 1 unless
 * it says otherwise.
 */
export const TRICKS = tricks({
  walk: {
    label: "Walk across",
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
    label: "Moonwalk backwards",
    lines: ["Smooth criminal. Smooth merge.", "Reverting… just kidding.", "git reset --hard? Never heard of her.", "Moonwalked it into main."],
  },
  gallop: {
    label: "Gallop past",
    lines: ["MOOOOOOOOOO—", "Gotta go fast.", "Faster than your CI.", "Can't stop, shipping."],
  },
  stare: {
    label: "Stop and stare",
    lines: ["…", "I know what you merged.", "Did you write tests? Moo.", "I'm watching you. Good merge."],
  },
  trip: {
    label: "Trip over",
    lines: ["Nobody saw that.", "I meant to do that.", "Flaky test, flaky legs.", "Still merged, though."],
  },
  peekaboo: {
    label: "Peekaboo",
    lines: ["Psst. Merged.", "Moo-ve along, nothing to see.", "Peekaboo!", "Don't mind me."],
  },
  stampede: {
    label: "Stampede",
    lines: ["Wait for meee!", "The whole herd approves.", "Did someone say merge?", "Moo ×7."],
  },
  abduction: {
    label: "UFO abduction",
    lines: ["Moo?!", "Take me to your maintainer.", "Beam me up, it's merged.", "Merged. Gotta go."],
    // Rare, so it stays a surprise.
    weight: 0.35,
  },
  skateboard: {
    label: "Skateboard kickflip",
    lines: ["Kickflip. Merged.", "Rad.", "Shred the diff.", "Ollie into main."],
  },
  parachute: {
    label: "Parachute drop",
    lines: ["Special delivery.", "Deployed. Literally.", "Airdrop for main.", "Stuck the landing."],
  },
  fence: {
    label: "Jump the fence",
    lines: ["Parkour!", "Over the wall, into main.", "Hurdles are for CI.", "Clean jump."],
  },
});

/** A trick's name in the options page, what the merge cow says doing it, and how often a random pick lands on it. */
interface Trick {
  label: string;
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

/** @param name A name. @returns Whether it is a trick the merge cow knows. */
function isTrick(name: string): name is CowTrick {
  return Object.hasOwn(TRICKS, name);
}

/** Which trick she performs: always the same one, or a different one at random each time. */
export type CowSetting = CowTrick | "random";

/** The trick the viewer picked for the merge cow, in sync storage; left out, she picks at random. */
export const COW_TRICK_KEY = "cowTrick";

/**
 * @param stored What sync storage holds under {@link COW_TRICK_KEY}.
 * @returns The trick it names, or random for anything else, so a fresh install, or a trick a later version dropped,
 *   gets a different one each time.
 */
export function trickSettingFrom(stored: unknown): CowSetting {
  return typeof stored === "string" && isTrick(stored) ? stored : "random";
}

/** @returns Which trick the merge cow performs. */
export async function readTrickSetting(): Promise<CowSetting> {
  const stored = await chrome.storage.sync.get(COW_TRICK_KEY);
  return trickSettingFrom(stored[COW_TRICK_KEY]);
}

/** @param setting Which trick she should perform, in every browser the profile syncs to. */
export async function writeTrickSetting(setting: CowSetting): Promise<void> {
  await chrome.storage.sync.set({ [COW_TRICK_KEY]: setting });
}

/**
 * @param trick The trick she performs.
 * @param roll A number in [0, 1), like `Math.random()`, that picks the line.
 * @returns What she says doing it.
 */
export function lineFor(trick: CowTrick, roll: number): string {
  return pickByRoll(TRICKS[trick].lines, roll);
}

/**
 * @param setting Which trick she performs.
 * @param previous The trick she performed last time, which a random pick never repeats.
 * @param roll A number in [0, 1), like `Math.random()`, that picks the trick.
 * @returns The trick the setting names, or one picked at random by the weights.
 */
export function pickTrick(setting: CowSetting, previous: CowTrick | undefined, roll: number): CowTrick {
  if (setting !== "random") return setting;
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
