import type { Verdict } from "../core/reviewers";
import { el, icon } from "./dom";

/** How each verdict is drawn and said, the same in the bar, the versions view and the inbox. */
export const VERDICT_LOOK: Record<Verdict, { glyph: "check" | "changes" | "comment" | "slash"; tone: "success" | "attention" | "muted"; said: string }> = {
  approved: { glyph: "check", tone: "success", said: "approved" },
  changes_requested: { glyph: "changes", tone: "attention", said: "requested changes" },
  commented: { glyph: "comment", tone: "muted", said: "commented" },
  dismissed: { glyph: "slash", tone: "muted", said: "had a review dismissed" },
};

/** A reviewer and what they said, as a face draws them. */
export interface FacedReview {
  login: string;
  avatarUrl: string | null;
  verdict: Verdict;
  /** A review since dismissed keeps its verdict's icon, and its face greys out. */
  dismissed?: boolean;
}

/**
 * @param review The reviewer and their verdict.
 * @param badge Whether to put the verdict's icon on the face.
 * @returns Their avatar, or their initial, with the verdict's icon in its colour on its corner.
 */
export function verdictFace(review: FacedReview, badge = true): HTMLElement {
  const face = el("span", { class: review.dismissed ? "verdict-face dismissed" : "verdict-face" });
  const initial = el("span", { class: "initial" }, review.login.charAt(0).toUpperCase());
  if (review.avatarUrl) {
    const url = new URL(review.avatarUrl, "https://github.com");
    url.searchParams.set("s", "40");
    const image = el("img", { src: url.href, alt: "", width: "18", height: "18" });
    image.addEventListener("error", () => image.replaceWith(initial));
    face.append(image);
  } else {
    face.append(initial);
  }
  if (!badge) return face;
  const look = VERDICT_LOOK[review.verdict];
  const mark = el("span", { class: "verdict-mark", "data-tone": look.tone });
  mark.append(icon(look.glyph));
  face.append(mark);
  return face;
}
