import { describe, expect, test } from "bun:test";
import { diffAnchor, formatDiffStat, matchPath, stateFromCheckbox } from "./viewed";

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

describe("formatDiffStat", () => {
  test("shows both counts with a plus and a minus sign", () => {
    expect(formatDiffStat(12, 3)).toEqual({ added: "+12", deleted: "\u22123", label: "12 additions, 3 deletions", width: 6 });
  });

  test("leaves out a side without lines and uses singular nouns", () => {
    expect(formatDiffStat(1, 0)).toEqual({ added: "+1", deleted: null, label: "1 addition, 0 deletions", width: 2 });
    expect(formatDiffStat(0, 1)).toEqual({ added: null, deleted: "\u22121", label: "0 additions, 1 deletion", width: 2 });
  });

  test("groups thousands", () => {
    expect(formatDiffStat(1234, 56789)).toMatchObject({ added: "+1,234", deleted: "\u221256,789", width: 14 });
  });

  test("shows nothing for a binary file or a pure rename", () => {
    expect(formatDiffStat(0, 0)).toBeNull();
  });
});
