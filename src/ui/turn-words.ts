import type { Turn, TurnReason } from "../core/turn";

/** The colours a reason is drawn in, as the stack's status badges use them. */
export type ReasonTone = "danger" | "attention" | "accent" | "success" | "neutral";

/** A reason in a chip: a couple of words, its colour, and a sentence for its tooltip. */
export interface ReasonWords {
  text: string;
  tone: ReasonTone;
  detail: string;
}

/**
 * @param names Logins or team slugs.
 * @returns The names as a sentence lists them: "alice", "alice and bob", "alice, bob and carol".
 */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * @param reason Why a pull request waits for someone.
 * @param fun Whether fun mode is on: the chip jokes, its tooltip still says what is going on.
 * @returns How a chip says it.
 */
export function reasonWords(reason: TurnReason, fun = false): ReasonWords {
  const words = plainWords(reason);
  return fun ? { ...words, text: funText(reason) } : words;
}

function plainWords(reason: TurnReason): ReasonWords {
  const who = listNames(reason.who ?? []);
  switch (reason.code) {
    case "requested": {
      return { text: "Review requested", tone: "accent", detail: "You're asked to review it." };
    }
    case "rerequested": {
      return { text: "Re-requested", tone: "attention", detail: "You're asked to review it again." };
    }
    case "replies": {
      const count = reason.count ?? 0;
      return {
        text: count === 1 ? "1 reply" : `${count} replies`,
        tone: "attention",
        detail: `${count === 1 ? "An unresolved thread waits" : `${count} unresolved threads wait`} for your answer: someone else spoke last.`,
      };
    }
    case "pushed-since-review": {
      return { text: "New commits", tone: "accent", detail: "The author pushed since you requested changes." };
    }
    case "changes-requested": {
      return { text: "Changes requested", tone: "attention", detail: `${who} requested changes, and you haven't pushed since.` };
    }
    case "ask-again": {
      return { text: `Ask ${who} again`, tone: "accent", detail: `You pushed since ${who} requested changes; ask for another review.` };
    }
    case "checks-failed": {
      return { text: "Checks failed", tone: "danger", detail: "A required or optional check failed." };
    }
    case "conflict": {
      return { text: "Merge conflict", tone: "danger", detail: "It conflicts with its base branch." };
    }
    case "ready-to-merge": {
      return { text: "Ready to merge", tone: "success", detail: "Approved, resolved and green: only merging is left." };
    }
    case "ask-for-review": {
      return { text: "Ask for a review", tone: "accent", detail: "It needs an approval and nobody is asked to review it." };
    }
    case "waiting-on-reviewers": {
      const names = reason.who ?? [];
      return {
        text: names.length === 1 ? `Waiting for ${who}` : `Waiting for ${names.length} reviewers`,
        tone: "neutral",
        detail: `Waiting for ${who} to review.`,
      };
    }
    case "waiting-on-author": {
      return { text: "Waiting for author", tone: "neutral", detail: "Its author has your review to answer." };
    }
    case "changes-by-other": {
      return { text: `${who} requested changes`, tone: "neutral", detail: `You're asked to review it, but ${who} already requested changes.` };
    }
    case "approved-by-other": {
      return { text: `${who} approved`, tone: "neutral", detail: `You're asked to review it, but ${who} already approved it.` };
    }
    case "draft": {
      return { text: "Draft", tone: "neutral", detail: "A draft waits for nobody." };
    }
  }
}

/** @returns A chip's text in fun mode. Every joke still names the person it is about. */
function funText(reason: TurnReason): string {
  const who = listNames(reason.who ?? []);
  switch (reason.code) {
    case "requested": {
      return "You have been summoned";
    }
    case "rerequested": {
      return "Summoned again (they missed you)";
    }
    case "replies": {
      const count = reason.count ?? 0;
      return count === 1 ? "1 cliffhanger" : `${count} cliffhangers`;
    }
    case "pushed-since-review": {
      return "Fresh commits, still warm";
    }
    case "changes-requested": {
      return `${who} has notes 📝`;
    }
    case "ask-again": {
      return `Grovel before ${who}`;
    }
    case "checks-failed": {
      return "CI is on fire 🔥";
    }
    case "conflict": {
      return "The branches are fighting";
    }
    case "ready-to-merge": {
      return "🐄 Ready to moo-rge";
    }
    case "ask-for-review": {
      return "Nobody loves it yet";
    }
    case "waiting-on-reviewers": {
      const names = reason.who ?? [];
      return names.length === 1 ? `${who} is thinking very hard` : `${names.length} reviewers, zero urgency`;
    }
    case "waiting-on-author": {
      return "Ball's in their court 🎾";
    }
    case "changes-by-other": {
      return `${who} already roasted it`;
    }
    case "approved-by-other": {
      return `${who} already blessed it`;
    }
    case "draft": {
      return "Still in the oven";
    }
  }
}

/**
 * @param whose Whose move it is.
 * @param fun Whether fun mode is on.
 * @returns How the toolbar and the popup's sections name it.
 */
export function turnOwner(whose: "you" | "them", fun = false): string {
  if (whose === "you") return fun ? "Your move, champ" : "Your turn";
  return fun ? "Not your problem" : "Their turn";
}

/**
 * @param turn Whose move a pull request waits for.
 * @returns The bar's one-line summary, e.g. "Your turn: 2 replies, checks failed", or null for a draft.
 */
export function turnSummary(turn: Turn): string | null {
  if (turn.whose === "none") return null;
  const owner = turn.whose === "you" ? "Your turn" : "Their turn";
  const reasons = turn.reasons.map((reason) => reasonWords(reason).text);
  if (reasons.length === 0) return owner;
  return `${owner}: ${reasons.map((text) => text.charAt(0).toLowerCase() + text.slice(1)).join(", ")}`;
}
