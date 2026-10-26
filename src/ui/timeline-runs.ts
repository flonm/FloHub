/** How wide a version the timeline shows on its own is, with the gap after it. */
export const TICK_WIDTH = 10;

/** The shortest run of versions without a verdict that folds into one block; shorter ones show their versions. */
const MIN_RUN = 3;

/**
 * @param notable For each version on the timeline, oldest first, whether it always shows on its own: the base, a
 *   reviewed version, a compared end, the head, the viewer's last review.
 * @returns For each version, the length of the run of other versions it's in when that run folds, or null when it
 *   shows on its own.
 */
export function foldedRuns(notable: readonly boolean[]): (number | null)[] {
  const runs: (number | null)[] = notable.map(() => null);
  for (let start = 0; start < notable.length; start++) {
    if (notable[start] === true) continue;
    let end = start;
    while (end + 1 < notable.length && notable[end + 1] === false) end++;
    const length = end - start + 1;
    if (length >= MIN_RUN) for (let index = start; index <= end; index++) runs[index] = length;
    start = end;
  }
  return runs;
}

/**
 * A folded run grows with the logarithm of its length, so a long one stays small, yet a longer one is wider.
 * @param length How many versions the run holds.
 * @returns Its width, in pixels.
 */
export function runWidth(length: number): number {
  return Math.round(6 + 5 * Math.log2(length));
}

/**
 * A folded run is drawn as one hairline per version, as far as they fit: a short run can be counted at a glance, a
 * long one turns dense.
 * @param length How many versions the run holds.
 * @returns The distance between two hairlines, in pixels.
 */
export function runPitch(length: number): number {
  return Math.max(2, runWidth(length) / length);
}
