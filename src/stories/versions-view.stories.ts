import type { Meta, StoryObj } from "@storybook/html-vite";
import type { VersionPatch } from "../api/github";
import type { ReviewThread } from "../core/threads";
import { BASE, type SavedRange, type Version, type VersionHistory } from "../core/versions";
import { el } from "../ui/dom";
import { type CommentLine, VersionsView } from "../ui/versions-view";
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
    base: "0000000",
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
    base: "0000000",
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
    base: "0000000",
    files: [
      {
        filename: "src/ui/bar.ts",
        status: "modified",
        sha: "ddd",
        patch: [
          "@@ -1,4 +1,7 @@",
          ' import { el } from "./dom";',
          " ",
          "-const RETRIES = 1;",
          "+const RETRIES = 3;",
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
      base: "0000000",
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

/** Lets the view paint its busy state before the fixture answers, as a real request would. */
async function settle(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * A stand-in for GitHub's Files changed page: its split layout, with the file tree and diff the view takes the place
 * of, under a sticky toolbar, and the comments panel beside them.
 * @returns The page.
 */
function githubPage(): HTMLElement {
  const page = el("div", { id: "diff-comparison-viewer-container" });
  page.style.cssText = "display:flex;min-height:100vh;font:14px/1.5 sans-serif;color:var(--fgColor-default);background:var(--bgColor-default)";
  const layout = el("div");
  layout.style.cssText = "flex:1;min-width:0;display:flex;flex-wrap:wrap;align-content:flex-start;gap:0 16px;padding:0 16px";
  const toolbar = el("section", {}, "GitHub's toolbar: file filter, viewed count, Submit review");
  toolbar.style.cssText = "position:sticky;top:0;flex:1 1 100%;height:60px;display:flex;align-items:center;border-bottom:1px solid var(--borderColor-default);background:var(--bgColor-default);z-index:1";
  const pane = el("div");
  pane.style.cssText = "position:sticky;top:60px;width:240px";
  pane.append(el("div", { "data-component": "SplitPageLayout.Pane" }, "GitHub's file tree"));
  const content = el("div", { "data-component": "SplitPageLayout.Content" }, "GitHub's diff");
  content.style.cssText = "flex:1;min-height:2000px";
  layout.append(toolbar, pane, content);
  const comments = el("aside", {}, "GitHub's comments panel, which stays usable beside the view");
  comments.style.cssText = "position:sticky;top:0;align-self:flex-start;width:320px;height:100vh;padding:16px;border-left:1px solid var(--borderColor-default)";
  page.append(layout, comments);
  return page;
}

/**
 * Opens the view the way the versions bar does: in place of GitHub's file tree and diff, or floating over a page
 * without them.
 * @param kind How many versions the pull request has, or "loading"/"failing" for those states.
 * @param patches What each version changes.
 * @param stored What the extension kept from an earlier visit: the versions fetched then, the range compared and
 * whether the viewer chose the side-by-side layout.
 * @param docked Whether the page has GitHub's split layout to dock in.
 * @param target A range to show and a commented line to scroll to, as a comment's menu asks for them.
 * @param threads The pull request's review threads.
 * @returns The page.
 */
function view(
  kind: number | "loading" | "failing",
  patches = PATCHES,
  stored: { cached?: VersionHistory; saved?: SavedRange; split?: boolean } = {},
  docked = true,
  target?: { range: SavedRange; line?: CommentLine },
  threads: ReviewThread[] = [],
): HTMLElement {
  for (const previous of document.querySelectorAll("flohub-versions")) previous.remove();
  const page = docked ? githubPage() : el("p", {}, "A page without GitHub's split layout: the view floats over it.");
  // The view finds its place in the page, so it opens once Storybook has put the page in the document.
  requestAnimationFrame(() => {
    const versions = new VersionsView();
    versions.open({
      key: "octo-org/api#344",
      number: 344,
      repoUrl: "https://github.com/octo-org/api",
      cachedVersions: async () => {
        await settle();
        return stored.cached ?? null;
      },
      // oxlint-disable-next-line typescript/promise-function-async -- the fixture already holds the promise the view asks for
      versions: () => pendingHistory(kind),
      threads: async () => {
        await settle();
        return { threads, pullRequestId: "PR_1", head: V3.oid, author: "mona", pending: null };
      },
      // Posting only waits a moment here: the rows show their + and the threads their Reply and Resolve.
      post: async () => {
        await settle();
      },
      patch: async (_history, current) => {
        await settle();
        return patches[current.oid] ?? patches["2222222"]!;
      },
      savedRange: async () => {
        await settle();
        return stored.saved ?? null;
      },
      saveRange: () => undefined,
      splitView: async () => {
        await settle();
        return stored.split ?? false;
      },
    });
    if (target) versions.goTo(target.range, target.line);
  });
  return page;
}

/**
 * @param kind How many versions to answer with, or a state that never resolves or rejects.
 * @returns The version history, after a tick.
 */
async function pendingHistory(kind: number | "loading" | "failing"): Promise<VersionHistory> {
  await settle();
  if (kind === "failing") throw new Error("Resource not accessible by personal access token");
  if (kind === "loading") {
    // A timer a day out leaves the view on its loading state for the story.
    return new Promise<VersionHistory>((resolve) => {
      setTimeout(resolve, 86_400_000);
    });
  }
  return history(kind);
}

const meta = {
  title: "Stack/Versions view",
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
export const Loading: Story = { render: () => view("loading") };

/** A pull request with a single head: force pushes and reviews leave no second version to compare. */
export const SingleVersion: Story = { render: () => view(1) };

/**
 * Defaults to the viewer's last reviewed version against the current head. Like any diff, a line only in the newer
 * version is green and a line only in the older one red, and a replaced line highlights the words that differ. The
 * +/− beside the code is what the pull request itself does to the line, so a line the pull request adds but that's the
 * same in both versions stays white. TypeScript and SQL get syntax colors. A file the older version created and the
 * newer one drops reads as Deleted, without the markers a whole-file patch would only repeat. The renamed file's path
 * shows where each version renamed it to; its folded context expands on click. The file tree on the left lists the
 * compared files with their version-diff totals; a row jumps to its file.
 */
export const SinceTheViewersReview: Story = { render: () => view(3) };

/**
 * Twelve files across nested folders. The tree merges folders that hold only one folder (`docs/guide/stacks`),
 * collapses a folder on click, and marks the file in view while the diff scrolls.
 */
export const ManyFiles: Story = { render: () => view(3, MANY_PATCHES) };

/** The history could not be read. */
export const Fails: Story = { render: () => view("failing") };

/**
 * Opens on the range the viewer compared last time, here v1 → v3 rather than the default from their last review. The
 * newer side was the head then, so after a push it would move to the new head.
 */
export const RestoredRange: Story = {
  render: () => view(3, PATCHES, { saved: { from: V1.oid, to: V3.oid, toCurrent: true, at: NOW - HOUR } }),
};

/** Shows the versions fetched on an earlier visit straight away, while they are fetched again. */
export const FromTheCache: Story = { render: () => view("loading", PATCHES, { cached: history(3) }) };

/** The versions shown came from an earlier visit, and fetching them again failed: the diff stays, with the error. */
export const RefreshFails: Story = { render: () => view("failing", PATCHES, { cached: history(3) }) };

/** On a page without GitHub's split layout, like the classic Files changed tab, the view floats over the page. */
export const Floating: Story = { render: () => view(3, PATCHES, {}, false) };

/** Code at a version: v2's own changes against the base branch, as GitHub's Files changed tab showed them then. */
export const CodeAtAVersion: Story = {
  render: () => view(3, PATCHES, {}, true, { range: { from: BASE, to: V2.oid, toCurrent: false, at: NOW } }),
};

/**
 * Changes since a comment: opened from a comment on v2's `src/core/retry.ts`, line 13, the view compares v2 with the
 * head and marks the line, though the file has been renamed since and the line changed.
 */
export const ChangesSinceAComment: Story = {
  render: () =>
    view(3, PATCHES, {}, true, {
      range: { from: V2.oid, to: "", toCurrent: true, at: NOW },
      line: { path: "src/core/retry.ts", line: 13, side: "RIGHT" },
    }),
};

/** @returns A one-comment thread started on a version, on a line as that version numbers it. */
function thread(id: string, on: Version, path: string, line: number, body: string, overrides: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id,
    path,
    resolved: false,
    outdated: false,
    line: on.current ? line : null,
    startLine: null,
    originalLine: line,
    originalStartLine: null,
    side: "RIGHT",
    resolvedBy: overrides.resolved ? "mona" : null,
    comments: [
      {
        id: Number(id.slice(1)),
        author: "tizian",
        avatarUrl: null,
        html: `<p>${body}</p>`,
        createdAt: on.at,
        url: `https://github.com/octo-org/api/pull/344#discussion_r${id.slice(1)}`,
        pending: false,
        association: "MEMBER",
        originalCommit: on.oid,
      },
    ],
    ...overrides,
  };
}

const THREADS: ReviewThread[] = [
  thread("t1", V2, "src/core/retry.ts", 13, "500ms is long for a first retry.", { outdated: true }),
  thread("t2", V3, "src/ui/bar.ts", 5, "Is 250 enough when the API is rate limiting? The comment above says it doubles.", {
    originalStartLine: 4,
    startLine: 4,
  }),
  thread("t3", V3, "db/migrations/0042_inbox_pulls.sql", 8, "Should this index be partial?", { resolved: true }),
  thread("t4", V3, "src/ui/bar.ts", 6, "Nit: this label reads better as <code>attempt 2/3</code>.", {
    comments: [
      {
        id: 4,
        author: "you",
        avatarUrl: null,
        html: "<p>Nit: this label reads better as <code>attempt 2/3</code>.</p>",
        createdAt: V3.at,
        url: "",
        pending: true,
        association: "MEMBER",
        originalCommit: V3.oid,
      },
    ],
  }),
  thread("t5", V1, "src/ui/bar.ts", 3, "Why three retries?", { outdated: true }),
  thread("t6", V3, "src/ui/stack-view.ts", 2, "Is the trunk always layer 0?"),
];

/**
 * The review threads at their lines, here since the viewer's review of v2: one written on v2 on a line v3 changed,
 * sitting on the removed line; one on v3 covering two lines; a resolved one, folded; the viewer's pending draft; and, in bar.ts's header,
 * one written on v1 that this diff has no line for; and, in the list of files that make the same change in both
 * versions, the count of stack-view.ts's thread. The file tree counts each file's threads, and Comments hides them.
 * v3 is the head, so a row's + (on hover) opens a box for a new comment; shift-click another row's + to cover the
 * lines between.
 */
export const WithComments: Story = { render: () => view(3, PATCHES, {}, true, undefined, THREADS) };

/**
 * Side by side, between versions: the older version's patch on the left, the newer one's on the right, a line that
 * changed between them beside its replacement. Each side numbers its own version's lines; the − and + are what the
 * pull request does to each line. Long lines wrap.
 */
export const SplitView: Story = { render: () => view(3, PATCHES, { split: true }, true, undefined, THREADS) };

/** Side by side, a version against the base branch: GitHub's own split diff, the base on the left. */
export const SplitCodeAtAVersion: Story = {
  render: () => view(3, PATCHES, { split: true }, true, { range: { from: BASE, to: V3.oid, toCurrent: true, at: NOW } }),
};

/**
 * v2 was made on another base than v3, the branch having been rebased since: the versions' code can't be rebuilt
 * from one base, so their patches are compared line by line, and a line above the diff says it won't match GitHub's
 * diff of the two commits.
 */
export const Rebased: Story = {
  render: () => view(3, { ...PATCHES, "2222222": { ...PATCHES["2222222"]!, mergeBase: "9999999" } }),
};
