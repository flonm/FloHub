import { describe, expect, test } from "bun:test";
import type { TurnCode } from "../core/turn";
import { listNames, reasonWords, turnSummary } from "./turn-words";

describe("listNames", () => {
  test.each<[string[], string]>([
    [[], ""],
    [["alice"], "alice"],
    [["alice", "bob"], "alice and bob"],
    [["alice", "bob", "carol"], "alice, bob and carol"],
  ])("%p reads %p", (names, sentence) => {
    expect(listNames(names)).toBe(sentence);
  });
});

describe("reasonWords", () => {
  test("words every reason", () => {
    const codes: TurnCode[] = [
      "requested",
      "rerequested",
      "replies",
      "pushed-since-review",
      "changes-requested",
      "ask-again",
      "checks-failed",
      "conflict",
      "ready-to-merge",
      "ask-for-review",
      "waiting-on-reviewers",
      "waiting-on-author",
      "draft",
    ];
    for (const code of codes) expect(reasonWords({ code, count: 2, who: ["alice"] }).text).not.toBe("");
  });

  test("counts replies and names who to wait for", () => {
    expect(reasonWords({ code: "replies", count: 1 }).text).toBe("1 reply");
    expect(reasonWords({ code: "replies", count: 3 })).toMatchObject({ text: "3 replies", tone: "attention" });
    expect(reasonWords({ code: "waiting-on-reviewers", who: ["alice"] }).text).toBe("Waiting for alice");
    expect(reasonWords({ code: "waiting-on-reviewers", who: ["alice", "bob"] })).toMatchObject({
      text: "Waiting for 2 reviewers",
      detail: "Waiting for alice and bob to review.",
    });
    expect(reasonWords({ code: "ask-again", who: ["bob"] }).text).toBe("Ask bob again");
  });
});

describe("turnSummary", () => {
  test("says whose turn it is and why", () => {
    expect(turnSummary({ whose: "you", reasons: [{ code: "replies", count: 2 }, { code: "checks-failed" }] })).toBe("Your turn: 2 replies, checks failed");
    expect(turnSummary({ whose: "them", reasons: [{ code: "waiting-on-reviewers", who: ["alice"] }] })).toBe("Their turn: waiting for alice");
    expect(turnSummary({ whose: "them", reasons: [] })).toBe("Their turn");
    expect(turnSummary({ whose: "none", reasons: [{ code: "draft" }] })).toBeNull();
  });
});
