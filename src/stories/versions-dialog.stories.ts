import type { Meta, StoryObj } from "@storybook/html-vite";
import type { VersionPatch } from "../api/github";
import type { SavedRange, Version, VersionHistory } from "../core/versions";
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

/** A renamed file's patch: a change in the middle of enough context that each side folds away. */
function retryPatch(delay: string): string {
  const before = Array.from({ length: 12 }, (_, index) => ` export const STEP_${index} = ${index};`);
  const after = Array.from({ length: 10 }, (_, index) => ` export const TAIL_${index} = ${index};`);
  return ["@@ -1,22 +1,23 @@ // Retry policy", ...before, `+export const DELAY_MS = ${delay}; // between attempts`, ...after].join("\n");
}

/** A migration's patch: a table, then the index each version builds on it. */
function migrationPatch(index: string[]): string {
  return [
    "@@ -0,0 +1,9 @@",
    "+-- Pull requests the inbox has seen, and when it last fetched them.",
    "+CREATE TABLE inbox_pulls (",
    "+  id bigint PRIMARY KEY,",
    "+  title text NOT NULL,",
    "+  fetched_at timestamptz NOT NULL DEFAULT now()",
    "+);",
    ...index.map((line) => `+${line}`),
  ].join("\n");
}

/** Two versions of one file, one the newer versions add, a migration, and one renamed differently in each. */
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
        filename: "src/core/retry-budget.ts",
        status: "added",
        sha: "a99",
        patch: [
          "@@ -0,0 +1,6 @@",
          "+/** How many retries a session may spend before it gives up. */",
          "+export const RETRY_BUDGET = 12;",
          "+",
          "+export function spend(used: number): boolean {",
          "+  return used < RETRY_BUDGET;",
          "+}",
        ].join("\n"),
      },
      {
        filename: "db/migrations/0042_inbox_pulls.sql",
        status: "added",
        sha: "a42",
        patch: migrationPatch(["", "CREATE INDEX inbox_pulls_fetched ON inbox_pulls (fetched_at);"]),
      },
      {
        filename: "src/ui/stack-view.ts",
        status: "added",
        sha: "ccc",
        patch: "@@ -0,0 +1,3 @@\n+export const layer = 1;\n+export const trunk = 0;\n+export const gap = 8;\n",
      },
      {
        filename: "src/core/retry.ts",
        previousFilename: "src/core/backoff.ts",
        status: "renamed",
        sha: "eee",
        patch: retryPatch("500"),
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
        patch: [
          "@@ -1,5 +1,8 @@",
          ' import { el } from "./dom";',
          " ",
          " const RETRIES = 3;",
          "-const BACKOFF_MS = 500;",
          "+/** Waits between attempts, doubling each time. */",
          "+const BACKOFF_MS = 250;",
          `+const label = (attempt: number): string => \`retry \${attempt + 1} of \${RETRIES}\`;`,
          " export const bar = RETRIES;",
        ].join("\n"),
      },
      {
        filename: "db/migrations/0042_inbox_pulls.sql",
        status: "added",
        sha: "b42",
        patch: migrationPatch(["", "CREATE INDEX inbox_pulls_fetched ON inbox_pulls (fetched_at DESC)", "  WHERE title <> '';"]),
      },
      {
        filename: "src/ui/stack-view.ts",
        status: "added",
        sha: "ccc",
        patch: "@@ -0,0 +1,3 @@\n+export const layer = 1;\n+export const trunk = 0;\n+export const gap = 8;\n",
      },
      {
        filename: "src/core/retry-policy.ts",
        previousFilename: "src/core/backoff.ts",
        status: "renamed",
        sha: "fff",
        patch: retryPatch("250"),
      },
    ],
  },
};

const MANY_PATHS = [
  "README.md",
  "cmd/adopt.go",
  "cmd/rebase.go",
  "cmd/sync.go",
  "docs/guide/stacks/rebasing.md",
  "internal/git/gitops.go",
  "internal/git/gitops_test.go",
  "internal/git/mock_ops.go",
  "internal/stack/stack.go",
  "internal/stack/stack_test.go",
  "skills/gh-stack/SKILL.md",
  "go.mod",
];

/** @returns A patch that sets a value, longer for later files so the diffs scroll. */
function manyPatch(index: number, value: string): string {
  const context = Array.from({ length: 6 + index * 2 }, (_, line) => ` line ${line} of file ${index}`);
  return [`@@ -1,${context.length + 1} +1,${context.length + 1} @@`, ...context, `+const LIMIT_${index} = ${value};`].join("\n");
}

/** Twelve files across nested folders, each changed again between v2 and v3. */
const MANY_PATCHES: Record<string, VersionPatch> = Object.fromEntries(
  [V1, V2, V3].map((current) => [
    current.oid,
    {
      mergeBase: "0000000",
      onBase: true,
      truncated: false,
      files: MANY_PATHS.map((filename, index) => ({
        filename,
        status: "modified",
        sha: `${current.oid}-${index}`,
        patch: manyPatch(index, String(current.number * (index + 1))),
      })),
    },
  ]),
);

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
 * @param patches What each version changes.
 * @param stored What the extension kept from an earlier visit: the versions fetched then and the range compared.
 * @returns A line behind the backdrop.
 */
function dialog(
  kind: number | "loading" | "failing",
  patches = PATCHES,
  stored: { cached?: VersionHistory; saved?: SavedRange } = {},
): HTMLElement {
  for (const previous of document.querySelectorAll("flohub-versions")) previous.remove();
  new VersionsDialog().open({
    key: "octo-org/api#344",
    number: 344,
    repoUrl: "https://github.com/octo-org/api",
    cachedVersions: async () => {
      await settle();
      return stored.cached ?? null;
    },
    // oxlint-disable-next-line typescript/promise-function-async -- the fixture already holds the promise the dialog asks for
    versions: () => pendingHistory(kind),
    patch: async (_history, current) => {
      await settle();
      return patches[current.oid] ?? patches["2222222"]!;
    },
    savedRange: async () => {
      await settle();
      return stored.saved ?? null;
    },
    saveRange: () => undefined,
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

/**
 * Defaults to the viewer's last reviewed version against the current head. Like any diff, a line only in the newer
 * version is green and a line only in the older one red, and a replaced line highlights the words that differ. The
 * +/− beside the code is what the pull request itself does to the line, so a line the pull request adds but that's the
 * same in both versions stays white. TypeScript and SQL get syntax colors. A file the older version created and the
 * newer one drops reads as Deleted, without the markers a whole-file patch would only repeat. The renamed file's path
 * shows where each version renamed it to; its folded context expands on click. The file tree on the left lists the
 * compared files with their version-diff totals; a row jumps to its file.
 */
export const SinceTheViewersReview: Story = { render: () => dialog(3) };

/**
 * Twelve files across nested folders. The tree merges folders that hold only one folder (`docs/guide/stacks`),
 * collapses a folder on click, and marks the file in view while the diff scrolls.
 */
export const ManyFiles: Story = { render: () => dialog(3, MANY_PATCHES) };

/** The history could not be read. */
export const Fails: Story = { render: () => dialog("failing") };

/**
 * Opens on the range the viewer compared last time, here v1 → v3 rather than the default from their last review. The
 * newer side was the head then, so after a push it would move to the new head.
 */
export const RestoredRange: Story = {
  render: () => dialog(3, PATCHES, { saved: { from: V1.oid, to: V3.oid, toCurrent: true, at: NOW - HOUR } }),
};

/** Shows the versions fetched on an earlier visit straight away, while they are fetched again. */
export const FromTheCache: Story = { render: () => dialog("loading", PATCHES, { cached: history(3) }) };

/** The versions shown came from an earlier visit, and fetching them again failed: the diff stays, with the error. */
export const RefreshFails: Story = { render: () => dialog("failing", PATCHES, { cached: history(3) }) };
