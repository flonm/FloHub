/** How wide a version the timeline shows at rest gets: the base, a reviewed version, a compared end or the head. */
export const NOTABLE_WIDTH = 8;

/** How wide a version gets right under the pointer, wide enough to aim at one of many. */
const ZOOMED_WIDTH = 12;

/** How far from the pointer, in pixels of the strip at rest, the magnification reaches. */
const SPREAD = 28;

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

/** A version on the strip at rest: where it starts, how wide it is, and how wide it may grow under the pointer. */
export interface DockItem {
  left: number;
  width: number;
  zoom: number;
}

/**
 * Magnifies the strip around the pointer like the macOS dock: the versions near it grow, the more the nearer, so one
 * among many tiny ones can be picked. The strip moves left by what grew left of the pointer, so the version under the
 * pointer stays under it.
 * @param items The versions at rest, left to right.
 * @param x Where the pointer is, in pixels from the strip's start at rest.
 * @returns Each version's magnified width, and how far left to move the strip.
 */
export function magnify(items: readonly DockItem[], x: number): { widths: number[]; shift: number } {
  let shift = 0;
  const widths = items.map((item) => {
    const distance = item.left + item.width / 2 - x;
    const grown = (Math.max(item.zoom, item.width) - item.width) * Math.exp(-((distance / SPREAD) ** 2));
    // What grew left of the pointer pushes the version under it right, unless the strip moves back as much.
    const before = Math.min(1, Math.max(0, (x - item.left) / item.width));
    shift += grown * before;
    return item.width + grown;
  });
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
 * Magnifies a timeline under the pointer, the macOS dock's way: the versions near the pointer grow, and the strip
 * floats over its neighbours, moved so the version under the pointer stays under it. It takes no room it didn't have
 * at rest, so the pickers beside it don't move.
 */
class Magnifier {
  /** The strip at rest, measured when the pointer came in, and where the pointer is. */
  private rest: { left: number; items: DockItem[] } | null = null;
  private x = 0;

  constructor(private readonly list: HTMLElement) {
    list.addEventListener("pointerenter", (event) => {
      this.measure();
      this.move(event.clientX);
    });
    list.addEventListener("pointermove", (event) => this.move(event.clientX));
    list.addEventListener("pointerleave", () => {
      this.rest = null;
      this.reset();
    });
  }

  /** Measures the strip again after a redraw under the pointer, and magnifies it where the pointer still is. */
  refresh(): void {
    if (this.rest === null) return;
    const { left } = this.rest;
    this.measure();
    this.apply(this.x, left);
  }

  private measure(): void {
    this.reset();
    const box = this.list.getBoundingClientRect();
    const items = [...this.list.children].map((child) => {
      const item = child as HTMLElement;
      const zoom = item.classList.contains("reviewed") ? item.offsetWidth : Math.max(item.offsetWidth, ZOOMED_WIDTH);
      return { left: item.offsetLeft, width: item.offsetWidth, zoom };
    });
    this.rest = { left: box.left, items };
  }

  private move(clientX: number): void {
    if (!this.rest) return;
    this.apply(clientX - this.rest.left, this.rest.left);
  }

  private apply(x: number, left: number): void {
    if (!this.rest) return;
    this.x = x;
    this.rest.left = left;
    const { widths, shift } = magnify(this.rest.items, x);
    const grown = widths.reduce((sum, width, index) => sum + width - (this.rest?.items[index]?.width ?? width), 0);
    this.list.classList.toggle("zoomed", grown > 0.5);
    for (const [index, child] of [...this.list.children].entries()) (child as HTMLElement).style.width = `${widths[index] ?? 0}px`;
    // It grows into the room beside it rather than taking more: moved left by what grew left of the pointer, and
    // overlapping the To picker by the rest.
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
