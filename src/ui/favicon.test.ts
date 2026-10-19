import { describe, expect, test } from "bun:test";
import { faviconUrl } from "./favicon";

function svgOf(url: string): string {
  return decodeURIComponent(url.replace("data:image/svg+xml,", ""));
}

describe("faviconUrl", () => {
  test("adds a dot in the status color, for light and dark tab strips", () => {
    const svg = svgOf(faviconUrl("danger"));
    expect(svg).toContain('<circle class="dot" cx="25" cy="25" r="6.5"/>');
    expect(svg).toContain(".dot{fill:#cf222e}");
    expect(svg).toContain("@media (prefers-color-scheme:dark){.mark{fill:#fff}.dot{fill:#f85149}}");
    expect(svg).toContain('mask="url(#m)"');
  });

  test("shows the plain mark for the default blue status and while the status is unknown", () => {
    for (const tone of ["accent", null] as const) {
      const svg = svgOf(faviconUrl(tone));
      expect(svg).not.toContain("<circle");
      expect(svg).not.toContain("mask=");
    }
  });
});
