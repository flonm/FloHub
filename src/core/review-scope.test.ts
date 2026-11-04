import { describe, expect, test } from "bun:test";
import { IGNORED_REPOS_KEY, parseRepo, REVIEW_SCOPES_KEY, scopesFrom } from "./review-scope";

describe("parseRepo", () => {
  test("accepts owner/repo and GitHub links to a repository", () => {
    expect(parseRepo(" octo-org/octo-repo ")).toBe("octo-org/octo-repo");
    expect(parseRepo("https://github.com/octo-org/octo.repo/pull/12")).toBe("octo-org/octo.repo");
    expect(parseRepo("github.com/octo-org/octo-repo.git")).toBe("octo-org/octo-repo");
  });

  test("rejects input that names no repository", () => {
    expect(parseRepo("octo-org")).toBeNull();
    expect(parseRepo("octo org/repo")).toBeNull();
    expect(parseRepo("")).toBeNull();
  });
});

describe("scopesFrom", () => {
  test("reads direct and ignored repositories, and leaves out the rest", () => {
    const scopes = scopesFrom({ [REVIEW_SCOPES_KEY]: ["octo-org/api"], [IGNORED_REPOS_KEY]: ["octo-org/docs"] });
    expect([...scopes]).toEqual([
      ["octo-org/api", "direct"],
      ["octo-org/docs", "none"],
    ]);
  });

  test("counts none for a repository in both lists, and skips what isn't a list of names", () => {
    expect([...scopesFrom({ [REVIEW_SCOPES_KEY]: ["octo-org/api", 3], [IGNORED_REPOS_KEY]: ["octo-org/api"] })]).toEqual([["octo-org/api", "none"]]);
    expect(scopesFrom({ [REVIEW_SCOPES_KEY]: "octo-org/api" }).size).toBe(0);
    expect(scopesFrom({}).size).toBe(0);
  });
});
