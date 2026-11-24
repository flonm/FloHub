/** Whether fun mode is on, in sync storage; left out, it is on. */
export const FUN_KEY = "funMode";

/**
 * @param stored What sync storage holds under {@link FUN_KEY}.
 * @returns Whether fun mode is on: anything but an explicit false, so a fresh install starts with it.
 */
export function funFrom(stored: unknown): boolean {
  return stored !== false;
}

/** @returns Whether fun mode is on. */
export async function readFun(): Promise<boolean> {
  const stored = await chrome.storage.sync.get(FUN_KEY);
  return funFrom(stored[FUN_KEY]);
}

/** @param on Whether fun mode should be on, in every browser the profile syncs to. */
export async function writeFun(on: boolean): Promise<void> {
  await chrome.storage.sync.set({ [FUN_KEY]: on });
}

/** What a success toast adds in fun mode. The cow has the first word because the cow always has the first word. */
export const CHEERS = [
  "Moo.",
  "The merge cow approves.",
  "+10 developer aura.",
  "A senior engineer somewhere just nodded.",
  "Your future self sends a fruit basket.",
  "The linter shed a single tear of joy.",
  "Come on Team FloHub, take it to the fridge!",
  "Bigger, faster, and stronger too.",
  "If it breaks prod, it's gonna hurt!",
  "Back in my day we merged by hand, uphill, both ways.",
  "Another golden one for the pile.",
  "Huh!",
  "Achievement unlocked: Did A Thing.",
  "Somewhere, a stand-up meeting got shorter.",
  "🎉",
] as const;

/**
 * @param text A success toast's message.
 * @param roll A number in [0, 1), like `Math.random()`, that picks the cheer.
 * @returns The message with a cheer after it.
 */
export function withCheer(text: string, roll: number): string {
  return `${text} ${pickByRoll(CHEERS, roll)}`;
}

/**
 * @param list What to pick from.
 * @param roll A number in [0, 1), like `Math.random()`; one outside that range picks the first or the last.
 * @returns The item the roll lands on.
 */
export function pickByRoll<T>(list: readonly [T, ...T[]], roll: number): T {
  return list[Math.min(list.length - 1, Math.max(0, Math.floor(roll * list.length)))] ?? list[0];
}
