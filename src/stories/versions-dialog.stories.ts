import type { Meta, StoryObj } from "@storybook/html-vite";
import type { VersionPatch } from "../api/github";
import type { Version, VersionHistory } from "../core/versions";
import { el } from "../ui/dom";
import { VersionsDialog } from "../ui/versions-dialog";
import { NOW } from "./shadow";

const HOUR = 3_600_000;

/** @returns One head the pull request had. */
function version(overrides: Partial<Version> & Pick<Version, "oid" | "number">): Version {
  return {
    at: new Date(NOW - 2 * HOUR).toISOString(),
    pushedBy: "mona",
    reviewedBy: [],
    viewerLatestReview: false,
    current: false,
    ...overrides,
  };
}

const V1 = version({ oid: "1111111", number: 1, at: new Date(NOW - 8 * HOUR).toISOString(), reviewedBy: ["tizian"] });
const V2 = version({ oid: "2222222", number: 2, at: new Date(NOW - 3 * HOUR).toISOString(), viewerLatestReview: true });
const V3 = version({ oid: "3333333", number: 3, at: new Date(NOW - HOUR).toISOString(), current: true });

/** Two versions of one file, and one the newer version adds. */
const PATCHES: Record<string, VersionPatch> = {
  "1111111": {
    mergeBase: "0000000",
    onBase: true,
    truncated: false,
    files: [
      {
        filename: "src/ui/bar.ts",
        status: "modified",
        sha: "aaa",
        patch: "@@ -1,4 +1,4 @@\n import { el } from \"./dom\";\n \n-const RETRIES = 1;\n+const RETRIES = 3;\n export const bar = RETRIES;\n",
      },
    ],
  },
  "2222222": {
    mergeBase: "0000000",
    onBase: true,
    truncated: false,
    files: [
      {
        filename: "src/ui/bar.ts",
        status: "modified",
        sha: "bbb",
        patch: "@@ -1,4 +1,5 @@\n import { el } from \"./dom\";\n \n-const RETRIES = 1;\n+const RETRIES = 3;\n+const BACKOFF_MS = 500;\n export const bar = RETRIES;\n",
      },
      {
        filename: "src/ui/stack-view.ts",
        status: "added",
        sha: "ccc",
        patch: "@@ -0,0 +1,3 @@\n+export const layer = 1;\n+export const trunk = 0;\n+export const gap = 8;\n",
      },
    ],
  },
  "3333333": {
    mergeBase: "0000000",
    onBase: true,
    truncated: false,
    files: [
      {
        filename: "src/ui/bar.ts",
        status: "modified",
        sha: "ddd",
        patch: "@@ -1,5 +1,5 @@\n import { el } from \"./dom\";\n \n const RETRIES = 3;\n-const BACKOFF_MS = 500;\n+const BACKOFF_MS = 250;\n export const bar = RETRIES;\n",
      },
      {
        filename: "src/ui/stack-view.ts",
        status: "added",
        sha: "ccc",
        patch: "@@ -0,0 +1,3 @@\n+export const layer = 1;\n+export const trunk = 0;\n+export const gap = 8;\n",
      },
    ],
  },
};

/** @returns A history of the first count versions, oldest first. */
function history(count: number): VersionHistory {
  return { baseRefOid: "0000000", versions: [V1, V2, V3].slice(0, count), baseHeads: [] };
}

/** Lets the dialog paint its busy state before the fixture answers, as a real request would. */
async function settle(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Opens the dialog the way the versions bar does.
 * @param kind How many versions the pull request has, or "loading"/"failing" for those states.
 * @returns A line behind the backdrop.
 */
function dialog(kind: number | "loading" | "failing"): HTMLElement {
  for (const previous of document.querySelectorAll("flohub-versions")) previous.remove();
  new VersionsDialog().open({
    number: 344,
    repoUrl: "https://github.com/octo-org/api",
    // oxlint-disable-next-line typescript/promise-function-async -- the fixture already holds the promise the dialog asks for
    versions: () => pendingHistory(kind),
    patch: async (_history, current) => {
      await settle();
      return PATCHES[current.oid] ?? PATCHES["2222222"]!;
    },
  });
  return el("p", {}, "The dialog opens over the page; Esc closes it.");
}

/**
 * @param kind How many versions to answer with, or a state that never resolves or rejects.
 * @returns The version history, after a tick.
 */
async function pendingHistory(kind: number | "loading" | "failing"): Promise<VersionHistory> {
  await settle();
  if (kind === "failing") throw new Error("Resource not accessible by personal access token");
  if (kind === "loading") {
    // A timer a day out leaves the dialog on its loading state for the story.
    return new Promise<VersionHistory>((resolve) => {
      setTimeout(resolve, 86_400_000);
    });
  }
  return history(kind);
}

const meta = {
  title: "Stack/Versions dialog",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Compare versions diffs the pull request against itself: each force push and reviewed commit is a version, and two of them are compared file by file, so a reviewer sees what changed since their review rather than the whole diff again.",
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Loading the version history. */
export const Loading: Story = { render: () => dialog("loading") };

/** A pull request with a single head: force pushes and reviews leave no second version to compare. */
export const SingleVersion: Story = { render: () => dialog(1) };

/** Defaults to the viewer's last reviewed version against the current head. */
export const SinceTheViewersReview: Story = { render: () => dialog(3) };

/** The history could not be read. */
export const Fails: Story = { render: () => dialog("failing") };
