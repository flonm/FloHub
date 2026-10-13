import { describe, expect, test } from "bun:test";
import { diffAnchor, matchPath, stateFromCheckbox } from "./viewed";

describe("diffAnchor", () => {
  test("matches the anchor GitHub renders for README.md", async () => {
    expect(await diffAnchor("README.md")).toBe(
      "diff-b335630551682c19a781afebcf4d07bf978fb1f8ac04c6bf87428ed5106870f5",
    );
  });
});

describe("matchPath", () => {
  const paths = ["apps/backend/src/app/lti/lti.service.ts", "apps/backend/test/lti/lti.test.ts", "README.md"];

  test("takes an exact match", () => {
    expect(matchPath("README.md", paths)).toBe("README.md");
  });

  test("takes a unique suffix when the tree hides a leading folder", () => {
    expect(matchPath("src/app/lti/lti.service.ts", paths)).toBe("apps/backend/src/app/lti/lti.service.ts");
  });

  test("refuses an ambiguous suffix", () => {
    expect(matchPath("index.ts", ["a/index.ts", "b/index.ts"])).toBeNull();
  });

  test("does not match inside a file name", () => {
    expect(matchPath("service.ts", paths)).toBeNull();
  });
});

describe("stateFromCheckbox", () => {
  test.each([
    [true, "UNVIEWED", "VIEWED"],
    [true, "DISMISSED", "VIEWED"],
    [false, "VIEWED", "UNVIEWED"],
    [false, "DISMISSED", "DISMISSED"],
    [false, undefined, "UNVIEWED"],
  ] as const)("checked %p over %p → %p", (checked, known, expected) => {
    expect(stateFromCheckbox(checked, known)).toBe(expected);
  });
});
