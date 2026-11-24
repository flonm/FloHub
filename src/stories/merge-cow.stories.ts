import type { Meta, StoryObj } from "@storybook/html-vite";
import { type CowTrick, TRICKS } from "../core/cow";
import { SHOWS } from "../ui/cow-tricks";
import { el } from "../ui/dom";
import { MergeCow } from "../ui/merge-cow";

interface Args {
  trick: CowTrick;
  /** Where in the show to hold her still, from 0 to 1; -1 lets the show play. */
  moment: number;
  moo: string;
}

const tricks = Object.keys(SHOWS) as CowTrick[];

/**
 * @param args The trick, the moment to hold and what she says.
 * @returns A line that gives the canvas some height, since the cow performs over the whole window.
 */
function cow({ trick, moment, moo }: Args): HTMLElement {
  for (const previous of document.querySelectorAll("flohub-merge-cow")) previous.remove();
  new MergeCow().render(trick, moo || TRICKS[trick].lines[0], moment < 0 ? undefined : moment);
  return el("p", {}, "The merge cow performs over the whole window. Reload the story to see a show again.");
}

const meta = {
  title: "Feedback/Merge cow",
  tags: ["autodocs"],
  render: cow,
  args: { trick: "walk", moment: -1, moo: "" },
  argTypes: {
    trick: { control: "select", options: tricks },
    moment: { control: { type: "range", min: -1, max: 1, step: 0.01 }, description: "Where to hold the show, from 0 to 1; -1 plays it." },
    moo: { control: "text", description: "What she says; empty takes the trick's first line." },
  },
  parameters: {
    docs: {
      description: {
        component:
          "In fun mode, when the viewer watches the pull request on screen get merged, the merge cow performs a trick over the page and a toast says it in words. She performs for everyone, reduced motion or not.",
      },
    },
  },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<Args>;

/** She walks across, as the extension sends her. */
export const Walk: Story = {};

/** She moonwalks from right to left, facing right. */
export const Backwards: Story = { args: { trick: "backwards" } };

/** She dashes across so fast her words drag along behind her. */
export const Gallop: Story = { args: { trick: "gallop" } };

/** She stops in the middle, leans in and blinks at the viewer. */
export const Stare: Story = { args: { trick: "stare" } };

/** She trips, lands on her back with her legs in the air, and gets up. */
export const Trip: Story = { args: { trick: "trip" } };

/** Only her head peeks up from the bottom edge. */
export const Peekaboo: Story = { args: { trick: "peekaboo" } };

/** Any moment of any show, held still: pick the trick and move the slider. */
export const Moment: Story = { args: { moment: 0.5 } };

/** Her longest line of all, for the speech bubble's width. */
export const LongestMoo: Story = {
  args: {
    moment: 0.5,
    moo: Object.values(TRICKS)
      .flatMap((trick): readonly string[] => trick.lines)
      .toSorted((a, b) => b.length - a.length)[0],
  },
};
