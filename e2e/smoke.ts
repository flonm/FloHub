import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type BrowserContext, chromium, type Page, type Route } from "playwright";

process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";

const EXTENSION = resolve("dist");
const PULL_URL = process.env.PULL_URL ?? "https://github.com/github/gh-stack/pull/344";
const SCREENSHOTS = resolve(process.env.SCREENSHOTS ?? "e2e/screenshots");

function actor(login: string, typename: "User" | "Bot" = "User") {
  return {
    __typename: typename,
    login,
    avatarUrl: `https://avatars.githubusercontent.com/${login}?v=4`,
    url: `https://github.com/${login}`,
  };
}

function review(login: string, state: string, typename: "User" | "Bot" = "User") {
  return { state, submittedAt: "2026-10-12T10:00:00Z", author: actor(login, typename) };
}

const HOUR = 3_600_000;
const REPO_URL = PULL_URL.replace(/\/pull\/\d+$/, "");
const CURRENT = Number(PULL_URL.split("/").pop());

function ago(hours: number): string {
  return new Date(Date.now() - hours * HOUR).toISOString();
}

function stackPull(
  number: number,
  title: string,
  overrides: Record<string, unknown> = {},
  threads: [resolved: number, total: number] = [0, 0],
  pushedHoursAgo = 30,
) {
  const [resolved, total] = threads;
  return {
    number,
    title,
    url: `${REPO_URL}/pull/${number}`,
    state: "OPEN",
    isDraft: false,
    mergeable: "MERGEABLE",
    reviewDecision: "REVIEW_REQUIRED",
    createdAt: ago(200),
    lastEditedAt: null,
    mergedAt: null,
    statusCheckRollup: { state: "SUCCESS" },
    latestOpinionatedReviews: { nodes: [] },
    reviewThreads: {
      totalCount: total,
      nodes: Array.from({ length: total }, (_, index) => ({ isResolved: index < resolved })),
    },
    timelineItems: { nodes: [{ __typename: "HeadRefForcePushedEvent", createdAt: ago(pushedHoursAgo) }] },
    ...overrides,
  };
}

const STACK_PULLS = [
  stackPull(338, "refactor(git): extract rebase planner", { state: "MERGED", mergedAt: ago(24 * 9) }, [3, 3], 24 * 10),
  stackPull(340, "feat(stack): read stack metadata from the API", { state: "MERGED", mergedAt: ago(24 * 6) }, [0, 0], 24 * 7),
  stackPull(341, "feat(stack): adopt server-rebased branches", { reviewDecision: "APPROVED" }, [7, 7], 26),
  stackPull(CURRENT, "Adopt equivalent server-rebased branches", { reviewDecision: "CHANGES_REQUESTED" }, [2, 4], 3),
  stackPull(345, "test(stack): cover rebase adoption", {}, [0, 0], 0.5),
  stackPull(346, "refactor(stack): share push helpers", { mergeable: "CONFLICTING" }, [1, 1], 50),
  stackPull(347, "feat(stack): show adopted branches in status", { statusCheckRollup: { state: "FAILURE" } }, [0, 3], 5),
  stackPull(348, "docs(stack): document server rebases", { isDraft: true }, [0, 0], 190),
];

function inboxPull(number: number, title: string, overrides: Record<string, unknown> = {}, repo = "github/gh-stack") {
  return {
    ...stackPull(number, title),
    url: `https://github.com/${repo}/pull/${number}`,
    repository: { nameWithOwner: repo },
    author: { login: "hubot", avatarUrl: "https://avatars.githubusercontent.com/hubot?v=4" },
    latestReviews: { nodes: [] },
    reviewRequests: { nodes: [{ requestedReviewer: { login: "octocat" } }] },
    reviewRequestedEvents: { nodes: [] },
    stack: null,
    ...overrides,
  };
}

const INBOX_STACK = {
  number: 900,
  size: 3,
  entries: { nodes: [901, 902, 903].map((number, index) => ({ position: index + 1, pullRequest: { number } })) },
};

const INBOX = {
  viewer: { login: "octocat" },
  review: {
    nodes: [
      inboxPull(901, "feat(api): add the stack endpoint", { stack: INBOX_STACK }),
      inboxPull(903, "feat(ui): render the stack", { stack: INBOX_STACK, timelineItems: { nodes: [{ __typename: "HeadRefForcePushedEvent", createdAt: ago(1) }] } }),
      inboxPull(
        77,
        "fix(auth): refresh tokens before they expire and retry the failed request once",
        { latestReviews: { nodes: [{ author: { login: "octocat" } }] }, timelineItems: { nodes: [{ __typename: "HeadRefForcePushedEvent", createdAt: ago(48) }] } },
        "octo-org/api",
      ),
    ],
  },
  mine: {
    nodes: [
      inboxPull(120, "docs: explain the stack badge", { reviewDecision: "APPROVED" }),
      inboxPull(121, "feat(stack): show failing checks", { statusCheckRollup: { state: "FAILURE" } }, "octo-org/api"),
      {},
    ],
  },
};

const UNREADABLE = "Resource not accessible by personal access token";

const CHANGED_FILES: Record<string, string> = {
  "README.md": "VIEWED",
  "cmd/rebase.go": "DISMISSED",
  "cmd/rebase_test.go": "UNVIEWED",
  "cmd/sync.go": "UNVIEWED",
  "cmd/utils.go": "UNVIEWED",
  "cmd/utils_test.go": "UNVIEWED",
  "docs/src/content/docs/guides/ui.md": "VIEWED",
  "docs/src/content/docs/reference/cli.md": "VIEWED",
  "internal/git/git.go": "UNVIEWED",
  "internal/git/gitops.go": "UNVIEWED",
  "internal/git/gitops_test.go": "UNVIEWED",
  "internal/git/mock_ops.go": "UNVIEWED",
  "skills/gh-stack/SKILL.md": "UNVIEWED",
};

const CHANGE_STATS: Record<string, { additions: number; deletions: number }> = {
  "README.md": { additions: 2, deletions: 1 },
  "cmd/rebase.go": { additions: 120, deletions: 34 },
  "cmd/rebase_test.go": { additions: 1234, deletions: 0 },
  "skills/gh-stack/SKILL.md": { additions: 0, deletions: 0 },
};

const EMPTY_INBOX = { viewer: { login: "octocat" }, review: { nodes: [] }, mine: { nodes: [] } };

const README_FIRST_HUNK = [
  " gh stack rebase [flags] [branch]",
  " ```",
  " ",
  "-Fetches the latest changes from `origin`, then ensures each branch in the stack has the tip of the previous layer in its commit history. Rebases branches in order from trunk upward. If a branch's PR has been merged, the rebase automatically switches to `--onto` mode to correctly replay commits on top of the merge target.",
  "+Fetches the latest changes from `origin`, then ensures each branch in the stack has the tip of the previous layer in its commit history. Rebases branches in order from trunk upward. If GitHub already rebased the stack, matching rewritten remote tips are adopted locally when your branches have not changed since the previous fetch and contain the same ordered commits. If a branch's PR has been merged, the rebase automatically switches to `--onto` mode to correctly replay commits on top of the merge target.",
  " ",
  " If a rebase conflict occurs, the operation pauses and prints the conflicted files with line numbers. Resolve the conflicts, stage with `git add`, and continue with `--continue`. To undo the entire rebase, use `--abort` to restore all branches to their pre-rebase state.",
  " ",
];
const README_SECOND_CONTEXT = [
  " ",
  " A clean remote-ahead update (PRs added on top of your local stack) is pulled down automatically without prompting, so `sync` is safe to run in automation. Sync only prompts when the stacks have truly diverged.",
  " ",
];
const README_SECOND_TAIL = [" #### Diverged stacks", " ", " When neither stack is a clean prefix of the other — for example, you added a branch locally while separate PRs were added to the same stack on GitHub — sync cannot merge the two automatically. In an interactive terminal it offers three choices:"];
/** README.md as GitHub's page shows it (the current version), and as the reviewed v1 had it: moved, with another added line. */
const README_CURRENT = [
  "@@ -193,7 +193,7 @@ Pull from remote and do a cascading rebase across the stack.",
  ...README_FIRST_HUNK,
  "@@ -321,6 +321,8 @@ Performs a synchronization of the entire stack:",
  ...README_SECOND_CONTEXT,
  "+If GitHub already rebased the same stack branches, `sync` adopts those rewritten remote tips when your local tips have not changed since the previous fetch and `git range-diff` confirms the same commits in the same order. If local and remote commits both changed, sync stops rather than overwriting either side.",
  "+",
  ...README_SECOND_TAIL,
].join("\n");
const README_REVIEWED = [
  "@@ -180,7 +180,7 @@ Pull from remote and do a cascading rebase across the stack.",
  ...README_FIRST_HUNK,
  "@@ -300,6 +300,8 @@ Performs a synchronization of the entire stack:",
  ...README_SECOND_CONTEXT,
  "+Sync adopts server rebases.",
  "+",
  ...README_SECOND_TAIL,
].join("\n");

const VERSION_FILES: Record<string, { filename: string; status: string; patch: string; sha: string }[]> = {
  aaaaaaa1: [
    { filename: "cmd/rebase.go", status: "modified", sha: "r1", patch: "@@ -10,3 +10,4 @@ func Rebase() {\n \tsync()\n+\tadopt(branch)\n \treturn nil" },
    { filename: "README.md", status: "modified", sha: "m1", patch: README_REVIEWED },
    { filename: "docs/same.md", status: "modified", sha: "s1", patch: "@@ -1,2 +1,3 @@\n # gh-stack\n+Adopts server rebases.\n " },
    { filename: "cmd/legacy.go", status: "modified", sha: "l1", patch: "@@ -4,2 +4,2 @@\n-old()\n+older()" },
  ],
  ccccccc3: [
    { filename: "cmd/rebase.go", status: "modified", sha: "r3", patch: "@@ -42,3 +42,5 @@ func Rebase() {\n \tsync()\n+\tadopt(branch, equivalent)\n+\tlog(branch)\n \treturn nil" },
    { filename: "README.md", status: "modified", sha: "m3", patch: README_CURRENT },
    { filename: "docs/same.md", status: "modified", sha: "s3", patch: "@@ -8,2 +8,3 @@\n # gh-stack\n+Adopts server rebases.\n " },
    { filename: "cmd/adopt_test.go", status: "added", sha: "t3", patch: "@@ -0,0 +1,2 @@\n+package cmd\n+func TestAdopt(t *testing.T) {}" },
  ],
};

function createFixture(options: { partial?: boolean; failReadd?: boolean; inbox?: object; inboxGate?: Promise<unknown> } = {}) {
  const requested: (object | null)[] = [
    actor("mojombo"),
    { __typename: "Team", name: "backend", combinedSlug: "github/backend", avatarUrl: null, url: "https://github.com/orgs/github/teams/backend" },
  ];
  if (options.partial) requested.push(null);
  const rerequests: string[] = [];
  const requestLog: string[] = [];
  const viewedMarks: string[] = [];
  const viewed = { ...CHANGED_FILES };
  const submissions: { path: string; body: unknown }[] = [];
  const reviewState = { pendingComments: null as number | null };
  return {
    rerequests,
    requestLog,
    viewedMarks,
    submissions,
    reviewState,
    /** Milliseconds to hold back the overview query, to see what the bar shows before it arrives. */
    overviewDelay: 0,
    /** An HTTP status to fail the overview query with, or 0 to answer it. */
    overviewFailure: 0,
    async handle(route: Route) {
      const request = route.request();
      const graphql = request.url().endsWith("/graphql")
        ? (request.postDataJSON() as { query: string; variables: { path?: string } })
        : null;
      const mutation = graphql?.query.match(/\b(markFileAsViewed|unmarkFileAsViewed)\b/)?.[1];
      if (graphql && mutation) {
        const path = graphql.variables.path ?? "";
        viewedMarks.push(`${mutation === "markFileAsViewed" ? "mark" : "unmark"}:${path}`);
        viewed[path] = mutation === "markFileAsViewed" ? "VIEWED" : "UNVIEWED";
        await route.fulfill({ json: { data: { [mutation]: { clientMutationId: null } } } });
        return;
      }
      if (graphql?.query.includes("viewerViewedState")) {
        const nodes = Object.entries(viewed).map(([path, viewerViewedState]) => ({
          path,
          viewerViewedState,
          ...(CHANGE_STATS[path] ?? { additions: 3, deletions: 3 }),
        }));
        await route.fulfill({
          json: {
            data: {
              repository: {
                pullRequest: {
                  id: "PR_kwDOtest",
                  files: { pageInfo: { hasNextPage: false, endCursor: null }, nodes },
                },
              },
            },
          },
        });
        return;
      }
      if (graphql?.query.includes("review: search(")) {
        await options.inboxGate;
        await route.fulfill({ json: { data: options.inbox ?? INBOX } });
        return;
      }
      if (graphql?.query.includes("BaseRefChangedEvent")) {
        const commit = (oid: string, hours: number) => ({ oid, committedDate: ago(hours) });
        await route.fulfill({
          json: {
            data: {
              viewer: { login: "octocat" },
              repository: {
                pullRequest: {
                  baseRefName: "main",
                  baseRefOid: "basebase",
                  headRefOid: "ccccccc3",
                  createdAt: ago(72),
                  commits: { nodes: [{ commit: commit("ccccccc3", 3) }] },
                  timelineItems: {
                    nodes: [
                      { __typename: "HeadRefForcePushedEvent", createdAt: ago(20), actor: { login: "hubot" }, beforeCommit: commit("aaaaaaa1", 48), afterCommit: commit("bbbbbbb2", 20) },
                      { __typename: "HeadRefForcePushedEvent", createdAt: ago(3), actor: { login: "hubot" }, beforeCommit: commit("bbbbbbb2", 20), afterCommit: commit("ccccccc3", 3) },
                    ],
                  },
                  reviews: { nodes: [{ author: { login: "octocat" }, commit: commit("aaaaaaa1", 48) }] },
                },
              },
            },
          },
        });
        return;
      }
      if (graphql?.query.includes("headRefName")) {
        await route.fulfill({ json: { data: { repository: { b0: { nodes: [] } } } } });
        return;
      }
      if (graphql) {
        if (this.overviewDelay > 0) await new Promise((resolve) => setTimeout(resolve, this.overviewDelay));
        if (this.overviewFailure > 0) {
          await route.fulfill({ status: this.overviewFailure, json: { message: "Bad gateway" } });
          return;
        }
        await route.fulfill({
          json: {
            data: {
              viewer: { login: "octocat" },
              repository: {
                pullRequest: {
                  ...STACK_PULLS.find((pull) => pull.number === CURRENT),
                  ...(options.partial ? { statusCheckRollup: null } : {}),
                  baseRefName: "main",
                  stack: {
                    number: 338,
                    size: STACK_PULLS.length,
                    baseRefName: "main",
                    entries: {
                      nodes: STACK_PULLS.map((pullRequest, index) => ({ position: index + 1, pullRequest })),
                    },
                  },
                  author: { login: "hubot" },
                  viewerCanUpdate: true,
                  forcePushes: { totalCount: 2, nodes: [{ createdAt: ago(3) }] },
                  reviewRequests: { nodes: requested.map((requestedReviewer) => ({ requestedReviewer })) },
                  reviews: {
                    nodes: [
                      review("defunkt", "CHANGES_REQUESTED"),
                      review("mojombo", "CHANGES_REQUESTED"),
                      review("coderabbitai", "COMMENTED", "Bot"),
                      review("pjhyett", "DISMISSED"),
                      review("octocat", "APPROVED"),
                      review("wycats", "COMMENTED"),
                    ],
                  },
                },
              },
            },
            ...(options.partial
              ? {
                  errors: [
                    { message: UNREADABLE, path: ["repository", "pullRequest", "statusCheckRollup"] },
                    { message: UNREADABLE, path: ["repository", "pullRequest", "reviewRequests", "nodes", 2, "requestedReviewer"] },
                  ],
                }
              : {}),
          },
        });
        return;
      }
      if (request.url().endsWith("/requested_reviewers")) {
        const { reviewers = [], team_reviewers: teams = [] } = request.postDataJSON() as {
          reviewers?: string[];
          team_reviewers?: string[];
        };
        const names = [...reviewers, ...teams.map((slug) => `team:${slug}`)];
        if (request.method() === "DELETE") {
          requestLog.push(...names.map((name) => `remove:${name}`));
          for (let index = requested.length - 1; index >= 0; index--) {
            const entry = requested[index] as { login?: string; combinedSlug?: string } | null;
            const slug = entry?.combinedSlug?.split("/").at(-1);
            if ((entry?.login && reviewers.includes(entry.login)) || (slug && teams.includes(slug))) requested.splice(index, 1);
          }
          await route.fulfill({ status: 200, json: {} });
          return;
        }
        requestLog.push(...names.map((name) => `add:${name}`));
        if (options.failReadd) {
          await route.fulfill({ status: 500, json: { message: "Server Error" } });
          return;
        }
        rerequests.push(...reviewers);
        for (const login of reviewers) requested.push(actor(login));
        for (const slug of teams) {
          requested.push({ __typename: "Team", name: slug, combinedSlug: `github/${slug}`, avatarUrl: null, url: `https://github.com/orgs/github/teams/${slug}` });
        }
        await route.fulfill({ status: 201, json: {} });
        return;
      }
      const reviews = /\/pulls\/\d+\/reviews(\/\d+\/(comments|events))?(\?|$)/.exec(new URL(request.url()).pathname + "?");
      if (reviews) {
        const path = new URL(request.url()).pathname.replace(/^.*\/pulls\/\d+/, "");
        if (request.method() === "POST") {
          submissions.push({ path, body: request.postDataJSON() });
          await route.fulfill({ status: 200, json: { id: 9, state: "APPROVED" } });
        } else if (path.endsWith("/comments")) {
          await route.fulfill({ json: Array.from({ length: reviewState.pendingComments ?? 0 }, (_, id) => ({ id })) });
        } else {
          await route.fulfill({ json: reviewState.pendingComments === null ? [] : [{ id: 9, state: "PENDING" }] });
        }
        return;
      }
      const compare = /\/compare\/(\w+)\.\.\.(\w+)/.exec(request.url());
      if (compare) {
        const [, base, head] = compare as unknown as [string, string, string];
        const files = VERSION_FILES[head] ?? VERSION_FILES.ccccccc3!;
        await route.fulfill({
          json: { status: head === "ccccccc3" ? "ahead" : "diverged", merge_base_commit: { sha: head === "ccccccc3" ? base : "oldbase" }, files },
        });
        return;
      }
      await route.fulfill({ status: 404, json: { message: "Not mocked" } });
    },
  };
}

function badgeText(context: BrowserContext): Promise<string | undefined> {
  return context.serviceWorkers()[0]?.evaluate(() => chrome.action.getBadgeText({})) ?? Promise.resolve(undefined);
}

/**
 * @param api Answers GitHub's API from the start, so the refresh the stored token starts never reaches the real one.
 */
async function launch(colorScheme: "light" | "dark", api?: (route: Route) => Promise<void>): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(), "flohub-")), {
    channel: "chromium",
    headless: true,
    colorScheme,
    viewport: { width: 1280, height: 860 },
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
  });
  if (api) await context.route("https://api.github.com/**", api);
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  await worker.evaluate(() => chrome.storage.local.set({ token: "test-token" }));
  return context;
}

function inlineBar(page: Page) {
  return page.locator('flohub-bar[data-mode="inline"]');
}

function floatingBar(page: Page) {
  return page.locator('flohub-bar[data-mode="floating"]');
}

function visibleText(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.endsWith("conversations resolved") && !line.endsWith("between the versions"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

async function diffAnchorOf(path: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(path));
  return `diff-${Buffer.from(digest).toString("hex")}`;
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`ok - ${message}`);
}

const setup = await launch("light");
await setup.route("https://api.github.com/**", (route) => createFixture().handle(route));
const setupWorker = setup.serviceWorkers()[0];
await setupWorker?.evaluate(() => chrome.storage.local.remove("token"));
const extensionId = new URL(setupWorker?.url() ?? "").host;
const options = await setup.newPage();
await options.goto(`chrome-extension://${extensionId}/options.html`);
await options.getByLabel("Personal access token").fill("github_pat_test");
await options.getByRole("button", { name: "Save and test" }).click();
await options.getByText("Signed in as octocat").waitFor();
const stored = await setupWorker?.evaluate(() => chrome.storage.local.get("token"));
check(stored?.token === "github_pat_test", "options page tests the token against GitHub and stores it");
await options.screenshot({ path: `${SCREENSHOTS}/options-light.png` });
await setup.close();

const light = await launch("light");
const fixture = createFixture();
await light.route("https://api.github.com/**", (route) => fixture.handle(route));
const page = await light.newPage();

await page.goto(`${PULL_URL}/files`);
await inlineBar(page).getByText("Changes requested").first().waitFor();
const chips = await inlineBar(page).locator(".chips > li").allInnerTexts();
check(
  JSON.stringify(chips.map((chip) => chip.replace(/\s+/g, " ").trim())) ===
    JSON.stringify([
      "defunkt Changes requested",
      "mojombo Re-requested · had requested changes",
      "github/backend Review pending",
      "pjhyett Dismissed",
      "wycats Commented",
      "octocat Approved",
    ]),
  `inline chips render in status order: ${JSON.stringify(chips)}`,
);
check(await floatingBar(page).isHidden(), "floating pill is hidden while the inline bar is in view");
check(
  (await inlineBar(page).getByRole("button", { name: /Re-request review from/ }).count()) === 3,
  "re-request is offered for defunkt, pjhyett and wycats only",
);
const rows = await inlineBar(page).locator(".stack-list > li").allInnerTexts();
check(
  JSON.stringify(rows.map(visibleText)) ===
    JSON.stringify([
      "Draft #348 docs(stack): document server rebases 1w",
      "Checks failed #347 feat(stack): show adopted branches in status 0/3 5h",
      "Merge conflict #346 refactor(stack): share push helpers 1/1 2d",
      "Needs review #345 test(stack): cover rebase adoption 30m",
      `Changes requested #${CURRENT} Adopt equivalent server-rebased branches 2/4 3h`,
      "Approved #341 feat(stack): adopt server-rebased branches 7/7 1d",
      "2 merged",
      "main",
    ]),
  `stack lists layers top first with badge, threads and age, merged collapsed: ${JSON.stringify(rows)}`,
);
check(
  (await inlineBar(page).locator('[aria-current="page"]').innerText()).includes(`#${CURRENT}`),
  "current layer is marked as the current page",
);
check(
  (await inlineBar(page).getByRole("link", { name: /#345/ }).getAttribute("href")) === `${REPO_URL}/pull/345/files`,
  "stack links keep the Files changed tab",
);
await inlineBar(page).getByRole("button", { name: "2 merged" }).click();
await inlineBar(page).getByText("#338").waitFor();
check((await inlineBar(page).getByText("Merged", { exact: true }).count()) === 2, "merged layers expand on demand");
await inlineBar(page).screenshot({ path: `${SCREENSHOTS}/inline-light.png` });

check(
  visibleText(await inlineBar(page).getByText(/^Force-pushed/).innerText()) === "Force-pushed 2 times, last 3 hours ago",
  "versions row counts the force pushes",
);
await inlineBar(page).getByRole("button", { name: "Compare versions" }).click();
const versions = page.locator("flohub-versions dialog");
await versions.locator("details.file").first().waitFor();
check(
  (await versions.getByLabel("From").inputValue()) === "1" && (await versions.getByLabel("To").inputValue()) === "3",
  "versions default to the viewer's last reviewed version → current",
);
const fileRows = (await versions.locator("details.file > summary").allInnerTexts()).map(visibleText);
check(
  JSON.stringify(fileRows) ===
    JSON.stringify([
      "README.md Changed +1 −1",
      "cmd/adopt_test.go Newly changed +4",
      "cmd/legacy.go No longer changed −3",
      "cmd/rebase.go Changed +2 −1",
    ]),
  `interdiff lists files whose change differs, ignoring moved hunks: ${JSON.stringify(fileRows)}`,
);
check(
  (await versions.locator("details.unchanged > summary").innerText()).startsWith("1 file makes the same change"),
  "docs/same.md, whose hunk only moved, counts as unchanged",
);
await page.waitForTimeout(250);
await page.screenshot({ path: `${SCREENSHOTS}/versions-light.png` });
await versions.getByLabel("From").selectOption("3");
await versions.getByText("No differences.").waitFor();
check(true, "picking the same version on both sides shows no differences");
await page.keyboard.press("Escape");
check(await versions.isHidden(), "Escape closes the versions dialog");

const readmeDiff = page.locator(`#${await diffAnchorOf("README.md")}`);
const changedCell = readmeDiff.locator("[data-flohub-since]");
await changedCell.first().waitFor();
const readmeAnchor = await diffAnchorOf("README.md");
check(
  (await changedCell.count()) === 1 &&
    (await page.locator(`#${readmeAnchor}R324 ~ td.blob-code`).getAttribute("data-flohub-since")) === "v1",
  "only the line added since the reviewed version is highlighted, on the head side",
);
check(
  (await readmeDiff.locator("flohub-since-badge").innerText()) === "Changed since your review (v1)",
  "the file header says it changed since the review",
);
const removedMarker = page.locator(`#${readmeAnchor}R323 ~ td.blob-code flohub-removed`);
check((await removedMarker.locator("button").innerText()) === "−1", "a marker shows where a reviewed line is gone");
await removedMarker.locator("button").click();
check(
  (await removedMarker.locator(".panel").innerText()).includes("+Sync adopts server rebases."),
  "the marker lists the line that is gone",
);
await removedMarker.locator("button").click();
await readmeDiff.locator(`#${readmeAnchor}R324`).scrollIntoViewIfNeeded();
await page.waitForTimeout(150);
await readmeDiff.screenshot({ path: `${SCREENSHOTS}/since-review-light.png` });
check(
  visibleText(await inlineBar(page).locator(".bar", { hasText: "Versions" }).innerText()).includes(
    "3 files changed since your review (v1), highlighted in Files changed · 1 file is no longer changed",
  ),
  "the versions row says what changed since the review",
);
await inlineBar(page).getByRole("button", { name: "Hide" }).click();
await page.waitForFunction(() => document.querySelectorAll("[data-flohub-since], flohub-removed, flohub-since-badge").length === 0);
check(true, "Hide takes every highlight off the diff");
await inlineBar(page).getByRole("button", { name: "Show" }).click();
await changedCell.first().waitFor();
check(true, "Show puts the highlights back");

// GitHub's React diff, which it serves to signed-in viewers: the same README.md lines in its split markup.
const reactRow = (left: number | null, right: number | null, marker: string, text: string) => {
  const side = (name: "left" | "right", line: number | null) =>
    line === null
      ? '<td class="empty-diff-line"></td><td class="empty-diff-line"></td>'
      : `<td class="new-diff-line-number" data-diff-side="${name}" data-line-number="${line}">${line}</td>` +
        `<td class="diff-text-cell" data-diff-side="${name}" data-line-number="${line}"><code>${marker}${text}</code></td>`;
  return `<tr class="diff-line-row">${side("left", left)}${side("right", right)}</tr>`;
};
const REACT_PAGE = `<!doctype html><html><head><title>React diff</title></head><body><main>
<div role="region" id="${readmeAnchor}"><div data-diff-header-wrapper="true"><div><div><h3><a href="#${readmeAnchor}"><code>README.md</code></a></h3></div></div></div>
<table role="grid" data-diff-anchor="${readmeAnchor}"><tbody>
<tr class="diff-line-row"><td colspan="4" class="diff-hunk-cell"><code class="diff-text-cell hunk">@@ -321,6 +321,8 @@</code></td></tr>
${reactRow(323, 323, " ", "")}
${reactRow(null, 324, "+", "If GitHub already rebased the same stack branches…")}
${reactRow(null, 325, "+", "")}
${reactRow(324, 326, " ", "#### Diverged stacks")}
</tbody></table></div></main></body></html>`;
await light.route("https://github.com/flohub/react-diff/**", (route) =>
  route.fulfill({ body: REACT_PAGE, contentType: "text/html" }),
);
const reactPage = await light.newPage();
await reactPage.goto("https://github.com/flohub/react-diff/pull/1/changes");
await reactPage.locator("[data-flohub-since]").first().waitFor();
check(
  JSON.stringify(
    await reactPage
      .locator("[data-flohub-since]")
      .evaluateAll((cells) => cells.map((cell) => `${cell.getAttribute("data-diff-side")}:${cell.getAttribute("data-line-number")}`)),
  ) === JSON.stringify(["right:324"]),
  "in GitHub's React diff, the line added since the review is highlighted",
);
check(
  (await reactPage.locator('td.diff-text-cell[data-diff-side="right"][data-line-number="323"] flohub-removed button').innerText()) === "−1",
  "in GitHub's React diff, the marker sits where the reviewed line is gone",
);
check(
  (await reactPage.locator("[data-diff-header-wrapper] flohub-since-badge").innerText()) === "Changed since your review (v1)",
  "in GitHub's React diff, the file header gets the badge",
);
await reactPage.close();

const tree = page.getByRole("tree", { name: "File Tree" });
const viewedToggle = (path: string) => tree.locator(`flohub-viewed[data-path="${path}"]`);
await viewedToggle("README.md").waitFor();
check(
  (await tree.locator("flohub-viewed").count()) === Object.keys(CHANGED_FILES).length,
  "every file in the tree gets a Viewed checkbox",
);
const diffStat = (path: string) => tree.locator(`[role="treeitem"]:has(> flohub-viewed[data-path="${path}"]) > flohub-diffstat`);
check(
  (await tree.locator("flohub-diffstat").count()) === Object.keys(CHANGED_FILES).length - 1 &&
    (await diffStat("skills/gh-stack/SKILL.md").count()) === 0,
  "every file with changed lines shows its counts, a pure rename shows none",
);
check(
  (await diffStat("README.md").innerText()).replace(/\s+/g, " ") === "+2 \u22121" &&
    (await diffStat("cmd/rebase_test.go").innerText()) === "+1,234" &&
    (await diffStat("cmd/rebase.go").getAttribute("title")) === "120 additions, 34 deletions",
  "line counts read +added −deleted, leave out an empty side and spell out both in the tooltip",
);
const overlap = await tree.locator('[role="treeitem"]:has(> flohub-viewed[data-path="cmd/rebase_test.go"])').evaluate((item) => {
  const label = item.querySelector(".ActionList-item-label") ?? item.firstElementChild;
  const stat = item.querySelector(":scope > flohub-diffstat");
  return (label?.getBoundingClientRect().right ?? 0) - (stat?.getBoundingClientRect().left ?? 0);
});
check(overlap <= 0, `the longest line count leaves the file name readable (overlap ${overlap.toFixed(1)}px)`);
check(
  (await viewedToggle("README.md").getAttribute("aria-checked")) === "true" &&
    (await viewedToggle("cmd/rebase_test.go").getAttribute("aria-checked")) === "false",
  "tree checkboxes show the files the viewer marked as viewed",
);
check(
  (await viewedToggle("cmd/rebase.go").getAttribute("data-state")) === "DISMISSED" &&
    (await viewedToggle("cmd/rebase.go").getAttribute("title"))?.startsWith("Changed since you viewed it") === true,
  "a file that changed since it was viewed is marked as such",
);
const viewedFolders = await tree
  .locator('[role="treeitem"][data-flohub-viewed="VIEWED"]:not([data-flohub-file])')
  .evaluateAll((items) => items.map((item) => item.querySelector(".ActionList-item-label")?.textContent?.trim()));
check(
  JSON.stringify(viewedFolders) === JSON.stringify(["docs/src/content/docs", "guides", "reference"]),
  `only folders whose files are all viewed are dimmed: ${JSON.stringify(viewedFolders)}`,
);
const urlBeforeToggle = page.url();
await viewedToggle("cmd/rebase_test.go").click();
await tree.locator('flohub-viewed[data-path="cmd/rebase_test.go"][aria-checked="true"]').waitFor();
await viewedToggle("README.md").click();
await tree.locator('flohub-viewed[data-path="README.md"][aria-checked="false"]').waitFor();
check(
  fixture.viewedMarks.join() === "mark:cmd/rebase_test.go,unmark:README.md",
  `tree checkboxes mark and unmark files through the API: ${fixture.viewedMarks.join()}`,
);
check(page.url() === urlBeforeToggle, "clicking a tree checkbox does not jump to the file");
await page.evaluate(() => {
  const header = document.querySelector('.file-header[data-path="cmd/sync.go"]');
  const label = document.createElement("label");
  label.innerHTML = '<input type="checkbox" class="js-reviewed-checkbox"> Viewed';
  header?.append(label);
});
await viewedToggle("cmd/sync.go").click();
await tree.locator('flohub-viewed[data-path="cmd/sync.go"][aria-checked="true"]').waitFor();
check(
  (await page.locator('.file-header[data-path="cmd/sync.go"] .js-reviewed-checkbox').isChecked()) &&
    fixture.viewedMarks.length === 2,
  "a tree checkbox clicks the file's own Viewed checkbox when it is on the page",
);
await page.locator('.file-header[data-path="cmd/sync.go"] .js-reviewed-checkbox').click();
await tree.locator('flohub-viewed[data-path="cmd/sync.go"][aria-checked="false"]').waitFor();
check(true, "unchecking the file's own Viewed checkbox updates the tree");
await page.locator('.file-header[data-path="cmd/utils.go"]').first().waitFor({ state: "attached" });
await page.evaluate(() => {
  const header = document.querySelector('.file-header[data-path="cmd/utils.go"]');
  const button = document.createElement("button");
  button.type = "button";
  button.className = "react-viewed";
  const render = (pressed: boolean) => {
    button.setAttribute("aria-pressed", String(pressed));
    button.setAttribute("aria-label", pressed ? "Viewed" : "Not Viewed");
  };
  render(true);
  button.addEventListener("click", () => setTimeout(() => render(button.getAttribute("aria-pressed") !== "true"), 50));
  header?.append(button);
});
await tree.locator('flohub-viewed[data-path="cmd/utils.go"][aria-checked="true"]').waitFor();
check(true, "the tree takes the state of a React Viewed button when it appears");
await viewedToggle("cmd/utils.go").click();
await page.locator('.react-viewed[aria-pressed="false"][aria-label="Not Viewed"]').waitFor();
await tree.locator('flohub-viewed[data-path="cmd/utils.go"][aria-checked="false"]').waitFor();
await viewedToggle("cmd/utils.go").click();
await page.locator('.react-viewed[aria-pressed="true"]').waitFor();
check(fixture.viewedMarks.length === 2, "a tree checkbox presses the React Viewed button both ways instead of calling the API");
await page.locator(".react-viewed").click();
await tree.locator('flohub-viewed[data-path="cmd/utils.go"][aria-checked="false"]').waitFor();
check(true, "pressing the React Viewed button updates the tree");
await page.locator('nav[aria-label="File Tree Navigation"]').screenshot({ path: `${SCREENSHOTS}/file-tree-light.png` });

await inlineBar(page).getByRole("button", { name: "Stack" }).click();
check(
  (await inlineBar(page).locator(".stack-list").count()) === 0 &&
    (await inlineBar(page).locator(".stack-header .segment").count()) === STACK_PULLS.length,
  "stack collapses to a strip",
);
await inlineBar(page).screenshot({ path: `${SCREENSHOTS}/inline-collapsed-light.png` });
await page.reload();
await inlineBar(page).getByText("Changes requested").first().waitFor();
check((await inlineBar(page).locator(".stack-list").count()) === 0, "collapsed stack stays collapsed after a reload");
await inlineBar(page).getByRole("button", { name: "Stack" }).click();
await inlineBar(page).locator(".stack-list").waitFor();
await page.screenshot({ path: `${SCREENSHOTS}/page-light.png` });

await page.mouse.wheel(0, 2400);
await floatingBar(page).locator(".pill").waitFor({ state: "visible" });
check(
  (await floatingBar(page).locator(".pill").innerText()).includes(`4/${STACK_PULLS.length}`),
  "floating pill appears once the header scrolls away, with the stack position",
);
await floatingBar(page).locator(".pill").click();
await floatingBar(page).locator(".panel").waitFor();
await page.waitForTimeout(250);
await page.screenshot({ path: `${SCREENSHOTS}/floating-expanded-light.png` });
await page.keyboard.press("Escape");
check(await floatingBar(page).locator(".panel").isHidden(), "Escape collapses the floating panel");

await floatingBar(page).getByRole("button", { name: "Minimize FloHub to the window edge" }).click();
const restoreTab = floatingBar(page).getByRole("button", { name: "Show FloHub" });
await restoreTab.waitFor();
check(await floatingBar(page).locator(".pill").isHidden(), "minimizing the floating bar leaves only the edge tab");
check((await restoreTab.boundingBox())?.x === 0, "the minimized tab sits flush with the window's left edge");
check(
  await restoreTab.evaluate((node) => (node.getRootNode() as ShadowRoot).activeElement === node),
  "focus moves to the edge tab after minimizing",
);
await page.screenshot({ path: `${SCREENSHOTS}/floating-minimized-light.png` });
await page.reload();
await inlineBar(page).getByText("Changes requested").first().waitFor();
await page.mouse.wheel(0, 2400);
await restoreTab.waitFor();
check(await floatingBar(page).locator(".pill").isHidden(), "the floating bar stays minimized after a reload");
await restoreTab.click();
await floatingBar(page).locator(".pill").waitFor({ state: "visible" });
check(await restoreTab.isHidden(), "the edge tab restores the floating pill");

await page.mouse.wheel(0, -5000);
await inlineBar(page).getByRole("button", { name: "Re-request review from defunkt" }).click();
await inlineBar(page).locator(".chips > li", { hasText: "defunkt" }).getByText("Re-requested").waitFor();
check(fixture.rerequests.join() === "defunkt", "re-request posts only defunkt to requested_reviewers");

await page.getByRole("link", { name: /Conversation/ }).first().click();
await page.waitForURL(/\/pull\/\d+$/);
await inlineBar(page).getByText("Re-requested").first().waitFor();
check(await inlineBar(page).isVisible(), "bar survives in-page navigation to the Conversation tab");
const header = await page.evaluate((number) => {
  const area = document.querySelector('[data-component="TitleArea"]');
  const title = area?.querySelector("h1");
  const label = [...(area?.querySelectorAll("span") ?? [])].find(
    (span) => span.textContent?.trim() === `#${number}` && !span.classList.contains("sr-only") && span.getClientRects().length > 0,
  );
  const bar = document.querySelector('flohub-bar[data-mode="inline"]');
  if (!area || !title || !label || !bar) return null;
  const [t, n, b] = [title, label, bar].map((element) => element.getBoundingClientRect()) as [DOMRect, DOMRect, DOMRect];
  return { sameLine: Math.abs(n.top - t.top) < 24, rightOfTitle: n.left >= t.right - 1, aboveBar: n.bottom <= b.top + 1 };
}, CURRENT);
if (header) {
  check(
    header.sameLine && header.rightOfTitle && header.aboveBar,
    `in GitHub's React header the PR number stays right of the title, above the overview: ${JSON.stringify(header)}`,
  );
} else {
  console.log("note - this page has no React PageHeader, so the header placement check was skipped");
}
await light.close();

const cached = await launch("light");
const cachedFixture = createFixture();
await cached.route("https://api.github.com/**", (route) => cachedFixture.handle(route));
const cachedPage = await cached.newPage();
await cachedPage.goto(`${PULL_URL}/files`);
await inlineBar(cachedPage).locator(".stack-list").waitFor();
await inlineBar(cachedPage).getByText("Changes requested").first().waitFor();
cachedFixture.overviewDelay = 5_000;
await cachedPage.reload();
const reloadStarted = Date.now();
await inlineBar(cachedPage).locator(".stack-list").waitFor({ timeout: 3_000 });
check(
  Date.now() - reloadStarted < 3_000 &&
    (await inlineBar(cachedPage).locator(".chips > li").count()) === 6 &&
    (await inlineBar(cachedPage).getByRole("button", { name: "Refresh reviewers" }).getAttribute("aria-busy")) === "true",
  "a revisit shows the cached stack and reviewers at once, marked as refreshing",
);
await inlineBar(cachedPage).locator('.refresh:not([aria-busy="true"])').waitFor({ timeout: 10_000 });
check(true, "the fresh overview replaces the cached one when it arrives");

await cachedPage.goto(PULL_URL, { waitUntil: "commit" });
const longestGap = await cachedPage.evaluate(
  () =>
    new Promise<number>((resolve) => {
      const shown = () =>
        !!document.querySelector('flohub-bar[data-mode="inline"]')?.shadowRoot?.querySelector(".stack-header");
      let firstShown = 0;
      let hiddenSince = 0;
      let longest = 0;
      const timer = setInterval(() => {
        const now = performance.now();
        if (shown()) {
          if (!firstShown) firstShown = now;
          if (hiddenSince) longest = Math.max(longest, now - hiddenSince);
          hiddenSince = 0;
        } else if (firstShown && !hiddenSince) {
          hiddenSince = now;
        }
        if (firstShown && now - firstShown > 3_000) {
          clearInterval(timer);
          resolve(hiddenSince ? now - hiddenSince : longest);
        }
      }, 10);
    }),
);
check(longestGap < 150, `once shown, the cached stack stays while GitHub re-renders the header (longest gap ${Math.round(longestGap)}ms)`);

const cachedWorker = cached.serviceWorkers()[0];
await cachedWorker?.evaluate((current) => {
  const key = (n: number) => `github/gh-stack#${n}`;
  return chrome.storage.local.get(["overviewIndex", `overview:${key(current)}`]).then((stored) => {
    const overview = stored[`overview:${key(current)}`] as { repository: { pullRequest: { number: number } } };
    overview.repository.pullRequest.number = 999;
    const index = { [key(999)]: { savedAt: Date.now(), repo: "github/gh-stack", members: [current, 999] } };
    return chrome.storage.local.set({ overviewIndex: index, [`overview:${key(999)}`]: overview });
  });
}, CURRENT);
await cachedPage.reload();
await inlineBar(cachedPage).locator(".stack-list").waitFor({ timeout: 3_000 });
check(
  (await inlineBar(cachedPage).locator('[aria-current="page"]').innerText()).includes(`#${CURRENT}`) &&
    (await inlineBar(cachedPage).getByText("Loading reviewers…").count()) === 1,
  "a layer without its own cache shows the stack cached from another layer, with reviewers still loading",
);
await inlineBar(cachedPage).getByText("Changes requested").first().waitFor({ timeout: 10_000 });
check(true, "reviewers fill in once the fresh overview arrives");
cachedFixture.overviewDelay = 3_000;
cachedFixture.overviewFailure = 502;
await cachedPage.reload();
await inlineBar(cachedPage).locator(".stack-list").waitFor({ timeout: 3_000 });
await inlineBar(cachedPage).getByRole("button", { name: "Retry" }).waitFor({ timeout: 10_000 });
check(
  (await inlineBar(cachedPage).locator(".chips > li").count()) === 0,
  "when the first fresh load fails, the cached overview gives way to the error and Retry",
);
await cached.close();

for (const scheme of ["light", "dark"] as const) {
  const inboxContext = await launch(scheme, (route) => createFixture().handle(route));
  // Tabs the extension opens skip the route, so their rows point at pull requests that do not exist and do not redirect.
  await inboxContext.route("https://github.com/octo-org/api/pull/77/files", (route) =>
    route.fulfill({ contentType: "text/html", body: "<title>Pull request</title>" }),
  );
  const popupId = new URL(inboxContext.serviceWorkers()[0]?.url() ?? "").host;
  const popup = await inboxContext.newPage();
  await popup.setViewportSize({ width: 504, height: 600 });
  await popup.goto(`chrome-extension://${popupId}/popup.html`);
  await popup.getByText("feat(ui): render the stack").waitFor();
  if (scheme === "light") {
    const sections = await popup.locator("section").evaluateAll((elements) =>
      elements.map((section) => ({
        heading: section.querySelector("h2")?.textContent,
        rows: [...section.querySelectorAll(".pull")].map((row) => row.querySelector(".title")?.textContent),
      })),
    );
    check(
      JSON.stringify(sections) ===
        JSON.stringify([
          {
            heading: "Waiting for your review3",
            rows: [
              "#903 feat(ui): render the stack",
              "#901 feat(api): add the stack endpoint",
              "#77 fix(auth): refresh tokens before they expire and retry the failed request once",
            ],
          },
          { heading: "Your pull requests2", rows: ["#121 feat(stack): show failing checks", "#120 docs: explain the stack badge"] },
        ]),
      `popup groups review requests by stack, top layer first, and puts failing own PRs first: ${JSON.stringify(sections)}`,
    );
    check(
      (await popup.locator(".pull", { hasText: "#77" }).getByText("Re-requested").count()) === 1,
      "a review request the viewer answered before is marked as re-requested",
    );
    const positions = await popup.locator(".pull").evaluateAll((rows) =>
      rows.map((row) => row.querySelector(".position [aria-hidden]")?.textContent ?? null),
    );
    check(
      JSON.stringify(positions) === JSON.stringify(["3/3", "1/3", null, null, null]) &&
        (await popup.locator(".group-label").count()) === 0,
      `stacked rows show their layer inline, with no group heading: ${JSON.stringify(positions)}`,
    );
    const badge = await inboxContext.serviceWorkers()[0]?.evaluate(() => chrome.action.getBadgeText({}));
    check(badge === "3", `the toolbar badge counts the review requests: "${badge}"`);
    const longTitle = await popup.locator(".pull", { hasText: "#77" }).locator(".title").evaluate((title) => ({
      truncated: title.scrollWidth > title.clientWidth,
      tooltip: title.getAttribute("title"),
    }));
    check(
      longTitle.truncated && longTitle.tooltip === "#77 fix(auth): refresh tokens before they expire and retry the failed request once",
      `a long title truncates and keeps the full title as a tooltip: ${JSON.stringify(longTitle)}`,
    );

    const focusedRow = () => popup.evaluate(() => document.activeElement?.querySelector(".number")?.textContent?.trim() ?? null);
    check((await focusedRow()) === "#903", `the popup opens with focus on the first row: ${await focusedRow()}`);
    const visited: (string | null)[] = [];
    for (const key of ["ArrowDown", "j", "j", "k", "End", "ArrowUp", "Home", "ArrowUp"]) {
      await popup.keyboard.press(key);
      visited.push(await focusedRow());
    }
    check(
      visited.join() === "#901,#77,#121,#77,#120,#121,#903,#903",
      `arrow keys and j/k move through both sections, Home and End jump to the ends: ${visited.join()}`,
    );
    const tabStops = await popup.locator('.pull[tabindex="0"]').count();
    check(tabStops === 1, `the list holds a single tab stop: ${tabStops}`);
    await popup.keyboard.press("Shift+Tab");
    await popup.keyboard.press("ArrowDown");
    check((await focusedRow()) === "#903", "the arrow down steps from the header back into the list");

    const [opened] = await Promise.all([
      inboxContext.waitForEvent("page"),
      popup.locator(".pull", { hasText: "#77" }).click({ modifiers: ["ControlOrMeta"] }),
    ]);
    check(opened.url() === "https://github.com/octo-org/api/pull/77", `a row opens its pull request in a tab: ${opened.url()}`);
    await opened.close();
    await popup.keyboard.press("End");
    await popup.keyboard.press("k");
    const [background] = await Promise.all([inboxContext.waitForEvent("page"), popup.keyboard.press("ControlOrMeta+Enter")]);
    check(
      background.url() === "https://github.com/octo-org/api/pull/121" && !popup.isClosed(),
      `Cmd/Ctrl+Enter opens the focused row in a background tab and keeps the popup open: ${background.url()}`,
    );
    await background.close();
    const [middle] = await Promise.all([
      inboxContext.waitForEvent("page"),
      popup.locator(".pull", { hasText: "#121" }).click({ button: "middle" }),
    ]);
    check(middle.url() === "https://github.com/octo-org/api/pull/121" && !popup.isClosed(), `a middle click opens a background tab: ${middle.url()}`);
    await middle.close();

    const existing = await inboxContext.newPage();
    await existing.goto("https://github.com/octo-org/api/pull/77/files");
    const launcher = await inboxContext.newPage();
    await launcher.goto(`chrome-extension://${popupId}/popup.html`);
    await launcher.locator(".pull", { hasText: "#77" }).waitFor();
    const pagesBefore = inboxContext.pages().length;
    await launcher.locator(".pull", { hasText: "#77" }).focus();
    await Promise.all([launcher.waitForEvent("close"), launcher.keyboard.press("Enter").catch(() => undefined)]);
    check(
      inboxContext.pages().length === pagesBefore - 1 && inboxContext.pages().filter((tab) => tab.url().includes("/pull/77")).length === 1,
      "Enter switches to a tab that already shows the pull request and closes the popup",
    );
    await existing.close();
    await popup.mouse.move(0, 0);
    await popup.keyboard.press("Home");
  }
  await popup.waitForFunction(() => [...document.images].every((image) => image.complete));
  await popup.screenshot({ path: `${SCREENSHOTS}/popup-${scheme}.png`, fullPage: true });
  await inboxContext.serviceWorkers()[0]?.evaluate(() => chrome.storage.local.remove("token"));
  await popup.reload();
  await popup.getByRole("button", { name: "Set up token" }).waitFor();
  check(
    (await badgeText(inboxContext)) === "" && (await popup.evaluate(() => document.activeElement?.textContent)) === "Set up token",
    `without a token the popup asks for one, focuses the button and the badge clears (${scheme})`,
  );
  await inboxContext.close();
}

for (const scheme of ["light", "dark"] as const) {
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const emptyContext = await launch(scheme, (route) => createFixture({ inbox: EMPTY_INBOX, inboxGate: gate }).handle(route));
  const popupId = new URL(emptyContext.serviceWorkers()[0]?.url() ?? "").host;
  const popup = await emptyContext.newPage();
  await popup.setViewportSize({ width: 504, height: 600 });
  await popup.goto(`chrome-extension://${popupId}/popup.html`);
  await popup.locator(".skeleton").waitFor();
  check((await popup.locator("main").getAttribute("aria-busy")) === "true", `the first open shows a busy skeleton (${scheme})`);
  if (scheme === "light") await popup.screenshot({ path: `${SCREENSHOTS}/popup-loading-light.png`, fullPage: true });
  release();
  await popup.getByText("Nothing to review").waitFor();
  check(
    (await popup.locator("section").count()) === 0 && (await popup.locator("main").getAttribute("aria-busy")) === "false",
    `an empty inbox shows one combined empty state (${scheme})`,
  );
  await popup.screenshot({ path: `${SCREENSHOTS}/popup-empty-${scheme}.png`, fullPage: true });
  if (scheme === "light") {
    // The popup closes while the key is still being pressed.
    await Promise.all([popup.waitForEvent("close"), popup.keyboard.press("Escape").catch(() => undefined)]);
    check(true, "Escape closes the popup");
  }
  await emptyContext.close();
}

const dark = await launch("dark");
await dark.route("https://api.github.com/**", (route) => createFixture().handle(route));
const darkPage = await dark.newPage();
await darkPage.goto(`${PULL_URL}/files`);
await inlineBar(darkPage).getByText("Approved").first().waitFor();
await inlineBar(darkPage).screenshot({ path: `${SCREENSHOTS}/inline-dark.png` });
await inlineBar(darkPage).getByRole("button", { name: "Compare versions" }).click();
await darkPage.locator("flohub-versions details.file").first().waitFor();
await darkPage.waitForTimeout(250);
await darkPage.screenshot({ path: `${SCREENSHOTS}/versions-dark.png` });
await darkPage.keyboard.press("Escape");
await darkPage.mouse.wheel(0, 2400);
await floatingBar(darkPage).locator(".pill").click();
await floatingBar(darkPage).locator(".panel").waitFor();
await darkPage.waitForTimeout(250);
await darkPage.screenshot({ path: `${SCREENSHOTS}/floating-expanded-dark.png` });

const worker = dark.serviceWorkers()[0];
await worker?.evaluate(() => chrome.storage.local.remove("token"));
await darkPage.goto(`${PULL_URL}/files`);
await inlineBar(darkPage).getByRole("button", { name: "Set up token" }).waitFor();
check(true, "missing token shows the setup prompt");
await inlineBar(darkPage).screenshot({ path: `${SCREENSHOTS}/setup-dark.png` });
await dark.close();

const keys = await launch("light");
const keyFixture = createFixture();
await keys.route("https://api.github.com/**", (route) => keyFixture.handle(route));
await keys.route(`${PULL_URL}/files`, async (route) => {
  const response = await route.fetch();
  const headers = { ...response.headers() };
  delete headers["content-security-policy"];
  const pageShortcut = `<script>
    window.pageKeys = [];
    window.pageC = [];
    for (const type of ["keydown", "keyup"]) {
      window.addEventListener(type, (event) => {
        if (event.key === "y") window.pageKeys.push(type);
        if (event.key === "c") window.pageC.push(type);
      }, true);
    }
  </script>`;
  const body = (await response.text()).replace(/<head[^>]*>/, (head) => `${head}${pageShortcut}`);
  await route.fulfill({ response, headers, body });
});
const keyPage = await keys.newPage();
await keyPage.goto(`${PULL_URL}/files`);
await inlineBar(keyPage).locator(".stack-list").waitFor();
const toast = keyPage.locator("flohub-toast");
const reviewDialog = keyPage.locator("flohub-dialog dialog");

await keyPage.keyboard.press("r");
await keyPage.keyboard.press("y");
await toast.getByText(`Approved #${CURRENT}.`).waitFor();
check(
  JSON.stringify(keyFixture.submissions) === JSON.stringify([{ path: "/reviews", body: { event: "APPROVE" } }]),
  `R→Y approves without a comment: ${JSON.stringify(keyFixture.submissions)}`,
);
const pageKeys = () => keyPage.evaluate(() => (window as unknown as { pageKeys: string[] }).pageKeys.join());
check((await pageKeys()) === "", `GitHub's own y shortcut never sees the Y of R→Y: "${await pageKeys()}"`);
await keyPage.keyboard.press("y");
check((await pageKeys()) === "keydown,keyup", "a plain Y still reaches GitHub's own shortcut");

await keys.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://github.com" });
await keyPage.keyboard.press("c");
await keyPage.keyboard.press("c");
await toast.getByText(`Copied gh pr checkout ${CURRENT}`).waitFor();
const readClipboard = () => keyPage.evaluate(() => navigator.clipboard.readText());
const checkoutCommand = await readClipboard();
await keyPage.keyboard.press("c");
await keyPage.keyboard.press("g");
await toast.getByText(`Copied ${PULL_URL}`).waitFor();
const pullLink = await readClipboard();
const pageC = await keyPage.evaluate(() => (window as unknown as { pageC: string[] }).pageC.join());
check(
  checkoutCommand === `gh pr checkout ${CURRENT}` && pullLink === PULL_URL && pageC === "",
  `C then C copies the checkout command and C then G the link, and GitHub's own C shortcut never sees a C: "${checkoutCommand}", "${pullLink}", page saw "${pageC}"`,
);

await keyPage.keyboard.press("r");
await keyPage.keyboard.press("a");
await keyPage.getByRole("dialog", { name: `Approve #${CURRENT}` }).waitFor();
await reviewDialog.getByText("No pending review comments.").waitFor();
check(
  await reviewDialog.getByRole("textbox").evaluate((node) => node === (node.getRootNode() as ShadowRoot).activeElement),
  "R→A opens the approve dialog with the comment box focused",
);
await keyPage.keyboard.type("ry looks good");
await keyPage.screenshot({ path: `${SCREENSHOTS}/review-dialog-light.png` });
await keyPage.keyboard.press("Meta+Enter");
await reviewDialog.waitFor({ state: "hidden" });
check(
  JSON.stringify(keyFixture.submissions.slice(1)) ===
    JSON.stringify([{ path: "/reviews", body: { event: "APPROVE", body: "ry looks good" } }]),
  "typing inside the dialog fires no shortcut, and ⌘↵ submits the approval with its comment",
);

await keyPage.keyboard.press("r");
await keyPage.keyboard.press("n");
await reviewDialog.getByText("No pending review comments.").waitFor();
await keyPage.keyboard.press("Meta+Enter");
await reviewDialog.getByText("Add a comment that explains the changes you're requesting.").waitFor();
await keyPage.keyboard.press("Escape");
await reviewDialog.waitFor({ state: "hidden" });
check(keyFixture.submissions.length === 2, "R→N refuses an empty change request, and Escape closes the dialog");

keyFixture.reviewState.pendingComments = 2;
await keyPage.keyboard.press("r");
await keyPage.keyboard.press("n");
await reviewDialog.getByText("Submits your pending review with its 2 draft comments.").waitFor();
await keyPage.screenshot({ path: `${SCREENSHOTS}/review-dialog-pending-light.png` });
await keyPage.keyboard.press("Meta+Enter");
await toast.getByText(`Requested changes on #${CURRENT}.`).waitFor();
check(
  JSON.stringify(keyFixture.submissions[2]) ===
    JSON.stringify({ path: "/reviews/9/events", body: { event: "REQUEST_CHANGES" } }),
  "R→N with draft comments submits the pending review, comment optional",
);

const filter = keyPage.getByPlaceholder("Filter changed files");
await filter.click();
await keyPage.keyboard.type("ry");
await keyPage.keyboard.press("Escape");
await filter.blur();
check(keyFixture.submissions.length === 3, "keys typed into GitHub's own text fields are ignored");

const upRequest = keyPage.waitForRequest((request) => request.isNavigationRequest(), { timeout: 10_000 });
await keyPage.keyboard.press("Meta+Shift+ArrowUp");
const up = (await upRequest).url();
check(up === `${REPO_URL}/pull/345/files`, `⌘⇧↑ requests ${up}`);
await keyPage.goto(`${PULL_URL}/files`);
await inlineBar(keyPage).locator(".stack-list").waitFor();
const downRequest = keyPage.waitForRequest((request) => request.isNavigationRequest(), { timeout: 10_000 });
await keyPage.keyboard.press("Meta+Shift+ArrowDown");
const down = (await downRequest).url();
check(down === `${REPO_URL}/pull/341/files`, `⌘⇧↓ moves down the stack: ${down}`);
await keys.close();

const darkKeys = await launch("dark");
await darkKeys.route("https://api.github.com/**", (route) => createFixture().handle(route));
const darkKeyPage = await darkKeys.newPage();
await darkKeyPage.goto(`${PULL_URL}/files`);
await inlineBar(darkKeyPage).locator(".stack-list").waitFor();
await darkKeyPage.keyboard.press("r");
await darkKeyPage.keyboard.press("n");
await darkKeyPage.locator("flohub-dialog dialog").getByText("No pending review comments.").waitFor();
await darkKeyPage.keyboard.type("Please split the rebase planner out of this change.");
await darkKeyPage.screenshot({ path: `${SCREENSHOTS}/review-dialog-dark.png` });
await darkKeys.close();

const pokes = await launch("light");
const pokeFixture = createFixture();
await pokes.route("https://api.github.com/**", (route) => pokeFixture.handle(route));
const pokePage = await pokes.newPage();
await pokePage.goto(`${PULL_URL}/files`);
await inlineBar(pokePage).locator(".stack-list").waitFor();
const pokeButtons = await inlineBar(pokePage).getByRole("button", { name: /^Poke / }).evaluateAll((buttons) =>
  buttons.map((button) => button.getAttribute("aria-label")?.split(":")[0]),
);
check(
  JSON.stringify(pokeButtons) === JSON.stringify(["Poke mojombo", "Poke github/backend"]),
  `only currently requested reviewers can be poked: ${JSON.stringify(pokeButtons)}`,
);
await inlineBar(pokePage).getByRole("button", { name: /^Poke mojombo/ }).click();
await pokePage.locator("flohub-toast").getByText("Poked mojombo. GitHub notifies them within a minute.").waitFor();
await inlineBar(pokePage).locator(".chips > li", { hasText: "mojombo" }).getByText("· poked just now").waitFor();
await inlineBar(pokePage).getByRole("button", { name: /^Poke github\/backend/ }).click();
await inlineBar(pokePage).locator(".chips > li", { hasText: "github/backend" }).getByText("· poked just now").waitFor();
check(
  pokeFixture.requestLog.join() === "remove:mojombo,add:mojombo,remove:team:backend,add:team:backend",
  `a poke removes and re-adds the request, for users and teams: ${pokeFixture.requestLog.join()}`,
);
await inlineBar(pokePage).screenshot({ path: `${SCREENSHOTS}/poke-light.png` });
await pokePage.reload();
await inlineBar(pokePage).locator(".chips > li", { hasText: "mojombo" }).getByText("· poked just now").waitFor();
check(
  (await inlineBar(pokePage).getByRole("button", { name: /^Poke / }).count()) === 0,
  "a poked reviewer can't be poked again within the hour, across reloads",
);
await pokes.close();

const failedPoke = await launch("light");
const failedFixture = createFixture({ failReadd: true });
await failedPoke.route("https://api.github.com/**", (route) => failedFixture.handle(route));
const failedPage = await failedPoke.newPage();
await failedPage.goto(`${PULL_URL}/files`);
await inlineBar(failedPage).locator(".stack-list").waitFor();
await inlineBar(failedPage).getByRole("button", { name: /^Poke mojombo/ }).click();
await failedPage.locator("flohub-toast").getByText(/Re-request mojombo by hand\./).waitFor();
check(
  failedFixture.requestLog.join() === "remove:mojombo,add:mojombo,add:mojombo",
  `a failed re-add is retried once and then tells you to re-request by hand: ${failedFixture.requestLog.join()}`,
);
await failedPoke.close();

const partial = await launch("light");
await partial.route("https://api.github.com/**", (route) => createFixture({ partial: true }).handle(route));
const partialPage = await partial.newPage();
await partialPage.goto(`${PULL_URL}/files`);
await inlineBar(partialPage).locator(".stack-list").waitFor();
const notice = await inlineBar(partialPage).getByRole("alert").innerText();
check(
  notice.includes("statusCheckRollup") && notice.includes("requestedReviewer") &&
    (await inlineBar(partialPage).locator(".chips > li").count()) === 6,
  `fields the token cannot read leave the rest of the overview intact: "${notice}"`,
);
await inlineBar(partialPage).screenshot({ path: `${SCREENSHOTS}/partial-light.png` });
await partial.close();

console.log(`Screenshots in ${SCREENSHOTS}`);
