/** Where a pull request stands: open for review, a draft, closed without merging, or merged. */
export type PullState = "open" | "draft" | "closed" | "merged";

/** A change of state FloHub can make: GitHub's close, reopen, convert to draft and ready for review. */
export type PullMove = "close" | "reopen" | "draft" | "ready";

/** What FloHub knows of the pull request on screen to offer its moves. */
export interface PullStatus {
  state: PullState;
  /** Whether the viewer may change it, as GitHub's viewerCanUpdate says. */
  canUpdate: boolean;
  /** Its node id, which the mutations take; null in an overview cached before it was fetched. */
  id: string | null;
}

/** What a shortcut asks for; which move that is depends on the state. */
export type StateIntent = "close" | "reopen" | "toggle-draft";

/**
 * @param pull The pull request's state and draft flag, as GitHub's GraphQL API gives them.
 * @returns Its state, a draft only while it is open.
 */
export function pullStateOf(pull: { state: "OPEN" | "CLOSED" | "MERGED"; isDraft: boolean }): PullState {
  if (pull.state === "MERGED") return "merged";
  if (pull.state === "CLOSED") return "closed";
  return pull.isDraft ? "draft" : "open";
}

/**
 * @param state Where the pull request stands.
 * @param canUpdate Whether the viewer may change it, as GitHub's viewerCanUpdate says.
 * @returns The moves to offer, the everyday one first; none for a merged pull request or a viewer who may not.
 */
export function pullMoves(state: PullState, canUpdate: boolean): PullMove[] {
  if (!canUpdate) return [];
  switch (state) {
    case "open": {
      return ["draft", "close"];
    }
    case "draft": {
      return ["ready", "close"];
    }
    case "closed": {
      return ["reopen"];
    }
    case "merged": {
      return [];
    }
  }
}

/**
 * @param intent What the shortcut asks for.
 * @param state Where the pull request stands.
 * @param canUpdate Whether the viewer may change it.
 * @returns The move it makes, or null when it makes none: closing what is closed, or a draft toggle on a closed one.
 */
export function moveFor(intent: StateIntent, state: PullState, canUpdate: boolean): PullMove | null {
  const moves = pullMoves(state, canUpdate);
  const wanted: PullMove = intent === "toggle-draft" ? (state === "draft" ? "ready" : "draft") : intent;
  return moves.includes(wanted) ? wanted : null;
}

/** How each state is named, and each move offered and reported. */
export const STATE_WORDS: Record<PullState, string> = { open: "Open", draft: "Draft", closed: "Closed", merged: "Merged" };

export const MOVE_WORDS: Record<PullMove, { label: string; done: (number: number) => string; failed: string }> = {
  close: { label: "Close pull request", done: (number) => `Closed #${number}.`, failed: "close" },
  reopen: { label: "Reopen pull request", done: (number) => `Reopened #${number}.`, failed: "reopen" },
  draft: { label: "Convert to draft", done: (number) => `Turned #${number} into a draft.`, failed: "convert to draft" },
  ready: { label: "Ready for review", done: (number) => `Marked #${number} ready for review.`, failed: "mark ready for review" },
};

/**
 * @param move The move made.
 * @returns The state it leaves the pull request in.
 */
export function stateAfter(move: PullMove): PullState {
  return ({ close: "closed", reopen: "open", draft: "draft", ready: "open" } as const)[move];
}

/**
 * @param move A move.
 * @param mac Whether the viewer is on macOS.
 * @returns The keys that make it, or null where it has none.
 */
export function moveKeys(move: PullMove, mac: boolean): string | null {
  if (move === "close") return mac ? "⌘Esc" : null;
  if (move === "reopen") return mac ? "⌘⇧Esc" : null;
  return "D D";
}

/**
 * @param move The move made.
 * @param number The pull request's number.
 * @param mac Whether the viewer is on macOS, where closing and reopening have keys.
 * @returns What the toast says once it is done, with the key that undoes it.
 */
export function moveDone(move: PullMove, number: number, mac: boolean): string {
  const undo: Record<PullMove, string | null> = {
    close: mac ? "⌘⇧Esc reopens it" : null,
    reopen: mac ? "⌘Esc closes it" : null,
    draft: "D then D marks it ready",
    ready: "D then D turns it back into a draft",
  };
  const done = MOVE_WORDS[move].done(number);
  const hint = undo[move];
  return hint ? `${done} ${hint}.` : done;
}

/**
 * @param intent What the shortcut asked for.
 * @param state Where the pull request stands.
 * @param canUpdate Whether the viewer may change it.
 * @returns Why the shortcut made no move, for a toast.
 */
export function noMoveReason(intent: StateIntent, state: PullState, canUpdate: boolean): string {
  if (state === "merged") return "The pull request is merged.";
  if (!canUpdate) return "You can't change this pull request's state.";
  if (intent === "close") return "The pull request is already closed.";
  if (intent === "reopen") return "The pull request is already open.";
  return "The pull request is closed. Reopen it first.";
}
