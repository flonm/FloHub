import { describe, expect, test } from "bun:test";
import { formatAge } from "./age";

const NOW = Date.parse("2026-10-13T12:00:00Z");

describe("formatAge", () => {
  test.each([
    ["2026-10-13T11:59:30Z", "now", "just now"],
    ["2026-10-13T11:55:00Z", "5m", "5 minutes ago"],
    ["2026-10-13T09:00:00Z", "3h", "3 hours ago"],
    ["2026-10-11T12:00:00Z", "2d", "2 days ago"],
    ["2026-09-22T12:00:00Z", "3w", "3 weeks ago"],
    ["2026-07-13T12:00:00Z", "3mo", "3 months ago"],
    ["2024-09-13T12:00:00Z", "2y", "2 years ago"],
    ["2026-10-13T12:05:00Z", "now", "just now"],
  ])("%s → %s", (timestamp, short, spoken) => {
    expect(formatAge(timestamp, NOW)).toEqual({ short, spoken });
  });
});
