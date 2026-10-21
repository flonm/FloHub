import { expect, test } from "bun:test";
import { isValidMessage, isValidRef, maySend, type Message, type SenderInfo } from "./messages";

const ID = "flohub-test";
const ref = { owner: "octo-org", repo: "octo-repo", number: 7 };
const page: SenderInfo = { id: ID, url: "https://github.com/octo-org/octo-repo/pull/7" };
const popup: SenderInfo = { id: ID, url: `chrome-extension://${ID}/popup.html` };

test.each<[Message, SenderInfo, boolean]>([
  [{ type: "overview", ref }, page, true],
  [{ type: "submit-review", ref, event: "APPROVE", body: "" }, page, true],
  [{ type: "overview", ref }, popup, false],
  [{ type: "overview", ref }, { id: "someone-else", url: "https://github.com/x/y/pull/1" }, false],
  [{ type: "overview", ref }, { id: ID, url: "https://evil.example/?github.com/" }, false],
  [{ type: "inbox" }, popup, true],
  [{ type: "inbox" }, page, true],
  [{ type: "open-options" }, page, true],
  [{ type: "open-options" }, popup, false],
])("sending %o from %o is allowed: %s", (message, sender, allowed) => {
  expect(maySend(message, sender, ID)).toBe(allowed);
});

test.each([
  [ref, true],
  [{ owner: "octo-org", repo: "octo-repo", number: 1 }, true],
  [{ owner: "octo-org", repo: ".github", number: 1 }, true],
  [{ owner: "..", repo: "octo-repo", number: 1 }, false],
  [{ owner: ".", repo: "octo-repo", number: 1 }, false],
  [{ owner: "octo/org", repo: "octo-repo", number: 1 }, false],
  [{ owner: "octo%2F..", repo: "octo-repo", number: 1 }, false],
  [{ owner: "octo-org", repo: "octo-repo", number: 0 }, false],
  [{ owner: "octo-org", repo: "octo-repo", number: 1.5 }, false],
  [{ owner: "octo-org", repo: "octo-repo" }, false],
  [null, false],
])("a reference of %o is valid: %s", (value, valid) => {
  expect(isValidRef(value)).toBe(valid);
});

test.each([
  [{ type: "overview", ref }, true],
  [{ type: "rerequest", ref, login: "octocat" }, true],
  [{ type: "poke", ref, reviewer: { kind: "team", name: "github/backend" } }, true],
  [{ type: "poke", ref, reviewer: { kind: "user", name: "octocat" } }, true],
  [{ type: "set-viewed", pullRequestId: "PR_kw", path: "src/app/main.ts", viewed: true }, true],
  [{ type: "submit-review", ref, event: "REQUEST_CHANGES", body: "" }, true],
  [{ type: "version-patch", ref, head: "ccccccc3", bases: ["basebase", "aaaaaaa1"] }, true],
  [{ type: "inbox", maxAgeMs: 60_000 }, true],
  [{ type: "open-options" }, true],
  [{ type: "rerequest", ref, login: "octo cat" }, false],
  [{ type: "poke", ref, reviewer: { kind: "other", name: "octocat" } }, false],
  [{ type: "poke", ref, reviewer: { kind: "user", name: "octo/../cat" } }, false],
  [{ type: "set-viewed", pullRequestId: "PR_kw", path: "src/app/main.ts", viewed: "yes" }, false],
  [{ type: "submit-review", ref, event: "CLOSE", body: "" }, false],
  [{ type: "submit-review", ref, event: "APPROVE", body: 7 }, false],
  [{ type: "version-patch", ref, head: "../../user", bases: ["basebase"] }, false],
  [{ type: "version-patch", ref, head: "ccccccc3", bases: [] }, false],
  [{ type: "version-patch", ref, head: "ccccccc3", bases: Array.from({ length: 9 }, (_, i) => `abc${i}`) }, false],
  [{ type: "inbox", maxAgeMs: -1 }, false],
  [{ type: "overview", ref: { owner: "octo-org", repo: "octo-repo", number: "7" } }, false],
  [{ type: "unknown" }, false],
  [null, false],
  ["not a message", false],
])("acting on %o is safe: %s", (message, safe) => {
  expect(isValidMessage(message)).toBe(safe);
});
