export type ReviewEvent = "APPROVE" | "REQUEST_CHANGES";

export type ShortcutAction =
  | { type: "navigate"; direction: 1 | -1 }
  | { type: "review"; event: ReviewEvent; withComment: boolean };

export interface KeyInput {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  repeat: boolean;
  /** Whether the key went to a text field, where shortcuts must not fire. */
  editable: boolean;
  /** Milliseconds, any monotonic clock. */
  time: number;
}

export const CHORD_TIMEOUT_MS = 1_500;

const REVIEW_CHORDS: Record<string, ShortcutAction> = {
  y: { type: "review", event: "APPROVE", withComment: false },
  a: { type: "review", event: "APPROVE", withComment: true },
  n: { type: "review", event: "REQUEST_CHANGES", withComment: true },
};

const NAVIGATION: Record<string, ShortcutAction> = {
  ArrowUp: { type: "navigate", direction: 1 },
  ArrowDown: { type: "navigate", direction: -1 },
};

const MODIFIER_KEYS = new Set(["Shift", "Meta", "Control", "Alt", "CapsLock"]);

/**
 * Creates a matcher for Graphite's shortcuts: ⌘⇧↑/↓ (Ctrl⇧↑/↓ elsewhere) move through the stack,
 * and R followed within {@link CHORD_TIMEOUT_MS} by Y, A or N reviews the pull request.
 * @returns A function that takes each keydown and returns the action it completes, if any.
 */
export function createShortcutMatcher(): (input: KeyInput) => ShortcutAction | null {
  let chordStartedAt: number | null = null;

  return (input) => {
    if (input.editable || input.repeat) {
      chordStartedAt = null;
      return null;
    }
    if (MODIFIER_KEYS.has(input.key)) return null;

    if ((input.metaKey || input.ctrlKey) && input.shiftKey && !input.altKey) {
      chordStartedAt = null;
      return NAVIGATION[input.key] ?? null;
    }
    if (input.metaKey || input.ctrlKey || input.altKey || input.shiftKey) {
      chordStartedAt = null;
      return null;
    }

    const key = input.key.toLowerCase();
    const chordOpen = chordStartedAt !== null && input.time - chordStartedAt <= CHORD_TIMEOUT_MS;
    chordStartedAt = null;
    if (chordOpen && REVIEW_CHORDS[key]) return REVIEW_CHORDS[key];
    if (key === "r") chordStartedAt = input.time;
    return null;
  };
}
