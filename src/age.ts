const UNITS: [limitSeconds: number, seconds: number, suffix: string, unit: Intl.RelativeTimeFormatUnit][] = [
  [3_600, 60, "m", "minute"],
  [86_400, 3_600, "h", "hour"],
  [604_800, 86_400, "d", "day"],
  [2_592_000, 604_800, "w", "week"],
  [31_536_000, 2_592_000, "mo", "month"],
  [Number.POSITIVE_INFINITY, 31_536_000, "y", "year"],
];

const SPOKEN = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/**
 * @param timestamp An ISO timestamp in the past.
 * @param now The current time in epoch milliseconds.
 * @returns A compact age like "now", "5m", "3h", "2d", "4w", "6mo" or "1y", and its spoken form.
 */
export function formatAge(timestamp: string, now: number): { short: string; spoken: string } {
  const seconds = Math.max(0, (now - Date.parse(timestamp)) / 1_000);
  if (seconds < 60) return { short: "now", spoken: "just now" };
  for (const [limit, size, suffix, unit] of UNITS) {
    if (seconds < limit) {
      const value = Math.floor(seconds / size);
      return { short: `${value}${suffix}`, spoken: SPOKEN.format(-value, unit) };
    }
  }
  return { short: "", spoken: "" };
}
