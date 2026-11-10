import type { Meta, StoryObj } from "@storybook/html-vite";
import { el } from "../ui/dom";
import { MergeCow, MOOS } from "../ui/merge-cow";

/**
 * @param moo What the cow says.
 * @param still Whether she stands still in the middle, so the story can be looked at without chasing her.
 * @returns A line that gives the canvas some height, since the cow walks along the bottom of the window.
 */
function cow(moo: string, still: boolean): HTMLElement {
  for (const previous of document.querySelectorAll("flohub-merge-cow")) previous.remove();
  new MergeCow().render(moo, still);
  return el("p", {}, "The merge cow walks along the bottom of the window.");
}

const meta = {
  title: "Feedback/Merge cow",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "In fun mode, when the viewer watches the pull request on screen get merged, the merge cow crosses the bottom of the page in six seconds and a toast says it in words. She walks for everyone, reduced motion or not.",
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The cow on her way across, as the extension sends her. */
export const Crossing: Story = { render: () => cow(MOOS[0], false) };

/** The cow standing still in the middle, a pose only this story gives her. */
export const Standing: Story = { render: () => cow(MOOS[1], true) };

/** Her longest line, for the speech bubble's width. */
export const LongestMoo: Story = { render: () => cow(MOOS.toSorted((a, b) => b.length - a.length)[0] ?? MOOS[0], true) };
