import type { Meta, StoryObj } from "@storybook/html-vite";
import type { DismissedVerdict } from "../core/reviewers";
import type { ReviewEvent } from "../core/shortcuts";
import { el } from "../ui/dom";
import { ReviewDialog } from "../ui/review-dialog";

/** Lets the dialog paint its busy state before the fixture answers. */
async function settle(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Opens the modal as the shortcut does. It is a real `<dialog>`, so Esc closes it and clicking *Approve* submits.
 * @param event Which review the dialog submits.
 * @param options The pending review it reports, and the error a submit would answer with.
 * @returns A line behind the backdrop.
 */
function dialog(event: ReviewEvent, options: { pending?: Promise<number | null>; failure?: string } = {}): HTMLElement {
  for (const previous of document.querySelectorAll("flohub-dialog")) previous.remove();
  new ReviewDialog().open({
    event,
    number: 344,
    pendingComments: options.pending ?? Promise.resolve(null),
    submit: async () => {
      await settle();
      return options.failure ?? null;
    },
  });
  return el("p", {}, "The dialog opens over the page; Esc closes it.");
}

/**
 * Opens the dismissal the chip's X opens. The reason is required, so the button waits for one.
 * @param verdict What the dismissed review is.
 * @param failure The error a submit would answer with.
 * @returns A line behind the backdrop.
 */
function dismissal(verdict: DismissedVerdict, failure?: string): HTMLElement {
  for (const previous of document.querySelectorAll("flohub-dialog")) previous.remove();
  new ReviewDialog().open({
    event: "DISMISS",
    reviewer: "mona",
    verdict,
    submit: async () => {
      await settle();
      return failure ?? null;
    },
  });
  return el("p", {}, "The dialog opens over the page; Esc closes it.");
}

const meta = {
  title: "Stack/Review dialog",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Approving or requesting changes from the bar, dismissing someone's review with the reason GitHub requires, or asking a reviewer to look again at what changed since their verdict. An empty change request is sent with a zero-width space, since GitHub refuses a bodyless one; a pending review with draft comments is submitted along with it.",
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Approving without a pending review. */
export const Approve: Story = { render: () => dialog("APPROVE") };

/** Requesting changes: the comment is still optional. */
export const RequestChanges: Story = { render: () => dialog("REQUEST_CHANGES") };

/** A pending review is about to be submitted with its draft comments. */
export const PendingReview: Story = { render: () => dialog("APPROVE", { pending: Promise.resolve(2) }) };

/** The pending comments could not be checked; the dialog still submits. */
export const PendingCheckFails: Story = {
  render: () => dialog("REQUEST_CHANGES", { pending: Promise.reject(new Error("network")) }),
};

/** Clicking Approve shows the error and re-enables the buttons. */
export const SubmitFails: Story = {
  render: () => dialog("APPROVE", { failure: "GitHub rejected the review: Resource not accessible by personal access token" }),
};

/** Dismissing an approval: Dismiss review stays disabled until there is a reason. */
export const DismissApproval: Story = { render: () => dismissal("approved") };

/** Dismissing a change request. */
export const DismissChangeRequest: Story = { render: () => dismissal("changes_requested") };

/** Branch protection can keep the viewer from dismissing; type a reason and submit to see GitHub's refusal. */
export const DismissFails: Story = {
  render: () => dismissal("approved", "Could not dismiss the review: You do not have permission to dismiss this review."),
};

/** Asking a reviewer to look again: the composed comment, ready to edit, and a new review request with it. */
export const AskToLookAgain: Story = {
  render: () => {
    for (const previous of document.querySelectorAll("flohub-dialog")) previous.remove();
    new ReviewDialog().open({
      event: "NUDGE",
      reviewer: "mona",
      rerequest: true,
      body:
        "@mona Since your approval on v2 (`1a2b3c4`): 3 files changed (+12 −4): `src/api.ts`, `src/ui/bar.ts`, `README.md`. " +
        "[See what changed](https://github.com/octo-org/api/pull/7/changes?flohub-versions=aaaaaaa..)",
      submit: async () => {
        await settle();
        return null;
      },
    });
    return el("p", {}, "The dialog opens over the page; Esc closes it.");
  },
};
