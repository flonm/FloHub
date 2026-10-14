import { describe, expect, test } from "bun:test";
import { deriveStack, deriveStatus, lastActivity, type RawStack, type RawStackPull } from "./stack";

function buildPull(overrides: Partial<RawStackPull> = {}): RawStackPull {
  return {
    number: 7237,
    title: "refactor(api): read memberships from the new store",
    url: "https://github.com/octo-org/octo-repo/pull/7237",
    state: "OPEN",
    isDraft: false,
    isInMergeQueue: false,
    mergeable: "MERGEABLE",
    reviewDecision: "REVIEW_REQUIRED",
    createdAt: "2026-10-01T09:00:00Z",
    lastEditedAt: null,
    mergedAt: null,
    statusCheckRollup: { state: "SUCCESS" },
    latestOpinionatedReviews: { nodes: [] },
    reviewThreads: { totalCount: 0, nodes: [] },
    timelineItems: { nodes: [] },
    ...overrides,
  };
}

function buildStack(pulls: RawStackPull[]): RawStack {
  return {
    number: 7246,
    size: pulls.length,
    baseRefName: "main",
    entries: { nodes: pulls.map((pullRequest, index) => ({ position: index + 1, pullRequest })) },
  };
}

describe("deriveStatus", () => {
  test.each([
    ["merged wins over everything", { state: "MERGED", isDraft: true }, "done", "Merged"],
    ["closed", { state: "CLOSED" }, "neutral", "Closed"],
    ["merging wins over pending and failed checks", { isInMergeQueue: true, statusCheckRollup: { state: "FAILURE" } }, "done", "Merging…"],
    ["draft wins over failing checks", { isDraft: true, statusCheckRollup: { state: "FAILURE" } }, "neutral", "Draft"],
    ["merge conflict", { mergeable: "CONFLICTING", reviewDecision: "APPROVED" }, "danger", "Merge conflict"],
    ["failed checks win over approval", { statusCheckRollup: { state: "FAILURE" }, reviewDecision: "APPROVED" }, "danger", "Checks failed"],
    ["errored checks", { statusCheckRollup: { state: "ERROR" } }, "danger", "Checks failed"],
    ["changes requested", { reviewDecision: "CHANGES_REQUESTED" }, "attention", "Changes requested"],
    ["ready to merge with no checks", { reviewDecision: "APPROVED", statusCheckRollup: null }, "success", "Ready to merge"],
    ["review required", { reviewDecision: "REVIEW_REQUIRED" }, "accent", "Needs review"],
  ] as const)("%s", (_name, overrides, tone, label) => {
    expect(deriveStatus(buildPull(overrides as Partial<RawStackPull>))).toMatchObject({ tone, label });
  });

  test("says a queued pull request is merging", () => {
    expect(deriveStatus(buildPull({ isInMergeQueue: true }))).toEqual({ tone: "done", label: "Merging…", detail: "In the merge queue." });
  });

  test("treats an overview cached without the merge queue field as not queued", () => {
    const { isInMergeQueue: _, ...cached } = buildPull({ reviewDecision: "APPROVED" });

    expect(deriveStatus(cached).label).toBe("Ready to merge");
  });

  test("an approval with unresolved conversations is not ready to merge yet", () => {
    const pull = buildPull({
      reviewDecision: "APPROVED",
      reviewThreads: { totalCount: 3, nodes: [{ isResolved: true }, { isResolved: false }, { isResolved: false }] },
    });

    expect(deriveStatus(pull)).toEqual({
      tone: "attention",
      label: "Unresolved comments",
      detail: "Approved, but 2 conversations are still unresolved.",
    });
  });

  test("names a single unresolved conversation, also on a layer approved without a review decision", () => {
    const pull = buildPull({
      reviewDecision: null,
      latestOpinionatedReviews: { nodes: [{ state: "APPROVED" }] },
      reviewThreads: { totalCount: 1, nodes: [{ isResolved: false }] },
    });

    expect(deriveStatus(pull)).toMatchObject({ label: "Unresolved comments", detail: "Approved, but 1 conversation is still unresolved." });
  });

  test.each(["PENDING", "EXPECTED"] as const)("an approved pull request whose checks are %s shows them running", (state) => {
    const pull = buildPull({ reviewDecision: "APPROVED", statusCheckRollup: { state } });

    expect(deriveStatus(pull)).toEqual({
      tone: "neutral",
      label: "Checks running",
      detail: "Approved, waiting for checks to finish before this can merge.",
    });
  });

  test("unresolved conversations and a missing review outweigh running checks", () => {
    const unresolved = buildPull({
      reviewDecision: "APPROVED",
      statusCheckRollup: { state: "PENDING" },
      reviewThreads: { totalCount: 1, nodes: [{ isResolved: false }] },
    });
    const unreviewed = buildPull({ reviewDecision: "REVIEW_REQUIRED", statusCheckRollup: { state: "PENDING" } });

    expect(deriveStatus(unresolved).label).toBe("Unresolved comments");
    expect(deriveStatus(unreviewed).label).toBe("Needs review");
  });

  test("an approval with every conversation resolved is ready to merge", () => {
    const pull = buildPull({ reviewDecision: "APPROVED", reviewThreads: { totalCount: 2, nodes: [{ isResolved: true }, { isResolved: true }] } });

    expect(deriveStatus(pull)).toEqual({ tone: "success", label: "Ready to merge", detail: null });
  });

  test("unresolved conversations on a pull request nobody approved still need review", () => {
    const pull = buildPull({ reviewThreads: { totalCount: 1, nodes: [{ isResolved: false }] } });

    expect(deriveStatus(pull).label).toBe("Needs review");
  });

  test("counts an approval while branch rules still require more reviews, and says so", () => {
    const pull = buildPull({ reviewDecision: "REVIEW_REQUIRED", latestOpinionatedReviews: { nodes: [{ state: "APPROVED" }] } });

    expect(deriveStatus(pull)).toEqual({
      tone: "success",
      label: "Ready to merge",
      detail: "Approved, but GitHub's branch rules still require more reviews before this can merge.",
    });
  });

  test("an open change request outweighs an approval", () => {
    const pull = buildPull({
      reviewDecision: "REVIEW_REQUIRED",
      latestOpinionatedReviews: { nodes: [{ state: "APPROVED" }, { state: "CHANGES_REQUESTED" }] },
    });

    expect(deriveStatus(pull)).toMatchObject({ tone: "attention", label: "Changes requested" });
  });

  test("falls back to the latest reviews when branch protection gives no decision", () => {
    const approved = buildPull({ reviewDecision: null, latestOpinionatedReviews: { nodes: [{ state: "APPROVED" }] } });
    const blocked = buildPull({
      reviewDecision: null,
      latestOpinionatedReviews: { nodes: [{ state: "APPROVED" }, { state: "CHANGES_REQUESTED" }] },
    });
    const unreviewed = buildPull({ reviewDecision: null });

    expect(deriveStatus(approved).label).toBe("Ready to merge");
    expect(deriveStatus(blocked).label).toBe("Changes requested");
    expect(deriveStatus(unreviewed).label).toBe("Needs review");
  });
});

describe("lastActivity", () => {
  test("takes the newest push, edit or review and ignores missing timestamps", () => {
    const pull = buildPull({
      lastEditedAt: "2026-10-05T10:00:00Z",
      timelineItems: {
        nodes: [
          { __typename: "PullRequestCommit", commit: { committedDate: "2026-10-03T10:00:00Z" } },
          { __typename: "HeadRefForcePushedEvent", createdAt: "2026-10-07T08:00:00Z" },
          { __typename: "PullRequestReview", submittedAt: null },
          { __typename: "PullRequestReview", submittedAt: "2026-10-06T10:00:00Z" },
        ],
      },
    });

    expect(lastActivity(pull)).toBe("2026-10-07T08:00:00Z");
  });

  test("falls back to the creation time", () => {
    expect(lastActivity(buildPull())).toBe("2026-10-01T09:00:00Z");
  });
});

describe("deriveStack", () => {
  test("orders the stack top first, marks the current entry and counts resolved threads", () => {
    const bottom = buildPull({ number: 7235, state: "MERGED", mergedAt: "2026-10-08T10:00:00Z" });
    const middle = buildPull({
      number: 7236,
      reviewThreads: { totalCount: 3, nodes: [{ isResolved: true }, { isResolved: false }, { isResolved: true }] },
    });
    const top = buildPull({ number: 7237, reviewDecision: "APPROVED" });
    const current = { ...middle, stack: buildStack([bottom, middle, top]) };

    const view = deriveStack(current, "feat/base");

    expect(view.entries.map(({ number, position, label, current: isCurrent }) => ({ number, position, label, isCurrent }))).toEqual([
      { number: 7237, position: 3, label: "Ready to merge", isCurrent: false },
      { number: 7236, position: 2, label: "Needs review", isCurrent: true },
      { number: 7235, position: 1, label: "Merged", isCurrent: false },
    ]);
    expect(view.entries[1]).toMatchObject({ resolvedThreads: 2, totalThreads: 3 });
    expect(view).toMatchObject({ number: 7246, baseRefName: "main", currentPosition: 2, size: 3 });
  });

  test("skips entries the token cannot read", () => {
    const stack = buildStack([buildPull({ number: 1 }), buildPull({ number: 2 })]);
    const [first] = stack.entries.nodes;
    if (first) first.pullRequest = null;

    const view = deriveStack({ ...buildPull({ number: 2 }), stack }, "main");

    expect(view.entries.map((entry) => entry.number)).toEqual([2]);
  });

  test("shows a pull request outside any stack on its own", () => {
    const view = deriveStack({ ...buildPull({ number: 7390 }), stack: null }, "main");

    expect(view).toMatchObject({ number: null, baseRefName: "main", size: 1, currentPosition: 1 });
    expect(view.entries).toHaveLength(1);
  });
});
