import type { Meta, StoryObj } from "@storybook/html-vite";
import { el } from "../dom";
import { type RawStackPull, deriveStatus } from "../stack";
import { badge } from "../stack-view";
import { inShadow, pull } from "./shadow";

/** Every status a layer can show, from the raw pull request that leads to it, most blocking first. */
const SCENARIOS: Record<string, { when: string; overrides: Partial<RawStackPull>; threads?: [number, number] }> = {
  Merged: { when: "Merged", overrides: { state: "MERGED" } },
  Closed: { when: "Closed without merging", overrides: { state: "CLOSED" } },
  Merging: { when: "In the merge queue", overrides: { isInMergeQueue: true, reviewDecision: "APPROVED" } },
  Draft: { when: "Still a draft", overrides: { isDraft: true } },
  "Merge conflict": { when: "Conflicts with its base", overrides: { mergeable: "CONFLICTING" } },
  "Checks failed": { when: "A required check failed", overrides: { statusCheckRollup: { state: "FAILURE" } } },
  "Changes requested": { when: "A reviewer requested changes", overrides: { reviewDecision: "CHANGES_REQUESTED" } },
  "Unresolved comments": {
    when: "Approved, 2 of 5 conversations still open",
    overrides: { reviewDecision: "APPROVED" },
    threads: [3, 5],
  },
  "Checks running": {
    when: "Approved, checks still running",
    overrides: { reviewDecision: "APPROVED", statusCheckRollup: { state: "PENDING" } },
  },
  "Ready to merge": { when: "Approved, every conversation resolved", overrides: { reviewDecision: "APPROVED" }, threads: [4, 4] },
  "Ready to merge, more reviews required": {
    when: "Approved, branch rules want more reviews",
    overrides: { reviewDecision: "REVIEW_REQUIRED", latestOpinionatedReviews: { nodes: [{ state: "APPROVED" }] } },
  },
  "Needs review": { when: "Nobody reviewed it yet", overrides: {} },
};

type Scenario = keyof typeof SCENARIOS;
interface Args {
  scenario: Scenario;
}

function statusOf(scenario: Scenario) {
  const { overrides, threads } = SCENARIOS[scenario]!;
  return deriveStatus(pull(1, scenario, overrides, threads));
}

const meta = {
  title: "Stack/Status",
  render: ({ scenario }) => inShadow(badge(statusOf(scenario))),
  argTypes: { scenario: { control: "select", options: Object.keys(SCENARIOS) } },
  args: { scenario: "Ready to merge" },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<Args>;

/** Each status next to the situation that leads to it. Hover a badge for its detail. */
export const AllStatuses: Story = {
  render: () => {
    const table = el("div");
    table.style.cssText = "display: grid; grid-template-columns: max-content max-content 1fr; gap: 8px 16px; align-items: center;";
    for (const scenario of Object.keys(SCENARIOS) as Scenario[]) {
      const status = statusOf(scenario);
      table.append(badge(status), el("span", {}, SCENARIOS[scenario]!.when), el("span", { class: "entry-number" }, status.detail ?? ""));
    }
    return inShadow(table);
  },
};

export const Merging: Story = { args: { scenario: "Merging" } };
export const UnresolvedComments: Story = { args: { scenario: "Unresolved comments" } };
export const ReadyToMerge: Story = { args: { scenario: "Ready to merge" } };
export const ChangesRequested: Story = { args: { scenario: "Changes requested" } };
