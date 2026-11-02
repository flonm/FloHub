/** The file tree's width when the viewer hasn't picked one, in pixels. */
export const TREE_WIDTH = 280;
/** The narrowest the tree gets, still showing a short file name and its counts. */
export const MIN_TREE_WIDTH = 160;
/** The share of the view the tree may take at most, so the diff keeps room. */
const MAX_TREE_SHARE = 0.6;
/** How far an arrow key moves the tree's edge, in pixels. */
const KEY_STEP = 16;

/**
 * @param width The width asked for, by a drag, a key or the stored choice.
 * @param available The width of the view the tree and the diff share.
 * @returns The width the tree gets: within its limits, rounded to whole pixels.
 */
export function clampTreeWidth(width: number, available: number): number {
  const max = Math.max(MIN_TREE_WIDTH, Math.floor(available * MAX_TREE_SHARE));
  return Math.round(Math.min(max, Math.max(MIN_TREE_WIDTH, width)));
}

/**
 * @param key The key pressed on the tree's edge.
 * @param width The tree's width now.
 * @param available The width of the view the tree and the diff share.
 * @returns The width the key asks for, or null for a key that doesn't resize: the arrows move the edge, Home and End
 *   take it to the narrowest and the widest, Enter puts it back where it started.
 */
export function treeWidthForKey(key: string, width: number, available: number): number | null {
  switch (key) {
    case "ArrowLeft": {
      return clampTreeWidth(width - KEY_STEP, available);
    }
    case "ArrowRight": {
      return clampTreeWidth(width + KEY_STEP, available);
    }
    case "Home": {
      return MIN_TREE_WIDTH;
    }
    case "End": {
      return clampTreeWidth(Infinity, available);
    }
    case "Enter": {
      return clampTreeWidth(TREE_WIDTH, available);
    }
    default: {
      return null;
    }
  }
}
