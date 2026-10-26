/** How wide a version the timeline shows at rest gets: the base, a reviewed version, a compared end or the head. */
export const NOTABLE_WIDTH = 8;

/** How wide every version is while the strip is open: a target as wide as a button's icon, easy to hit. */
const OPEN_WIDTH = 14;

/**
 * @param notable For each version on the timeline, oldest first, whether it shows at full size at rest.
 * @returns For each version, the length of the run of other versions it's in, or null for a notable one.
 */
export function quietRuns(notable: readonly boolean[]): (number | null)[] {
  const runs: (number | null)[] = notable.map(() => null);
  for (let start = 0; start < notable.length; start++) {
    if (notable[start] === true) continue;
    let end = start;
    while (end + 1 < notable.length && notable[end + 1] === false) end++;
    for (let index = start; index <= end; index++) runs[index] = end - start + 1;
    start = end;
  }
  return runs;
}

/**
 * A run of versions nobody reviewed shrinks to a small pill at rest, whatever its length, so the reviewed versions
 * keep the room; from three on, the pill says how many it holds.
 * @param length How many versions the run holds.
 * @returns The run's width at rest, in pixels.
 */
export function runWidth(length: number): number {
  if (length <= 1) return 6;
  if (length === 2) return 10;
  return Math.min(28, 14 + 2 * length);
}

/** A version on the strip at rest: where it starts, how wide it is, and whether it keeps its width when open. */
export interface DockItem {
  left: number;
  width: number;
  /** A reviewed version's slot is wide enough already. */
  fixed: boolean;
}

/** How far the open strip may reach past its ends at rest without leaving the view, in pixels. */
export interface DockRoom {
  before: number;
  after: number;
}

/**
 * Opens the strip: every version gets a target wide enough to hit, all at once, and then holds still while the pointer
 * moves, so aiming at one never chases a moving target. The strip moves so the version under the pointer, and the
 * point on it, stay under the pointer, as far as the room around the strip allows.
 * @param items The versions at rest, left to right.
 * @param x Where the pointer came in, in pixels from the strip's start at rest.
 * @param room How far the open strip may reach past its ends at rest.
 * @returns Each version's width while open, and how far left to move the strip.
 */
export function expand(items: readonly DockItem[], x: number, room: DockRoom): { widths: number[]; shift: number } {
  const widths = items.map((item) => (item.fixed ? item.width : Math.max(item.width, OPEN_WIDTH)));
  const total = widths.reduce((sum, width) => sum + width, 0);
  const rest = items.reduce((sum, item) => sum + item.width, 0);
  const index = Math.max(0, items.findIndex((item) => x < item.left + item.width));
  const item = items[index];
  let shift = 0;
  if (item) {
    const fraction = Math.min(1, Math.max(0, (x - item.left) / item.width));
    const openLeft = widths.slice(0, index).reduce((sum, width) => sum + width, 0);
    shift = openLeft + fraction * (widths[index] ?? 0) - x;
  }
  // Kept inside the view: no further right than its end allows, then no further left than its start does.
  shift = Math.max(shift, total - rest - room.after);
  shift = Math.min(shift, room.before);
  return { widths, shift };
}

/** Each timeline's magnifier, made once and kept across redraws. */
const magnifiers = new WeakMap<HTMLElement, Magnifier>();

/**
 * @param list A timeline.
 * @returns Its magnifier, made the first time.
 */
export function magnifierOf(list: HTMLElement): Magnifier {
  let magnifier = magnifiers.get(list);
  if (!magnifier) {
    magnifier = new Magnifier(list);
    magnifiers.set(list, magnifier);
  }
  return magnifier;
}

/**
 * Opens a timeline under the pointer: every version gets a target wide enough to hit, at once, and the strip holds
 * still until the pointer leaves it. It floats over the pickers beside it, so they don't move.
 */
class Magnifier {
  /** The open strip's widths and shift while the pointer is on it, kept for a redraw. */
  private open: { widths: number[]; shift: number } | null = null;

  constructor(private readonly list: HTMLElement) {
    list.addEventListener("pointerenter", (event) => this.expand(event.clientX));
    list.addEventListener("pointerleave", () => {
      this.open = null;
      this.reset();
    });
  }

  /** Keeps the strip open as it was after a redraw under the pointer, so nothing moves under it. */
  refresh(): void {
    if (this.open) this.apply(this.open);
  }

  private expand(clientX: number): void {
    this.reset();
    const box = this.list.getBoundingClientRect();
    const bounds = (this.list.closest(".vbar") ?? this.list.parentElement)?.getBoundingClientRect() ?? box;
    const items = [...this.list.children].map((child) => {
      const item = child as HTMLElement;
      return { left: item.offsetLeft, width: item.offsetWidth, fixed: item.classList.contains("reviewed") };
    });
    const room = { before: Math.max(0, box.left - bounds.left - 4), after: Math.max(0, bounds.right - box.right - 4) };
    this.open = expand(items, clientX - box.left, room);
    this.apply(this.open);
  }

  private apply({ widths, shift }: { widths: number[]; shift: number }): void {
    const rest = [...this.list.children].reduce((sum, child) => sum + (child as HTMLElement).offsetWidth, 0);
    const grown = widths.reduce((sum, width) => sum + width, 0) - rest;
    this.list.classList.add("zoomed");
    for (const [index, child] of [...this.list.children].entries()) (child as HTMLElement).style.width = `${widths[index] ?? 0}px`;
    // It grows into the room beside it rather than taking more: moved left by the shift, overlapping the To picker by
    // the rest.
    this.list.style.transform = `translateX(${-shift}px)`;
    this.list.style.marginRight = `${-(grown - shift)}px`;
  }

  private reset(): void {
    this.list.classList.remove("zoomed");
    this.list.style.transform = "";
    this.list.style.marginRight = "";
    for (const child of this.list.children) (child as HTMLElement).style.width = "";
  }
}
