import type { StackTone } from "../core/stack";

const MARK =
  "M16 0C7.16 0 0 7.16 0 16C0 23.08 4.58 29.06 10.94 31.18C11.74 31.32 12.04 30.84 12.04 30.42C12.04 30.04 12.02 28.78 12.02 27.44C8 28.18 6.96 26.46 6.64 25.56C6.46 25.1 5.68 23.68 5 23.3C4.44 23 3.64 22.26 4.98 22.24C6.24 22.22 7.14 23.4 7.44 23.88C8.88 26.3 11.18 25.62 12.1 25.2C12.24 24.16 12.66 23.46 13.12 23.06C9.56 22.66 5.84 21.28 5.84 15.16C5.84 13.42 6.46 11.98 7.48 10.86C7.32 10.46 6.76 8.82 7.64 6.62C7.64 6.62 8.98 6.2 12.04 8.26C13.32 7.9 14.68 7.72 16.04 7.72C17.4 7.72 18.76 7.9 20.04 8.26C23.1 6.18 24.44 6.62 24.44 6.62C25.32 8.82 24.76 10.46 24.6 10.86C25.62 11.98 26.24 13.4 26.24 15.16C26.24 21.3 22.5 22.66 18.94 23.06C19.52 23.56 20.02 24.52 20.02 26.02C20.02 28.16 20 29.88 20 30.42C20 30.84 20.3 31.34 21.1 31.18C27.42 29.06 32 23.06 32 16C32 7.16 24.84 0 16 0Z";

/** The dot's color on a light and on a dark tab strip; blue, the default state, gets no dot. */
const DOT: Record<Exclude<StackTone, "accent">, [light: string, dark: string]> = {
  success: ["#1a7f37", "#3fb950"],
  attention: ["#bf8700", "#d29922"],
  danger: ["#cf222e", "#f85149"],
  done: ["#8250df", "#ab7df8"],
  neutral: ["#818b98", "#9198a1"],
};

/**
 * GitHub's mark with a dot in the bottom right corner, cut out of the mark like GitHub's own checks favicons.
 * @param tone The pull request's status, or null for the plain mark.
 * @returns The favicon as a data URL.
 */
export function faviconUrl(tone: StackTone | null): string {
  const colors = tone && tone !== "accent" ? DOT[tone] : null;
  const dot = colors
    ? `<mask id="m"><rect width="32" height="32" fill="#fff"/><circle cx="25" cy="25" r="8.5"/></mask><circle class="dot" cx="25" cy="25" r="6.5"/>`
    : "";
  const style = `.mark{fill:#24292e}.dot{fill:${colors?.[0] ?? "none"}}@media (prefers-color-scheme:dark){.mark{fill:#fff}.dot{fill:${colors?.[1] ?? "none"}}}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><style>${style}</style>${dot}<path class="mark" fill-rule="evenodd" d="${MARK}"${colors ? ' mask="url(#m)"' : ""}/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Replaces GitHub's favicons, which show the checks, and keeps them replaced while GitHub updates them. */
export class Favicon {
  private href: string | null = null;
  private readonly observer = new MutationObserver(() => {
    this.apply();
  });

  /** @param href The favicon to show, or null to give GitHub's back. */
  set(href: string | null): void {
    if (href === this.href) return;
    this.href = href;
    if (href) {
      this.apply();
      this.observer.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
    } else {
      this.observer.disconnect();
      restore();
    }
  }

  private apply(): void {
    if (!this.href) return;
    for (const link of icons()) {
      if (link.getAttribute("href") === this.href) continue;
      link.dataset.flohubOriginalHref = link.getAttribute("href") ?? "";
      link.dataset.flohubOriginalType = link.type;
      link.type = "image/svg+xml";
      link.setAttribute("href", this.href);
    }
  }

}

function restore(): void {
  for (const link of icons()) {
    const original = link.dataset.flohubOriginalHref;
    if (original === undefined) continue;
    const type = link.dataset.flohubOriginalType;
    if (type) link.type = type;
    else link.removeAttribute("type");
    link.setAttribute("href", original);
    delete link.dataset.flohubOriginalHref;
    delete link.dataset.flohubOriginalType;
  }
}

function icons(): HTMLLinkElement[] {
  return [...document.head.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')];
}
