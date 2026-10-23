import type { Meta, StoryObj } from "@storybook/html-vite";
import { shortcutHelp } from "../core/shortcuts";
import { renderShortcutList } from "../ui/shortcut-list";
import { inShadow } from "./shadow";

const meta = {
  title: "Stack/Shortcut list",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Every shortcut FloHub adds, as the options page and the bar's keyboard button list them, from one definition (shortcutHelp), so the two never disagree.",
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** On macOS the stack moves with ⌘. */
export const MacOS: Story = { render: () => inShadow(renderShortcutList(shortcutHelp(true))) };

/** Elsewhere with Ctrl. */
export const OtherSystems: Story = { render: () => inShadow(renderShortcutList(shortcutHelp(false))) };
