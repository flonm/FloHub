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
  | "bell";

type Shape = ["path", { d: string }] | ["circle", { cx: string; cy: string; r: string; class?: string }];

const SVG_NS = "http://www.w3.org/2000/svg";

const ICONS: Record<IconName, Shape[]> = {
  check: [["path", { d: "M3 8.5l3.25 3.25L13 5" }]],
  cross: [["path", { d: "M4.25 4.25l7.5 7.5M11.75 4.25l-7.5 7.5" }]],
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
  bell: [["path", { d: "M8 2.25A3.5 3.5 0 0 0 4.5 5.75v2.5L3 10.75h10l-1.5-2.5v-2.5A3.5 3.5 0 0 0 8 2.25zM6.5 12.75a1.5 1.5 0 0 0 3 0" }]],
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
  for (const [tag, attributes] of ICONS[name]) {
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
