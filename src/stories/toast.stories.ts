import type { Meta, StoryObj } from "@storybook/html-vite";
import { el } from "../ui/dom";
import { Toast, type ToastTone } from "../ui/toast";

/**
 * A short message that slides up from the bottom of the page.
 *
 * Info and success are announced politely and clear themselves after four seconds; a danger message interrupts the
 * screen reader and stays for eight. `render` paints one without the timer, which is what a story uses.
 * @param text The message.
 * @param tone The left border's color.
 * @returns A line that gives the canvas some height, since the toast itself floats.
 */
function toast(text: string, tone: ToastTone): HTMLElement {
  for (const previous of document.querySelectorAll("flohub-toast")) previous.remove();
  new Toast().render(text, tone);
  return el("p", {}, "The toast appears fixed at the bottom of the page.");
}

const meta = {
  title: "Feedback/Toast",
  tags: ["autodocs"],
  parameters: {
    docs: { description: { component: "Short messages for clipboard copies, reviews and failed actions." } },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** A neutral note, like a review that was submitted. */
export const Info: Story = { render: () => toast("Copied gh pr checkout 344", "info") };

/** A confirmation, like a re-requested review. */
export const Success: Story = { render: () => toast("Copied https://github.com/octo-org/api/pull/121", "success") };

/** An error, announced immediately and kept on screen longer. */
export const Danger: Story = { render: () => toast("Could not mark src/ui/bar.ts as viewed: Resource not accessible", "danger") };
