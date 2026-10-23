import type { Meta, StoryObj } from "@storybook/html-vite";
import { el } from "../ui/dom";
import { Picker, type PickerOption } from "../ui/picker";
import { inShadow } from "./shadow";

/** @returns A choice with a title and a line under it. */
function option(value: string, title: string, detail: string, disabled = false): PickerOption {
  return {
    value,
    label: `${title}, ${detail}`,
    disabled,
    content: () => [el("strong", {}, title), el("span", { class: "detail" }, detail)],
  };
}

/** Mounts a picker the way the versions view does, with its choices. */
function render(): HTMLElement {
  const said = el("p", {}, "Picked: v3");
  const picker = new Picker("To", (value) => (said.textContent = `Picked: v${value}`), (picked) => [el("strong", {}, picked ? `v${picked.value}` : "")]);
  picker.setOptions(
    [
      option("3", "v3", "current · reviewed by mona"),
      option("2", "v2", "force-pushed by hubot 3 hours ago"),
      option("1", "v1", "the older side: To can't be older than From", true),
    ],
    "3",
  );
  const host = inShadow(el("div"));
  const style = el("style", {}, `
    .version-pick { display: inline-flex; gap: 6px; align-items: center; height: 26px; padding: 0 8px; border: 1px solid var(--flo-border); border-radius: 6px; background: var(--flo-bg); color: inherit; font: inherit; cursor: pointer; }
    .version-pick svg { width: 12px; height: 12px; transform: rotate(180deg); }
    .picker-list { position: fixed; z-index: 2; min-width: 280px; margin: 0; padding: 4px; border: 1px solid var(--flo-border); border-radius: 8px; background: var(--flo-bg); box-shadow: var(--flo-shadow); list-style: none; }
    .picker-list[hidden] { display: none; }
    .picker-list [role="option"] { display: grid; padding: 6px 8px; border-radius: 6px; cursor: pointer; }
    .picker-list [role="option"]:hover, .picker-list [role="option"]:focus { background: var(--flo-bg-muted); outline: none; }
    .picker-list [aria-selected="true"] { box-shadow: inset 3px 0 0 var(--flo-accent); }
    .picker-list [aria-disabled="true"] { opacity: 0.4; }
    .detail { color: var(--flo-muted); font-size: 12px; }
  `);
  host.shadowRoot!.querySelector(".overview")!.replaceChildren(style, picker.element, said);
  return host;
}

const meta = {
  title: "Stack/Picker",
  tags: ["autodocs"],
  render,
  parameters: {
    docs: {
      description: {
        component:
          "The dropdown the versions view picks versions and reviewers with: a button naming the choice, and a list that shows each choice in full. Click it, or focus it and press the down arrow; the arrows, Home and End move, Enter picks, Escape closes. A choice out of reach is greyed and skipped.",
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Click the button to open the list. */
export const Default: Story = {};
