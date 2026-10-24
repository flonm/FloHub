export type IconName =
  | "check"
  | "cross"
  | "slash"
  | "comment"
  | "dot"
  | "sync"
  | "refresh"
  | "chevron"
  | "people"
  | "branch"
  | "pointer"
  | "gear"
  | "external"
  | "copy"
  | "unfold"
  | "changes"
  | "compare"
  | "file"
  | "push"
  | "bot"
  | "warning"
  | "highlight"
  | "columns"
  | "wrap"
  | "target"
  | "keyboard"
  | "pin"
  | "clock";

type Shape = ["path", { d: string; class?: string }] | ["circle", { cx: string; cy: string; r: string; class?: string }];

const SVG_NS = "http://www.w3.org/2000/svg";

const ICONS: Record<IconName, Shape[]> = {
  external: [["path", { d: "M9.5 2.75h3.75V6.5M13.25 2.75 7.75 8.25M11.5 9.25v3.25a.75.75 0 0 1-.75.75h-7.5a.75.75 0 0 1-.75-.75v-7.5a.75.75 0 0 1 .75-.75H6.5" }]],
  check: [["path", { d: "M3 8.5l3.25 3.25L13 5" }]],
  copy: [["path", { d: "M5.75 5.75h7.5v7.5h-7.5zM10.25 5.75v-3h-7.5v7.5h3" }]],
  unfold: [["path", { d: "M8 1.75v4M5.75 3.75 8 1.75l2.25 2M8 14.25v-4M5.75 12.25 8 14.25l2.25-2M2.5 8h1M6.5 8h1M10.5 8h1M14 8h-.5" }]],
  cross: [["path", { d: "M4.25 4.25l7.5 7.5M11.75 4.25l-7.5 7.5" }]],
  /** A page with a plus over a minus, GitHub's sign for a change request. */
  changes: [["path", { d: "M3.75 1.75h5.5l3 3v9.5h-8.5zM8 5v4M6 7h4M6 11.25h4" }]],
  compare: [
    ["circle", { cx: "4", cy: "3.75", r: "1.75" }],
    ["circle", { cx: "12", cy: "12.25", r: "1.75" }],
    ["path", { d: "M4 5.5v4.75c0 1.1.9 2 2 2h3.5M8 10.75l1.5 1.5-1.5 1.5M12 10.5V5.75c0-1.1-.9-2-2-2H6.5M8 5.25l-1.5-1.5L8 2.25" }],
  ],
  file: [["path", { d: "M3.75 1.75h5.5l3 3v9.5h-8.5zM9.25 1.75v3h3" }]],
  push: [["path", { d: "M8 12.5V2.75M4.75 6 8 2.75 11.25 6M3.25 14.25h9.5" }]],
  bot: [
    ["path", { d: "M3.25 6.25h9.5v6.5h-9.5zM8 3.5v2.75M1.75 8.75v2M14.25 8.75v2" }],
    ["circle", { cx: "8", cy: "2.75", r: "0.75" }],
    ["circle", { cx: "6", cy: "9.25", r: "0.75", class: "fill" }],
    ["circle", { cx: "10", cy: "9.25", r: "0.75", class: "fill" }],
  ],
  warning: [["path", { d: "M8 2.25 14.25 13.5H1.75zM8 6.5v3.25M8 11.6v.05" }]],
  highlight: [["path", { d: "M9.75 2.25l4 4-6.5 6.5h-4v-4zM2 14.25h5" }]],
  columns: [["path", { d: "M2.25 2.75h11.5v10.5H2.25zM8 2.75v10.5" }]],
  keyboard: [["path", { d: "M1.75 4.25h12.5v7.5H1.75zM4 6.75h.01M6.5 6.75h.01M9 6.75h.01M11.5 6.75h.01M5 9.25h6" }]],
  target: [
    ["circle", { cx: "8", cy: "8", r: "5.25" }],
    ["circle", { cx: "8", cy: "8", r: "1.75", class: "fill" }],
    ["path", { d: "M8 1v2.25M8 12.75V15M1 8h2.25M12.75 8H15" }],
  ],
  pin: [["path", { d: "M5.75 2.25h4.5M7 2.25v3.5L4.75 9.25h6.5L9 5.75v-3.5M8 9.25v4.5" }]],
  clock: [
    ["circle", { cx: "8", cy: "8", r: "6.25" }],
    ["path", { d: "M8 4.5V8l2.5 1.75" }],
  ],
  wrap: [["path", { d: "M2.25 4h11.5M2.25 8h9.25a2.25 2.25 0 0 1 0 4.5H8.5M10 11 8.5 12.5 10 14M2.25 12.5H5.5" }]],
  slash: [
    ["circle", { cx: "8", cy: "8", r: "5.75" }],
    ["path", { d: "M3.9 12.1l8.2-8.2" }],
  ],
  comment: [["path", { d: "M2.75 3.25h10.5v7.25H8.5L5.25 13v-2.5h-2.5z" }]],
  dot: [["circle", { cx: "8", cy: "8", r: "3.5", class: "fill" }]],
  sync: [["path", { d: "M13.25 8a5.25 5.25 0 0 1-9.4 3.2M2.75 8a5.25 5.25 0 0 1 9.4-3.2M12.5 2v3h-3M3.5 14v-3h3" }]],
  refresh: [["path", { d: "M13 8a5 5 0 1 1-1.6-3.7M13 2.5v2.5h-2.5" }]],
  chevron: [["path", { d: "M4 10l4-4 4 4" }]],
  people: [
    ["circle", { cx: "6", cy: "5.5", r: "2.25" }],
    ["path", { d: "M2 13c0-2.2 1.8-4 4-4s4 1.8 4 4M10.5 3.5a2.25 2.25 0 0 1 0 4.25M12 9.25c1.2.6 2 1.9 2 3.75" }],
  ],
  pointer: [
    [
      "path",
      {
        class: "fill",
        d: "M2.45 6.25H8.25L7.95 4.45C7.85 3.75 8.4 3.15 9.05 3.3C9.55 3.42 9.85 3.9 9.95 4.5L10.1 5.25C12.6 5.2 14.35 6.55 14.35 8.75C14.35 11.2 12.85 12.9 10.6 12.9H9.6C8 12.9 6.9 11.8 6.9 10.4V8.35H2.45A1.05 1.05 0 0 1 2.45 6.25Z",
      },
    ],
  ],
  gear: [
    ["circle", { cx: "8", cy: "8", r: "1.9" }],
    [
      "path",
      {
        d: "M12.39 6.64L14.31 6.92V9.08L12.39 9.36L12.07 10.15L13.23 11.69L11.69 13.23L10.15 12.07L9.36 12.39L9.08 14.31H6.92L6.64 12.39L5.85 12.07L4.31 13.23L2.77 11.69L3.93 10.15L3.61 9.36L1.69 9.08V6.92L3.61 6.64L3.93 5.85L2.77 4.31L4.31 2.77L5.85 3.93L6.64 3.61L6.92 1.69H9.08L9.36 3.61L10.15 3.93L11.69 2.77L13.23 4.31L12.07 5.85Z",
      },
    ],
  ],
  branch: [
    ["circle", { cx: "5", cy: "3.75", r: "1.75" }],
    ["circle", { cx: "5", cy: "12.25", r: "1.75" }],
    ["circle", { cx: "11", cy: "5", r: "1.75" }],
    ["path", { d: "M5 5.5v5M11 6.75c0 2.5-2.5 3-5.25 4" }],
  ],
};

/**
 * @param tag The element to create.
 * @param attributes Attributes to set.
 * @param text Text content.
 * @returns The element.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  if (text !== undefined) element.textContent = text;
  return element;
}

/**
 * @param name The icon.
 * @param className A class for the svg.
 * @returns A decorative 16×16 icon drawn in the current color.
 */
export function icon(name: IconName, className?: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("aria-hidden", "true");
  if (className) svg.setAttribute("class", className);
  const shapes = ICONS[name];
  for (const [tag, attributes] of shapes) {
    const shape = document.createElementNS(SVG_NS, tag);
    for (const [attribute, value] of Object.entries(attributes)) shape.setAttribute(attribute, value);
    svg.append(shape);
  }
  return svg;
}

/**
 * @param className The button's class.
 * @param label The visible label.
 * @param onClick The click handler.
 * @param focusKey A key that keeps focus on this button across re-renders.
 * @returns The button.
 */
export function button(className: string, label: string, onClick: () => void, focusKey: string): HTMLButtonElement {
  const element = el("button", { type: "button", class: className, "data-focus-key": focusKey }, label);
  element.addEventListener("click", onClick);
  return element;
}

/**
 * @param name The icon.
 * @param label The accessible name, also shown as a tooltip.
 * @param onClick The click handler.
 * @param focusKey A key that keeps focus on this button across re-renders.
 * @returns An icon-only button.
 */
export function iconButton(name: IconName, label: string, onClick: () => void, focusKey: string): HTMLButtonElement {
  const element = el("button", {
    type: "button",
    class: "icon-button",
    "aria-label": label,
    title: label,
    "data-focus-key": focusKey,
  });
  element.append(icon(name));
  element.addEventListener("click", onClick);
  return element;
}
