import { describe, expect, test } from "bun:test";
import { parseRepo } from "./review-scope";

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
