import type { Meta, StoryObj } from "@storybook/html-vite";
import { el } from "../ui/dom";
import { type JumpChoice, JumpMenu, type JumpMenuState } from "../ui/jump-menu";

const noop = () => undefined;

/** The three choices, as the menu offers them for a comment written on v1 of a pull request now at v3. */
const OUTDATED: JumpChoice[] = [
  { label: "Changes since v1", detail: "How the code changed from v1, where the comment was written, to the current version", icon: "compare", run: noop },
  { label: "Code at v1", detail: "The pull request's changes as v1 made them, as the comment saw them", icon: "file", run: noop },
  { label: "In the current diff", detail: "The comment is outdated: its lines are gone from the current diff", disabled: true, icon: "target", run: noop },
];

/** A comment on the current version: nothing changed since, and its lines sit in the current diff. */
const CURRENT: JumpChoice[] = [
  { label: "Changes since v3", detail: "v3, where the comment was written, is the current version", disabled: true, icon: "compare", run: noop },
  { label: "Code at v3", detail: "The pull request's changes as v3 made them, as the comment saw them", icon: "file", run: noop },
  { label: "In the current diff", detail: "Where the comment sits in the pull request's current changes", icon: "target", run: noop },
];

/**
 * Opens the menu the way a click on a comment's link to its code does, under a stand-in for the comment's card.
 * @param state What the menu shows.
 * @param then What to do with the menu once it is open, such as showing what arrives next.
 * @returns The card the menu opens from.
 */
function menu(state: JumpMenuState, then?: (jump: JumpMenu, link: HTMLElement) => void): HTMLElement {
  for (const previous of document.querySelectorAll("flohub-jump-menu")) previous.remove();
  const card = el("div");
  card.style.cssText = "width:420px;margin:16px;padding:12px;border:1px solid var(--borderColor-default);border-radius:6px;font:14px/1.5 sans-serif;color:var(--fgColor-default)";
  const link = el("a", { href: "#r4337431097" }, "src/api/version-cache.ts");
  card.append(link, el("p", {}, "[T1] Written on v1, on a line v2 rewrites, so it goes outdated."));
  // The menu places itself under the link, so it opens once Storybook has put the card in the document.
  requestAnimationFrame(() => {
    const jump = new JumpMenu();
    jump.open(link, state);
    then?.(jump, link);
  });
  return card;
}

const meta = {
  title: "Stack/Jump to the code",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Replaces GitHub's jump from a comment in the comments panel to its code, which doesn't scroll while the panel is open and sends an outdated comment to the single-commit view. The menu opens the versions view on the comment's version instead.",
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const FINDING = { count: 2, status: "Finding the version the comment was written on…" };

/** Fetching which version a current comment was written on: its place in the current diff is one click away already. */
export const Loading: Story = { render: () => menu({ kind: "ready", pending: FINDING, choices: [CURRENT[2]!] }) };

/** Fetching which version an outdated comment was written on: its link already says it has no lines in the current diff. */
export const LoadingOutdated: Story = { render: () => menu({ kind: "ready", pending: FINDING, choices: [OUTDATED[2]!] }) };

/** An outdated comment: how the code changed since it, first, and the code as it saw it. */
export const Outdated: Story = { render: () => menu({ kind: "ready", choices: OUTDATED }) };

/** A comment on the current version: nothing changed since, and its lines are in the current diff. */
export const OnTheCurrentVersion: Story = { render: () => menu({ kind: "ready", choices: CURRENT }) };

/** @returns A menu that waits for its version choices, then gets them, with a button to replay it. */
function arriving(): HTMLElement {
  const card = menu({ kind: "ready", pending: FINDING, choices: [CURRENT[2]!] }, (jump, link) => {
    setTimeout(() => jump.open(link, { kind: "ready", choices: CURRENT }), 1800);
  });
  const replay = el("button", { type: "button" }, "Load again");
  replay.addEventListener("click", () => card.replaceWith(arriving()));
  card.append(replay);
  return card;
}

/** The version choices arrive: they take the places held for them, and nothing else moves. "Load again" replays it. */
export const Arriving: Story = { render: arriving };

/** A comment on a commit FloHub doesn't list as a version: the choices show the version current then, and say so. */
export const NearestVersion: Story = {
  render: () =>
    menu({
      kind: "ready",
      choices: [
        { label: "Changes since v2", detail: "How the code changed from v2, where the comment was written, to the current version", icon: "compare", run: noop },
        { label: "Code at v2", detail: "The pull request's changes as v2 made them, as the comment saw them", icon: "file", run: noop },
        OUTDATED[2]!,
      ],
      note: "The comment was written on 9f8e7d6, which isn't a known version, so these show v2, the version current then.",
    }),
};

/** The comment or the versions could not be read: GitHub's own link stays one click away, and so does the current diff. */
export const Fails: Story = {
  render: () => menu({ kind: "failed", message: "Resource not accessible by personal access token", fallback: noop, choices: [CURRENT[2]!] }),
};
