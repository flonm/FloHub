import type { Meta, StoryObj } from "@storybook/html-vite";
import { chordHints, shortcutHelp } from "../core/shortcuts";
import { ChordHint } from "../ui/chord-hint";
import { el } from "../ui/dom";

/**
 * @param first A chord's first key, lower case.
 * @returns A line that gives the canvas some height, since the hint itself floats in the middle of the window.
 */
function hint(first: string): HTMLElement {
  for (const previous of document.querySelectorAll("flohub-chord-hint")) previous.remove();
  new ChordHint().show(first.toUpperCase(), chordHints(first, true));
  return el("p", {}, "The hint appears fixed in the middle of the window.");
}

const meta = {
  title: "Feedback/Chord hint",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "After the first key of a chord waits alone for a moment, the hint lists what may follow, from the same definition as the shortcut list. The chord then waits for the next key however long it takes; Esc or a click puts it away.",
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** C: the three things it copies. */
export const Copy: Story = { render: () => hint("c") };

/** R: the review verdicts, and asking the stale reviewers again. */
export const Review: Story = { render: () => hint("r") };

/** D: the one key that may follow. */
export const Draft: Story = { render: () => hint("d") };

/** ?: every shortcut, as the toolbar's keyboard button lists them. */
export const AllShortcuts: Story = {
  render: () => {
    for (const previous of document.querySelectorAll("flohub-chord-hint")) previous.remove();
    new ChordHint().showAll(shortcutHelp(true));
    return el("p", {}, "The list appears fixed in the middle of the window.");
  },
};
