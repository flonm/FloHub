import { describe, expect, test } from "bun:test";
import { inlineBox } from "./anchor";

describe("inlineBox", () => {
  test("beside a capped header, as on the Overview page, the bar takes its cap and centres", () => {
    expect(inlineBox("1356px")).toEqual({ maxWidth: "1356px", marginInline: "auto" });
  });

  test.each(["none", ""])("beside an uncapped header (%p) the bar spans the band", (maxWidth) => {
    expect(inlineBox(maxWidth)).toEqual({ maxWidth: "", marginInline: "" });
  });
});
