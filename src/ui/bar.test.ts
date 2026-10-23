import { describe, expect, test } from "bun:test";
import type { DismissedVerdict, Reviewer } from "../core/reviewers";
import { previousLook, spokenStatus, standingVerdict, statusLook } from "./bar";

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
    canRerequest: false,
    canPoke: false,
    ...overrides,
  };
}

describe("statusLook", () => {
  test.each([
    [{ status: "dismissed", dismissedFrom: "approved" }, { tone: "success", icon: "slash", detail: "approval" }],
    [{ status: "dismissed", dismissedFrom: "changes_requested" }, { tone: "attention", icon: "slash", detail: "change request" }],
    [{ status: "dismissed" }, { tone: "muted", icon: "slash", detail: null }],
    [{ status: "approved" }, { tone: "success", icon: "check", detail: null }],
  ] as [Overrides, object][])("a dismissed review keeps the tone of what it had been: %o", (overrides, look) => {
    expect(statusLook(reviewer(overrides))).toMatchObject(look);
  });
});

describe("previousLook", () => {
  test("tints a re-requested reviewer's dismissal with what it had been", () => {
    expect(previousLook(reviewer({ status: "rerequested", previous: "dismissed", dismissedFrom: "changes_requested" }))).toMatchObject({
      text: "was dismissed",
      tone: "attention",
      detail: "change request",
    });
  });

  test("leaves other earlier verdicts plain", () => {
    expect(previousLook(reviewer({ status: "rerequested", previous: "approved" }))).toMatchObject({ text: "was approved", detail: null });
    expect(previousLook(reviewer({ status: "rerequested", previous: "dismissed" }))).toMatchObject({ text: "was dismissed", detail: null });
    expect(previousLook(reviewer({ status: "approved" }))).toBeNull();
  });
});

describe("spokenStatus", () => {
  test.each([
    [{ status: "dismissed", dismissedFrom: "approved" }, "dismissed approval"],
    [{ status: "dismissed" }, "dismissed"],
    [{ status: "rerequested", previous: "dismissed", dismissedFrom: "approved" }, "re-requested, approval was dismissed"],
    [{ status: "rerequested", previous: "approved" }, "re-requested, was approved"],
  ] as [Overrides, string][])("screen readers hear what a dismissal had been: %o", (overrides, text) => {
    expect(spokenStatus(reviewer(overrides))).toBe(text);
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
