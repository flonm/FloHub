import type { Meta, StoryObj } from "@storybook/html-vite";
import type { DiscussionItem } from "../core/discussion";
import { renderDiscussionSection } from "../ui/discussion-view";
import { inShadow, NOW } from "./shadow";

const HOUR = 3_600_000;

/**
 * @param overrides The identity and text, plus whatever the item's state needs.
 * @returns A review text or a general comment.
 */
function item(overrides: Partial<DiscussionItem> & Pick<DiscussionItem, "key" | "author" | "text">): DiscussionItem {
  return {
    avatarUrl: null,
    profileUrl: `https://github.com/${overrides.author}`,
    bot: false,
    verdict: null,
    html: null,
    at: new Date(NOW - 3 * HOUR).toISOString(),
    url: `https://github.com/octo-org/api/pull/344#discussion_r${overrides.key}`,
    ...overrides,
  };
}

const ITEMS: DiscussionItem[] = [
  item({
    key: "1",
    author: "mona",
    verdict: "changes_requested",
    text: "The retry loop can spin forever when the token is rejected. Please cap it.",
    at: new Date(NOW - 2 * HOUR).toISOString(),
  }),
  item({
    key: "2",
    author: "tizian",
    verdict: "commented",
    text: "Good catch, capped it at three tries. Mind another look?",
    at: new Date(NOW - 90 * 60_000).toISOString(),
  }),
  item({
    key: "3",
    author: "grace",
    text: "One more: the error message should say which scope is missing.",
    at: new Date(NOW - 40 * 60_000).toISOString(),
  }),
  item({
    key: "5",
    author: "coderabbitai[bot]",
    bot: true,
    text: "Summary by CodeRabbit\n\nThe retry cap looks correct now. Nit: the constant could live next to the other timeouts.",
    at: new Date(NOW - 30 * 60_000).toISOString(),
  }),
  item({
    key: "6",
    author: "mona",
    bot: true,
    text: "Stack created with GitHub Stacks CLI",
    at: new Date(NOW - 20 * 60_000).toISOString(),
  }),
  item({
    key: "7",
    author: "hubot",
    text: [
      "Here is a longer review with a little bit of everything.",
      "",
      "- the retry cap",
      "- the scope in the message",
      "- the changelog entry",
      "",
      "And a paragraph that goes on for a while, so the section clamps it behind a Show more toggle instead of letting it push everything else off screen. It keeps going, because a reviewer with a lot to say will always find more words, and the inbox bar should stay tidy regardless.",
    ].join("\n"),
    at: new Date(NOW - 10 * 60_000).toISOString(),
  }),
];

interface Args {
  /** When the viewer last looked; newer items are marked as new. */
  seenAt: string | null;
  expanded: boolean;
  showBots: boolean;
}

/**
 * Mounts the section and re-renders it when its toggles are clicked, as the bar does.
 * @param args The display state.
 * @returns The shadow host.
 */
function render(args: Args): HTMLElement {
  const state = { expanded: args.expanded, showBots: args.showBots };
  const host = inShadow(document.createElement("div"));
  const mount = host.shadowRoot!.querySelector(".overview")!;
  const draw = () => {
    const section = renderDiscussionSection({
      items: ITEMS,
      seenAt: args.seenAt,
      viewer: "tizian",
      now: NOW,
      ...state,
      toggleExpanded: () => {
        state.expanded = !state.expanded;
        draw();
      },
      toggleBots: () => {
        state.showBots = !state.showBots;
        draw();
      },
    });
    mount.replaceChildren(...(section ? [section] : []));
  };
  draw();
  return host;
}

const meta = {
  title: "Stack/Discussion",
  tags: ["autodocs"],
  render,
  args: { seenAt: new Date(NOW - 45 * 60_000).toISOString(), expanded: false, showBots: false },
  argTypes: {
    seenAt: { control: "select", options: [null, new Date(NOW - 45 * 60_000).toISOString(), new Date(NOW - 6 * HOUR).toISOString()] },
  },
  parameters: {
    docs: {
      description: {
        component:
          "Review texts and general comments inside the bar. Collapsed it shows the new ones, or the newest; *Show all* opens the rest, and bots and stack tools stay behind *Show bots*.",
      },
    },
  },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<Args>;

/** Collapsed: the items newer than the last visit, with a New marker on each. */
export const NewSinceLastVisit: Story = {};

/** Nothing new: collapsed to just the newest comment. */
export const NothingNew: Story = { args: { seenAt: new Date(NOW).toISOString() } };

/** Everything, bots included, with the long text clamped behind *Show more*. */
export const ExpandedWithBots: Story = { args: { expanded: true, showBots: true } };

/** The same new items with the bot reviews and the stack tool's comment folded in. */
export const NewWithBots: Story = { args: { showBots: true } };
