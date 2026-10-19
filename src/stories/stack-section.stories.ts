import type { Meta, StoryObj } from "@storybook/html-vite";
import { type RawStackPull, deriveStack } from "../core/stack";
import { renderStackSection } from "../ui/stack-view";
import { inShadow, NOW, pull, stack } from "./shadow";

interface Args {
  /** The layers, base first. */
  pulls: RawStackPull[];
  /** The layer being viewed. */
  current: number;
  stacked: boolean;
  collapsed: boolean;
  showMerged: boolean;
}

/** Renders the section and re-renders it when its toggles are clicked, as the bar does. */
function render(args: Args): HTMLElement {
  const state = { collapsed: args.collapsed, showMerged: args.showMerged };
  const viewed = args.pulls.find((entry) => entry.number === args.current) ?? args.pulls[0]!;
  const view = deriveStack({ ...viewed, stack: args.stacked ? stack(args.pulls) : null }, "main");
  const host = inShadow(document.createElement("div"));
  const mount = host.shadowRoot!.querySelector(".overview")!;
  const draw = () =>
    mount.replaceChildren(
      renderStackSection(view, {
        ...state,
        now: NOW,
        toggleCollapsed: () => {
          state.collapsed = !state.collapsed;
          draw();
        },
        toggleMerged: () => {
          state.showMerged = !state.showMerged;
          draw();
        },
      }),
    );
  draw();
  return host;
}

const EVERY_STATUS = [
  pull(338, "refactor(git): extract rebase planner", { state: "MERGED", mergedAt: "2026-10-05T12:00:00Z" }, [3, 3], 240),
  pull(340, "feat(stack): read stack metadata from the API", { isInMergeQueue: true, reviewDecision: "APPROVED" }, [2, 2], 48),
  pull(341, "feat(stack): adopt server-rebased branches", { reviewDecision: "APPROVED" }, [7, 7], 26),
  pull(344, "feat(stack): keep stacked layers in sync", { reviewDecision: "APPROVED" }, [2, 4], 3),
  pull(345, "fix(stack): retarget after the parent merges", { reviewDecision: "CHANGES_REQUESTED" }, [1, 3], 6),
  pull(346, "test(stack): cover rebase adoption", {}, [0, 0], 0.5),
  pull(347, "refactor(stack): share push helpers", { mergeable: "CONFLICTING" }, [1, 1], 50),
  pull(348, "feat(stack): show adopted branches in status", { statusCheckRollup: { state: "FAILURE" } }, [0, 3], 5),
  pull(349, "docs(stack): document server rebases", { isDraft: true }, [0, 0], 190),
];

const meta = {
  title: "Stack/Section",
  render,
  args: { pulls: EVERY_STATUS, current: 344, stacked: true, collapsed: false, showMerged: true },
  argTypes: { pulls: { control: false } },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<Args>;

/** One layer per status, from merged at the base up to a draft on top. */
export const EveryStatus: Story = {};

/** The bottom two layers sit in the merge queue, in the purple of merged. */
export const MergeQueue: Story = {
  args: {
    current: 352,
    showMerged: false,
    pulls: [
      pull(350, "feat(api): add the stack endpoint", { state: "MERGED", mergedAt: "2026-10-13T09:00:00Z" }, [2, 2], 30),
      pull(351, "feat(api): page through stack entries", { isInMergeQueue: true, reviewDecision: "APPROVED" }, [1, 1], 20),
      pull(352, "feat(ui): render the stack", { isInMergeQueue: true, reviewDecision: "APPROVED" }, [3, 3], 4),
      pull(353, "feat(ui): collapse merged layers", { reviewDecision: "APPROVED" }, [0, 0], 2),
    ],
  },
};

/** Approved layers: yellow until every conversation is resolved, then green. */
export const ApprovedWithAndWithoutOpenConversations: Story = {
  args: {
    current: 361,
    pulls: [
      pull(360, "feat(inbox): group by stack", { reviewDecision: "APPROVED" }, [5, 5], 12),
      pull(361, "feat(inbox): flag stale requests", { reviewDecision: "APPROVED" }, [1, 4], 3),
      pull(362, "feat(inbox): poke from the popup", { reviewDecision: null, latestOpinionatedReviews: { nodes: [{ state: "APPROVED" }] } }, [0, 1], 1),
    ],
  },
};

/** Collapsed to a strip of colored segments, with the current layer's badge. */
export const Collapsed: Story = { args: { collapsed: true } };

/** Merged layers folded into one row. */
export const MergedFolded: Story = { args: { showMerged: false } };

/** A pull request outside any stack, in the merge queue. */
export const NotStackedMerging: Story = {
  args: {
    stacked: false,
    current: 370,
    pulls: [pull(370, "fix(inbox): keep the refresh timer while browsing", { isInMergeQueue: true, reviewDecision: "APPROVED" }, [2, 2], 1)],
  },
};
