import type { Meta, StoryObj } from "@storybook/html-vite";
import type { ViewedFiles } from "../core/viewed";
import { el } from "../ui/dom";
import { ViewedTree } from "../ui/file-tree";

/** The files the fake pull request changes, and what the viewer has marked. */
const VIEWED: ViewedFiles = {
  pullRequestId: "PR_kwDOAbc123",
  files: [
    { path: "src/ui/bar.ts", viewerViewedState: "VIEWED", additions: 42, deletions: 7 },
    { path: "src/ui/stack-view.ts", viewerViewedState: "UNVIEWED", additions: 12, deletions: 3 },
    { path: "src/core/stack.ts", viewerViewedState: "DISMISSED", additions: 5, deletions: 1 },
    { path: "src/styles/tokens.css", viewerViewedState: "VIEWED", additions: 18, deletions: 4 },
    { path: "README.md", viewerViewedState: "VIEWED", additions: 24, deletions: 0 },
    { path: "docs/logo.png", viewerViewedState: "UNVIEWED", additions: 0, deletions: 0 },
  ],
};

/** Answers the two messages `ViewedTree` sends, since Storybook has no service worker behind it. */
function stubChrome(): void {
  Object.assign(globalThis, {
    chrome: {
      runtime: {
        sendMessage: (message: { type: string; path?: string; viewed?: boolean }) => {
          if (message.type === "viewed-files") return { ok: true, value: VIEWED };
          if (message.type === "set-viewed") {
            const file = VIEWED.files.find((entry) => entry.path === message.path);
            if (file) file.viewerViewedState = message.viewed ? "VIEWED" : "UNVIEWED";
            return { ok: true, value: null };
          }
          return { ok: false, code: "failed", message: `Unexpected message: ${message.type}` };
        },
      },
    },
  });
}

/** @returns GitHub's Files changed tree, as `ViewedTree` expects to find it: one treeitem per file. */
function tree(): HTMLElement {
  stubChrome();
  const list = el("ul", { role: "tree", "aria-label": "Files changed" });
  for (const file of VIEWED.files) {
    const name = file.path.slice(file.path.lastIndexOf("/") + 1);
    const item = el("li", { role: "treeitem" });
    item.append(el("div", { class: "row" }, name), el("span", { hidden: "", "data-filterable-item-text": "" }, file.path));
    list.append(item);
  }
  // The tree must be in the page before it can be decorated, and the states arrive from the stub asynchronously.
  setTimeout(() => new ViewedTree(() => undefined).sync({ owner: "octo-org", repo: "api", number: 344 }), 0);
  return list;
}

const meta = {
  title: "Files/Viewed tree",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "FloHub's Viewed checkbox and line counts, drawn onto GitHub's own file tree. A viewed file dims, a file that changed after it was marked gets an amber dot, and clicking a checkbox marks it through the API. Normally this sits inside the Files changed tab; here the tree is bare so the decorations stand out.",
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Six files: viewed, unviewed, and one that changed since it was viewed. */
export const Viewed: Story = { render: () => tree() };
