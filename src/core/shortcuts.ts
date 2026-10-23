export type ReviewEvent = "APPROVE" | "REQUEST_CHANGES";

type ShortcutAction =
  | { type: "navigate"; direction: 1 | -1 }
  | { type: "review"; event: ReviewEvent; withComment: boolean }
  | { type: "copy"; what: CopyTarget };

/** What C then C, or C then G, copies: the `gh pr checkout` command, or the pull request's link. */
export type CopyTarget = "checkout" | "link";

export interface ShortcutMatch {
  /** The action the key completes, if any. */
  action: ShortcutAction | null;
  /** Whether to keep the key from the page's own shortcuts. */
  claim: boolean;
}

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

export const CHORD_TIMEOUT_MS = 1500;

const REVIEW_CHORDS: Record<string, ShortcutAction> = {
  y: { type: "review", event: "APPROVE", withComment: false },
  a: { type: "review", event: "APPROVE", withComment: true },
  n: { type: "review", event: "REQUEST_CHANGES", withComment: true },
};

const NAVIGATION: Record<string, ShortcutAction> = {
  ArrowUp: { type: "navigate", direction: 1 },
  ArrowDown: { type: "navigate", direction: -1 },
};

/** Keys that start a chord, whether the page may still see that first key, and the keys that complete it. */
const CHORDS: Record<string, { claimFirstKey: boolean; next: Record<string, ShortcutAction> }> = {
  r: { claimFirstKey: false, next: REVIEW_CHORDS },
  c: {
    claimFirstKey: true,
    next: { c: { type: "copy", what: "checkout" }, g: { type: "copy", what: "link" } },
  },
};

const MODIFIER_KEYS = new Set(["Shift", "Meta", "Control", "Alt", "CapsLock"]);

const NO_MATCH: ShortcutMatch = { action: null, claim: false };

/**
 * Creates a matcher for Graphite's shortcuts: ⌘⇧↑/↓ (Ctrl⇧↑/↓ elsewhere) move through the stack,
 * R followed within {@link CHORD_TIMEOUT_MS} by Y, A or N reviews the pull request, C then C
 * copies the checkout command and C then G the pull request's link. GitHub binds a plain C itself, so the C that starts a chord is claimed;
 * the R is not, so quote-reply on selected text keeps working.
 * @returns A function that takes each keydown and returns what it completes and whether to claim it.
 */
export function createShortcutMatcher(): (input: KeyInput) => ShortcutMatch {
  let chord: { prefix: string; at: number } | null = null;

  return (input) => {
    if (input.editable || input.repeat) {
      chord = null;
      return NO_MATCH;
    }
    if (MODIFIER_KEYS.has(input.key)) return NO_MATCH;

    if ((input.metaKey || input.ctrlKey) && input.shiftKey && !input.altKey) {
      chord = null;
      const action = NAVIGATION[input.key] ?? null;
      return { action, claim: action !== null };
    }
    if (input.metaKey || input.ctrlKey || input.altKey || input.shiftKey) {
      chord = null;
      return NO_MATCH;
    }

    const key = input.key.toLowerCase();
    const open = chord !== null && input.time - chord.at <= CHORD_TIMEOUT_MS ? chord.prefix : null;
    chord = null;
    const completed = open ? CHORDS[open]?.next[key] : undefined;
    if (completed) return { action: completed, claim: true };
    const prefix = CHORDS[key];
    if (!prefix) return NO_MATCH;
    chord = { prefix: key, at: input.time };
    return { action: null, claim: prefix.claimFirstKey };
  };
}

/** One row of the shortcut list: the keys, pressed one after the other or as alternatives, and what they do. */
export interface ShortcutHelp {
  keys: string[];
  /** How the keys go together: "then" for a sequence, "or" for alternatives, null for a single key or chord. */
  join: "then" | "or" | null;
  action: string;
}

/**
 * The shortcuts FloHub adds on a pull request, as the options page and the bar's list show them.
 * @param mac Whether the viewer is on macOS, where the stack moves with ⌘ rather than Ctrl.
 * @returns The list, most used first.
 */
export function shortcutHelp(mac: boolean): ShortcutHelp[] {
  const mod = mac ? "⌘" : "Ctrl+";
  return [
    { keys: [`${mod}⇧↑`, `${mod}⇧↓`], join: "or", action: "Go to the pull request above or below in the stack" },
    { keys: ["R", "Y"], join: "then", action: "Approve right away, without a comment" },
    { keys: ["R", "A"], join: "then", action: "Approve with a comment" },
    { keys: ["R", "N"], join: "then", action: "Request changes, with or without a comment" },
    { keys: ["C", "C"], join: "then", action: "Copy gh pr checkout <number>" },
    { keys: ["C", "G"], join: "then", action: "Copy the pull request's link" },
    { keys: ["1", "2", "3"], join: null, action: "In the menu a comment's file link opens: pick a way to see its code" },
    { keys: ["Esc"], join: null, action: "Close a menu, a dialog or the versions view" },
  ];
}

/** @returns Whether the browser runs on macOS, from what it says of its platform. */
export function isMac(platform: string): boolean {
  return /mac/iu.test(platform);
}
