import { describe, expect, test } from "bun:test";
import { parsePullRef, pullTab } from "./pull-ref";

describe("parsePullRef", () => {
  test.each([
    "https://github.com/octo-org/octo-repo/pull/7383",
    "https://github.com/octo-org/octo-repo/pull/7383/files",
    "https://github.com/octo-org/octo-repo/pull/7383/changes#diff-abc",
    "https://github.com/octo-org/octo-repo/pull/7383/commits/1c797eb?w=1",
  ])("reads %s", (href) => {
    expect(parsePullRef(href)).toEqual({ owner: "octo-org", repo: "octo-repo", number: 7383 });
  });

  test.each([
    "https://github.com/octo-org/octo-repo/pulls",
    "https://github.com/octo-org/octo-repo/issues/7383",
    "https://github.com/octo-org/octo-repo/pull/new/feature",
    "https://gist.github.com/octo-org/octo-repo/pull/7383",
  ])("ignores %s", (href) => {
    expect(parsePullRef(href)).toBeNull();
  });
});

describe("pullTab", () => {
  test.each([
    ["/octo-org/octo-repo/pull/7383", ""],
    ["/octo-org/octo-repo/pull/7383/files", "/files"],
    ["/octo-org/octo-repo/pull/7383/files/1c797eb..db9a33d", "/files"],
    ["/octo-org/octo-repo/pull/7383/changes", "/changes"],
    ["/octo-org/octo-repo/pull/7383/commits/1c797eb", "/commits"],
    ["/octo-org/octo-repo/pull/7383/checks", "/checks"],
    ["/octo-org/octo-repo/pull/7383/unknown", ""],
  ])("%s → %s", (pathname, tab) => {
    expect(pullTab(pathname)).toBe(tab);
  });
});
