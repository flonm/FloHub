import { formatAge } from "../core/age";
import type { DismissedVerdict, Reviewer, Verdict } from "../core/reviewers";

/** The icons a reviewer's state is drawn with, all of them in ui/dom's set. */
type Glyph = "check" | "changes" | "comment" | "slash" | "dot" | "sync";

type Tone = "success" | "attention" | "muted";

/**
 * How a reviewer's row shows their state. The glyph says what they said, in its colour; the ring says what counts
 * now; a dashed ring says they have been asked to review, again or for the first time.
 */
export interface ReviewerLook {
  glyph: Glyph;
  tone: Tone;
  ring: Tone;
  waiting: boolean;
  /** The state in a few words, e.g. "Approval dismissed". */
  label: string;
  /** Everything the row knows, for its tooltip and for screen readers. */
  detail: string;
}

/** A poke can't be repeated within this long, and the row says when it was sent until then. */
export const POKE_COOLDOWN_MS = 3_600_000;

const DISMISSED_NAME: Record<DismissedVerdict, string> = { approved: "approval", changes_requested: "change request" };

/**
 * @param reviewer The reviewer.
 * @param now The current time, for the ages.
 * @param pokedAt When the viewer last poked them, if they did.
 * @param replies How many unresolved threads they started the author answered last, which makes it their turn.
 * @returns How the reviewer's row and their face in the floating pill show their state.
 */
export function reviewerLook(reviewer: Reviewer, now: number, pokedAt?: number, replies = 0): ReviewerLook {
  const age = reviewer.at ? ` ${formatAge(reviewer.at, now).spoken}` : "";
  let look = baseLook(reviewer, age);
  const extras: string[] = [];
  if (replies > 0) {
    look = { ...look, waiting: true };
    extras.push(`Their turn: the author answered last in ${replies === 1 ? "a thread" : `${replies} threads`} they started.`);
  }
  if (reviewer.kind === "bot") extras.push("A bot.");
  else if (reviewer.kind === "team") extras.push("A team.");
  if (pokedAt !== undefined && now - pokedAt < POKE_COOLDOWN_MS) {
    extras.push(`You poked ${reviewer.kind === "team" ? "the team" : "them"} ${formatAge(new Date(pokedAt).toISOString(), now).spoken}.`);
  }
  return extras.length > 0 ? { ...look, detail: `${look.detail} ${extras.join(" ")}` } : look;
}

function baseLook(reviewer: Reviewer, age: string): ReviewerLook {
  switch (reviewer.status) {
    case "approved": {
      return { glyph: "check", tone: "success", ring: "success", waiting: false, label: "Approved", detail: `Approved${age}.` };
    }
    case "changes_requested": {
      return {
        glyph: "changes",
        tone: "attention",
        ring: "attention",
        waiting: false,
        label: "Changes requested",
        detail: `Requested changes${age}.`,
      };
    }
    case "commented": {
      return {
        glyph: "comment",
        tone: "muted",
        ring: "muted",
        waiting: false,
        label: "Commented",
        detail: `Commented${age}, without approving or requesting changes.`,
      };
    }
    case "dismissed": {
      const from = reviewer.dismissedFrom;
      if (!from) {
        return { glyph: "slash", tone: "muted", ring: "muted", waiting: false, label: "Dismissed", detail: `Reviewed${age}; the review was dismissed.` };
      }
      return {
        glyph: from === "approved" ? "check" : "changes",
        tone: from === "approved" ? "success" : "attention",
        ring: "muted",
        waiting: false,
        label: from === "approved" ? "Approval dismissed" : "Change request dismissed",
        detail: `${from === "approved" ? "Approved" : "Requested changes"}${age}; the ${DISMISSED_NAME[from]} was dismissed.`,
      };
    }
    case "pending": {
      const who = reviewer.kind === "team" ? "nobody from the team has" : "they haven't";
      return { glyph: "dot", tone: "attention", ring: "muted", waiting: true, label: "Review requested", detail: `Review requested; ${who} reviewed yet.` };
    }
    case "rerequested": {
      return {
        glyph: "sync",
        tone: "attention",
        ring: standingTone(reviewer.previous),
        waiting: true,
        label: "Re-requested",
        detail: `Review requested again. Before, ${before(reviewer, age)}.`,
      };
    }
  }
}

function standingTone(previous: Verdict | null): Tone {
  if (previous === "approved") return "success";
  if (previous === "changes_requested") return "attention";
  return "muted";
}

function before(reviewer: Reviewer, age: string): string {
  switch (reviewer.previous) {
    case "approved": {
      return `they approved${age}, which still counts`;
    }
    case "changes_requested": {
      return `they requested changes${age}, which still counts`;
    }
    case "commented": {
      return `they commented${age}`;
    }
    case "dismissed": {
      return `their ${reviewer.dismissedFrom ? DISMISSED_NAME[reviewer.dismissedFrom] : "review"}${age ? ` from${age}` : ""} was dismissed`;
    }
    case null: {
      return "they hadn't reviewed";
    }
  }
}

/**
 * @param reviewer The reviewer.
 * @returns The approval or change request the viewer may dismiss, or null.
 */
export function standingVerdict(reviewer: Reviewer): DismissedVerdict | null {
  if (!reviewer.dismissId) return null;
  const verdict = reviewer.status === "rerequested" ? reviewer.previous : reviewer.status;
  return verdict === "approved" || verdict === "changes_requested" ? verdict : null;
}

/**
 * @param verdict A standing verdict.
 * @returns How the dismiss button and its dialog name it.
 */
export function dismissedName(verdict: DismissedVerdict): string {
  return DISMISSED_NAME[verdict];
}
