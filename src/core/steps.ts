/** A place a key steps to: an unresolved thread, or a file not marked Viewed. */
export interface Stop {
  id: string;
  /** Its top edge, in the scrolling container's pixels from the top of the screen. */
  top: number;
}

/** The last stop a key went to, and where it stood once scrolled to. */
export interface Landed {
  id: string;
  top: number;
}

/** Where a key puts the stop it goes to: this share of the way down the scrolling area, where the eye reads. */
export const READING_LINE = 0.3;

/** How far a landed stop may have moved and still count as the one on screen, in pixels. */
const STILL_THERE_PX = 4;

/**
 * Picks the stop to go to next. While the stop the key last went to is still where it put it, the next is the one
 * after it; once the viewer scrolled away, it is the first below the reading line, or the last above it going back.
 * Past the last one it starts over from the first, and before the first from the last.
 * @param stops The stops, top to bottom.
 * @param line Where the reading line is, in the same pixels as the stops' tops.
 * @param direction 1 to go down, -1 to go up.
 * @param landed The last stop the key went to, if any.
 * @returns The stop's index, and whether it started over; null when there are no stops.
 */
export function nextStop(stops: readonly Stop[], line: number, direction: 1 | -1, landed: Landed | null): { index: number; wrapped: boolean } | null {
  if (stops.length === 0) return null;
  const at = landed ? stops.findIndex((stop) => stop.id === landed.id && Math.abs(stop.top - landed.top) <= STILL_THERE_PX) : -1;
  let index: number;
  if (at >= 0) index = at + direction;
  else if (direction === 1) index = stops.findIndex((stop) => stop.top > line + STILL_THERE_PX);
  else index = stops.findLastIndex((stop) => stop.top < line - STILL_THERE_PX);
  if (index >= 0 && index < stops.length) return { index, wrapped: false };
  return { index: direction === 1 ? 0 : stops.length - 1, wrapped: true };
}

/**
 * @param index The stop gone to.
 * @param total How many there are.
 * @param wrapped Whether the key started over.
 * @param noun What the stops are, singular, like "unresolved thread".
 * @returns What the toast says, like "Unresolved thread 2 of 5." or "Back to the first unresolved thread, 1 of 5."
 */
export function stopToast(index: number, total: number, wrapped: boolean, noun: string): string {
  const of = `${index + 1} of ${total}`;
  if (!wrapped || total === 1) return `${noun.charAt(0).toUpperCase()}${noun.slice(1)} ${of}.`;
  return `Back to the ${index === 0 ? "first" : "last"} ${noun}, ${of}.`;
}
