import { describe, expect, test } from "bun:test";
import type { DismissedVerdict, Reviewer } from "../core/reviewers";
import { reviewerLook, standingVerdict } from "./reviewer-look";

const NOW = Date.parse("2026-10-23T12:00:00Z");
const THREE_HOURS_AGO = "2026-10-23T09:00:00Z";

type Overrides = Pick<Reviewer, "status"> & Partial<Reviewer>;

function reviewer(overrides: Overrides): Reviewer {
  return {
    key: "user:mona",
    kind: "user",
    name: "mona",
    avatarUrl: null,
    url: "https://github.com/mona",
    previous: null,
    dismissedFrom: null,
    dismissId: null,
    at: THREE_HOURS_AGO,
    canRerequest: false,
    canPoke: false,
    ...overrides,
  };
}

describe("reviewerLook", () => {
  test.each([
    [{ status: "approved" }, { glyph: "check", tone: "success", ring: "success", waiting: false, label: "Approved", detail: "Approved 3 hours ago." }],
    [
      { status: "changes_requested" },
      { glyph: "changes", tone: "attention", ring: "attention", waiting: false, detail: "Requested changes 3 hours ago." },
    ],
    [{ status: "commented" }, { glyph: "comment", tone: "muted", ring: "muted", waiting: false }],
    [{ status: "pending", at: null }, { glyph: "dot", ring: "muted", waiting: true, detail: "Review requested; they haven't reviewed yet." }],
  ] as [Overrides, object][])("the glyph says what they said and the ring what counts: %o", (overrides, look) => {
    expect(reviewerLook(reviewer(overrides), NOW)).toMatchObject(look);
  });

  test("a dismissed review keeps its verdict's glyph and colour inside a grey ring", () => {
    expect(reviewerLook(reviewer({ status: "dismissed", dismissedFrom: "approved" }), NOW)).toMatchObject({
      glyph: "check",
      tone: "success",
      ring: "muted",
      label: "Approval dismissed",
      detail: "Approved 3 hours ago; the approval was dismissed.",
    });
    expect(reviewerLook(reviewer({ status: "dismissed", dismissedFrom: "changes_requested" }), NOW)).toMatchObject({
      glyph: "changes",
      tone: "attention",
      ring: "muted",
      label: "Change request dismissed",
    });
    expect(reviewerLook(reviewer({ status: "dismissed" }), NOW)).toMatchObject({ glyph: "slash", tone: "muted", ring: "muted", label: "Dismissed" });
  });

  test.each([
    ["approved", "success", "Review requested again. Before, they approved 3 hours ago, which still counts."],
    ["changes_requested", "attention", "Review requested again. Before, they requested changes 3 hours ago, which still counts."],
    ["commented", "muted", "Review requested again. Before, they commented 3 hours ago."],
    ["dismissed", "muted", "Review requested again. Before, their approval from 3 hours ago was dismissed."],
  ] as const)("a re-request is dashed, ringed in the earlier %s if it still counts", (previous, ring, detail) => {
    const look = reviewerLook(reviewer({ status: "rerequested", previous, dismissedFrom: previous === "dismissed" ? "approved" : null }), NOW);
    expect(look).toMatchObject({ glyph: "sync", waiting: true, ring, detail });
  });

  test("says a recent poke, a bot and a team", () => {
    const poked = reviewerLook(reviewer({ status: "pending", at: null }), NOW, NOW - 20 * 60_000);
    expect(poked.detail).toBe("Review requested; they haven't reviewed yet. You poked them 20 minutes ago.");
    expect(reviewerLook(reviewer({ status: "pending", at: null }), NOW, NOW - 2 * 3_600_000).detail).not.toContain("poked");
    expect(reviewerLook(reviewer({ status: "commented", kind: "bot" }), NOW).detail).toEndWith("A bot.");
    expect(reviewerLook(reviewer({ status: "pending", kind: "team", at: null }), NOW).detail).toBe(
      "Review requested; nobody from the team has reviewed yet. A team.",
    );
  });
});

describe("standingVerdict", () => {
  test.each([
    [{ status: "approved", dismissId: "R" }, "approved"],
    [{ status: "changes_requested", dismissId: "R" }, "changes_requested"],
    [{ status: "rerequested", previous: "approved", dismissId: "R" }, "approved"],
    [{ status: "approved" }, null],
    [{ status: "rerequested", previous: "dismissed", dismissId: "R" }, null],
  ] as [Overrides, DismissedVerdict | null][])("offers the X only on a standing verdict the viewer may dismiss: %o", (overrides, verdict) => {
    expect(standingVerdict(reviewer(overrides))).toBe(verdict);
  });
});
