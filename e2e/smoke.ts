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

function createFixture(options: { partial?: boolean } = {}) {
  const requested: (object | null)[] = [
    actor("mojombo"),
    { __typename: "Team", name: "backend", combinedSlug: "github/backend", avatarUrl: null, url: "https://github.com/orgs/github/teams/backend" },
  ];
  if (options.partial) requested.push(null);
  const rerequests: string[] = [];
  const viewedMarks: string[] = [];
  const viewed = { ...CHANGED_FILES };
  const submissions: { path: string; body: unknown }[] = [];
  const reviewState = { pendingComments: null as number | null };
  return {
    rerequests,
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
      if (request.method() === "POST" && request.url().endsWith("/requested_reviewers")) {
        const { reviewers } = request.postDataJSON() as { reviewers: string[] };
        rerequests.push(...reviewers);
        for (const login of reviewers) requested.push(actor(login));
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
      await route.fulfill({ status: 404, json: { message: "Not mocked" } });
    },
  };
}

async function launch(colorScheme: "light" | "dark"): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(), "flohub-")), {
    channel: "chromium",
    headless: true,
    colorScheme,
    viewport: { width: 1280, height: 860 },
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
  });
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
    .filter((line) => !line.endsWith("conversations resolved"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
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

await page.mouse.wheel(0, -5000);
await inlineBar(page).getByRole("button", { name: "Re-request review from defunkt" }).click();
await inlineBar(page).locator(".chips > li", { hasText: "defunkt" }).getByText("Re-requested").waitFor();
check(fixture.rerequests.join() === "defunkt", "re-request posts only defunkt to requested_reviewers");

await page.getByRole("link", { name: /Conversation/ }).first().click();
await page.waitForURL(/\/pull\/\d+$/);
await inlineBar(page).getByText("Re-requested").first().waitFor();
check(await inlineBar(page).isVisible(), "bar survives in-page navigation to the Conversation tab");
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
cachedFixture.overviewDelay = 1_000;
cachedFixture.overviewFailure = 502;
await cachedPage.reload();
await inlineBar(cachedPage).locator(".stack-list").waitFor({ timeout: 3_000 });
await inlineBar(cachedPage).getByRole("button", { name: "Retry" }).waitFor({ timeout: 10_000 });
check(
  (await inlineBar(cachedPage).locator(".chips > li").count()) === 0,
  "when the first fresh load fails, the cached overview gives way to the error and Retry",
);
await cached.close();

const dark = await launch("dark");
await dark.route("https://api.github.com/**", (route) => createFixture().handle(route));
const darkPage = await dark.newPage();
await darkPage.goto(`${PULL_URL}/files`);
await inlineBar(darkPage).getByText("Approved").first().waitFor();
await inlineBar(darkPage).screenshot({ path: `${SCREENSHOTS}/inline-dark.png` });
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
