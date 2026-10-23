import type { Meta, StoryObj } from "@storybook/html-vite";
import { el, icon } from "../ui/dom";
import { Tooltip } from "../ui/tooltip";
import { inShadow } from "./shadow";

/**
 * Mounts a few elements with tips in the bar's shadow root, the way the bar watches its own.
 * @returns The shadow host.
 */
function render(): HTMLElement {
  const toolbar = el("div", { class: "toolbar" });
  const pushes = el("span", { class: "tool static", "data-tip": "Force-pushed 2 times, last 3 hours ago" });
  pushes.append(icon("push"), "Force-pushed 2×");
  const reviewer = el("ul", { class: "reviewer-list" });
  const row = el("li", { class: "reviewer", "data-ring": "success", "data-tip": "mona: Approved 3 hours ago." }, "mona");
  reviewer.append(row);
  toolbar.append(pushes);
  const host = inShadow(toolbar);
  const tooltip = new Tooltip();
  host.shadowRoot!.append(tooltip.element, reviewer);
  tooltip.watch(host.shadowRoot!);
  return host;
}

const meta = {
  title: "Stack/Tooltip",
  tags: ["autodocs"],
  render,
  parameters: {
    docs: {
      description: {
        component:
          "The bar's own tooltip: hover an element with a tip for a quarter second, or focus it, and it shows at once, above the element or below it near the top of the window. It explains what the compact rows and toolbar leave unsaid.",
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Hover the force-push count or the reviewer row. */
export const Default: Story = {};
