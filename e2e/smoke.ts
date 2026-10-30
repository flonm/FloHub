import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { type BrowserContext, chromium, type Locator, type Page, type Route } from "playwright";

process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";

const EXTENSION = nodePath.resolve("dist");
const PULL_URL = process.env.PULL_URL ?? "https://github.com/github/gh-stack/pull/344";
const SCREENSHOTS = nodePath.resolve(process.env.SCREENSHOTS ?? "e2e/screenshots");
/** Where `bun run screenshots` puts the README's pictures; without it, the run takes none. */
const README_SHOTS = process.env.README_SHOTS ? nodePath.resolve(process.env.README_SHOTS) : null;

/**
 * Takes one of the README's pictures, when asked to: FloHub's own UI only, cut out of GitHub's page.
 * @param target The element.
 * @param name The picture's name, with its theme.
 */
async function readmeShot(target: Locator, name: string): Promise<void> {
  if (!README_SHOTS) return;
  const path = `${README_SHOTS}/${name}.png`;
  // A toast left over from an earlier step would cover the picture.
  const toasts = target.page().locator("flohub-toast");
  await toasts.evaluateAll((hosts) => {
    for (const host of hosts) (host as HTMLElement).style.visibility = "hidden";
  });
  // Menus and dialogs fade in; the picture shows them settled.
  await target.screenshot({ path, animations: "disabled" });
  await toasts.evaluateAll((hosts) => {
    for (const host of hosts) (host as HTMLElement).style.visibility = "";
  });
}

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
const REPO_URL = PULL_URL.replace(/\/pull\/\d+$/u, "");
const CURRENT = Number(PULL_URL.split("/").pop());
/** Whether the browser runs on macOS, where FloHub binds ⌘Esc and ⌘⇧Esc. */
const MAC = process.platform === "darwin";

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
    isInMergeQueue: false,
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

/** The viewer's own pull requests, which the search for author:@me finds. */
const OWN = { author: { login: "octocat", avatarUrl: "https://avatars.githubusercontent.com/octocat?v=4" }, reviewRequests: { nodes: [] } };

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
      inboxPull(903, "feat(ui): render the stack", { stack: INBOX_STACK, additions: 48, deletions: 7, timelineItems: { nodes: [{ __typename: "HeadRefForcePushedEvent", createdAt: ago(1) }] } }),
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
      inboxPull(120, "docs: explain the stack badge", { ...OWN, reviewDecision: "APPROVED" }),
      inboxPull(121, "feat(stack): show failing checks", { ...OWN, statusCheckRollup: { state: "FAILURE" } }, "octo-org/api"),
      inboxPull(122, "feat(stack): page through long stacks", { ...OWN, reviewRequests: { nodes: [{ requestedReviewer: { login: "defunkt" } }] } }, "octo-org/api"),
      {},
    ],
  },
  waiting: {
    nodes: [
      inboxPull(
        130,
        "fix(sync): keep local commits on rebase",
        {
          author: { login: "mojombo", avatarUrl: "https://avatars.githubusercontent.com/mojombo?v=4" },
          reviewDecision: "CHANGES_REQUESTED",
          reviewRequests: { nodes: [] },
          latestReviews: {
            nodes: [
              { state: "CHANGES_REQUESTED", author: { login: "octocat" }, submittedAt: ago(5) },
              { state: "APPROVED", author: { login: "defunkt" }, submittedAt: ago(4) },
            ],
          },
          latestOpinionatedReviews: { nodes: [{ state: "CHANGES_REQUESTED", author: { login: "octocat" } }] },
          timelineItems: { nodes: [{ __typename: "HeadRefForcePushedEvent", createdAt: ago(2) }] },
        },
        "octo-org/api",
      ),
    ],
  },
};

/** An open pull request only "Everything else" finds, when asked to load every open one. */
const ELSEWHERE = inboxPull(140, "refactor(api): split the resolvers", { reviewRequests: { nodes: [] } }, "octo-org/api");

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

type InboxFixture = Record<string, { nodes: { url?: string }[] } | { login: string }>;

/** What the inbox searches answer: each pull request's node id, which the fixtures take from its URL. */
function inboxIds(inbox: InboxFixture): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(inbox).map(([key, value]) => [
      key,
      "nodes" in value ? { nodes: value.nodes.map((node) => (node.url ? { id: node.url } : {})) } : value,
    ]),
  );
}

/** What the details query answers for the node ids it asks for. */
function inboxDetails(inbox: InboxFixture, ids: string[]): { nodes: object[] } {
  const pulls = [...Object.values(inbox).flatMap((value) => ("nodes" in value ? value.nodes : [])), ELSEWHERE];
  return { nodes: ids.map((id) => ({ id, ...pulls.find((pull) => pull.url === id) })) };
}

const EMPTY_INBOX = { viewer: { login: "octocat" }, review: { nodes: [] }, mine: { nodes: [] }, waiting: { nodes: [] } };

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

const REVIEW_TEXTS: Record<string, { bodyText: string; bodyHTML?: string; hoursAgo: number }> = {
  defunkt: {
    bodyText: "Please split the rebase planner out of this change.",
    bodyHTML: "<p>Please split the <strong>rebase planner</strong> out of this change.</p>",
    hoursAgo: 20,
  },
  coderabbitai: { bodyText: "Actionable comments posted: 2", hoursAgo: 3 },
  octocat: { bodyText: "LGTM once the planner is split.", hoursAgo: 0.5 },
};

/** A review thread as the turn reads it: who started it, and who spoke last. */
function turnThread(starter: string, last: string, isOutdated = false) {
  return { isResolved: false, isOutdated, first: { nodes: [{ author: { __typename: "User", login: starter } }] }, recent: { nodes: [{ author: { __typename: "User", login: last } }] } };
}

function withDiscussionText<T extends { author: { login: string } }>(node: T) {
  const text = REVIEW_TEXTS[node.author.login];
  return {
    ...node,
    bodyText: text?.bodyText ?? "",
    ...(text?.bodyHTML && { bodyHTML: text.bodyHTML }),
    url: `${PULL_URL}#pullrequestreview-${node.author.login}`,
    ...(text && { submittedAt: ago(text.hoursAgo) }),
  };
}

const LONG_COMMENT = [
  "Before this merges, two things from the staging run:",
  "1. The adopted branch keeps its old upstream, so a later push goes to the wrong remote ref.",
  "2. When the server rebased onto a moved base, the local tip is ahead and the adoption is skipped silently.",
  "Both reproduce with the fixture in cmd/rebase_test.go if you pass --server-rebased twice.",
].join("\n");

const LONG_COMMENT_HTML = [
  "<p>Before this merges, two things from the staging run:</p>",
  "<ol><li>The adopted branch keeps its old upstream, so a later push goes to the wrong remote ref.</li>",
  "<li>When the server rebased onto a moved base, the local tip is ahead and the adoption is skipped silently.</li></ol>",
  "<p>Both reproduce with the fixture in <code>cmd/rebase_test.go</code> if you pass <code>--server-rebased</code> twice.</p>",
  '<img src="x" onerror="document.title = \'pwned\'">',
  '<a href="javascript:document.title = \'pwned\'">harmless looking</a>',
  "<script>document.title = 'pwned'</script>",
  '<svg onload="document.title = \'pwned\'"><circle r="4"></circle></svg>',
].join("");

const DISCUSSION_COMMENTS = [
  {
    bodyText: "Did we check this against a server-rebased stack?",
    bodyHTML: '<p>Did we check this against a <a href="/github/gh-stack/pull/341">server-rebased stack</a>?</p>',
    url: `${PULL_URL}#issuecomment-1`,
    createdAt: ago(2),
    author: actor("wycats"),
  },
  { bodyText: LONG_COMMENT, bodyHTML: LONG_COMMENT_HTML, url: `${PULL_URL}#issuecomment-2`, createdAt: ago(1), author: actor("mojombo") },
  {
    bodyHTML:
      '<div class="markdown-alert markdown-alert-warning"><p class="markdown-alert-title"><svg></svg>Warning</p><p>This pull request is not mergeable via GitHub because a downstack PR is open.</p></div>',
    bodyText: "WarningThis pull request is not mergeable via GitHub because a downstack PR is open.",
    url: `${PULL_URL}#issuecomment-3`,
    createdAt: ago(5),
    author: actor("hubot"),
  },
];

function createFixture(
  options: { partial?: boolean; failReadd?: boolean; inbox?: object; inboxGate?: Promise<unknown>; discussion?: boolean } = {},
) {
  const requested: (object | null)[] = [
    actor("mojombo"),
    { __typename: "Team", name: "backend", combinedSlug: "github/backend", avatarUrl: null, url: "https://github.com/orgs/github/teams/backend" },
  ];
  if (options.partial) requested.push(null);
  const rerequests: string[] = [];
  const requestLog: string[] = [];
  /** Comments posted on the pull request's conversation. */
  const comments: string[] = [];
  const viewedMarks: string[] = [];
  const viewed = { ...CHANGED_FILES };
  const submissions: { path: string; body: unknown }[] = [];
  const reviewState = { pendingComments: null as number | null };
  const compareLog: string[] = [];
  const created = {
    compareLog,
    rerequests,
    requestLog,
    comments,
    requested,
    viewedMarks,
    /** The viewer's Viewed mark on each file, as the API answers it. */
    viewed,
    submissions,
    reviewState,
    /** Milliseconds to hold back the overview query, to see what the bar shows before it arrives. */
    overviewDelay: 0,
    /** How long the review threads take to answer, so they can arrive after the diff. */
    threadsDelay: 0,
    /** How long a review comment takes to answer, to see what the jump menu offers before it arrives. */
    commentDelay: 0,
    /** An HTTP status to fail the overview query with, or 0 to answer it. */
    overviewFailure: 0,
    /** The viewer's pending review, and the commit it was started on, or null. */
    pendingReview: null as { commit: string } | null,
    /** The head the review threads' query answers with, which a push moves. */
    threadsHead: "ccccccc3",
    /** Every comment, reply and resolve the versions view sent, as the request or mutation and its input. */
    reviewActions: [] as string[],
    /** The pull request's state, which closing, reopening and the draft toggle change, and each mutation sent. */
    pull: { state: "OPEN", isDraft: false, moves: [] as string[] },
    async handle(route: Route): Promise<void> {
      const request = route.request();
      const graphql = request.url().endsWith("/graphql")
        ? (request.postDataJSON() as { query: string; variables: { path?: string; ids?: string[] } })
        : null;
      const reviewMutation = graphql?.query.match(
        /\b(resolveReviewThread|unresolveReviewThread|addPullRequestReviewThreadReply|addPullRequestReviewThread|addPullRequestReview|dismissPullRequestReview)\(/u,
      )?.[1];
      if (graphql && reviewMutation) {
        created.reviewActions.push(`${reviewMutation} ${JSON.stringify(graphql.variables)}`);
        const results: Record<string, unknown> = {
          addPullRequestReview: { pullRequestReview: { id: "PRR_new" } },
          addPullRequestReviewThread: { thread: { id: "PRRT_new" } },
        };
        await route.fulfill({ json: { data: { [reviewMutation]: results[reviewMutation] ?? { clientMutationId: null } } } });
        return;
      }
      if (request.method() === "POST" && /\/pulls\/\d+\/comments(?:\/\d+\/replies)?$/u.test(request.url())) {
        created.reviewActions.push(`POST ${new URL(request.url()).pathname.replace(/^.*\/pulls\//u, "pulls/")} ${request.postData()}`);
        await route.fulfill({ status: 201, json: { id: 5 } });
        return;
      }
      const move = graphql?.query.match(/\b(closePullRequest|reopenPullRequest|convertPullRequestToDraft|markPullRequestReadyForReview)\(/u)?.[1];
      if (graphql && move) {
        created.pull.moves.push(move);
        if (move === "closePullRequest" || move === "reopenPullRequest") created.pull.state = move === "closePullRequest" ? "CLOSED" : "OPEN";
        else created.pull.isDraft = move === "convertPullRequestToDraft";
        await route.fulfill({ json: { data: { [move]: { pullRequest: { id: "PR_current" } } } } });
        return;
      }
      const mutation = graphql?.query.match(/\b(markFileAsViewed|unmarkFileAsViewed)\b/u)?.[1];
      if (graphql && mutation) {
        const path = graphql.variables.path ?? "";
        viewedMarks.push(`${mutation === "markFileAsViewed" ? "mark" : "unmark"}:${path}`);
        viewed[path] = mutation === "markFileAsViewed" ? "VIEWED" : "UNVIEWED";
        await route.fulfill({ json: { data: { [mutation]: { clientMutationId: null } } } });
        return;
      }
      if (graphql?.query.includes("viewerViewedState")) {
        const nodes = Object.entries(viewed).map(([path, viewerViewedState]) => {
          const { additions, deletions } = CHANGE_STATS[path] ?? { additions: 3, deletions: 3 };
          return { path, viewerViewedState, additions, deletions };
        });
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
      if (graphql?.query.includes("search(query: $query")) {
        // Every open pull request of an owner: one the inbox shows already, and one only this search finds.
        const urls = [(ELSEWHERE as { url: string }).url, "https://github.com/octo-org/api/pull/122"];
        await route.fulfill({ json: { data: { viewer: { login: "octocat" }, search: { issueCount: 2, nodes: urls.map((id) => ({ id })) } } } });
        return;
      }
      if (graphql?.query.includes("review: search(")) {
        await options.inboxGate;
        await route.fulfill({ json: { data: inboxIds((options.inbox ?? INBOX) as InboxFixture) } });
        return;
      }
      if (graphql?.query.includes("nodes(ids:")) {
        await route.fulfill({ json: { data: inboxDetails((options.inbox ?? INBOX) as InboxFixture, graphql.variables.ids ?? []) } });
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
                  reviews: {
                    nodes: [
                      { state: "COMMENTED", author: { login: "octocat" }, submittedAt: ago(40), commit: commit("aaaaaaa1", 48) },
                      { state: "CHANGES_REQUESTED", author: { login: "defunkt" }, submittedAt: ago(44), commit: commit("aaaaaaa1", 48) },
                      { state: "CHANGES_REQUESTED", author: { login: "mojombo" }, submittedAt: ago(18), commit: commit("bbbbbbb2", 20) },
                      { state: "APPROVED", author: { login: "mojombo" }, submittedAt: ago(2), commit: commit("ccccccc3", 3) },
                    ],
                  },
                },
              },
            },
          },
        });
        return;
      }
      if (graphql?.query.includes("originalStartLine diffSide")) {
        if (created.threadsDelay > 0) {
          await new Promise((resolve) => {
            setTimeout(resolve, created.threadsDelay);
          });
        }
        const reviewThread = (id: string, path: string, line: number, on: string, body: string, more = "") => ({
          id,
          isResolved: false,
          isOutdated: on !== "ccccccc3",
          path,
          line: on === "ccccccc3" ? line : null,
          startLine: null,
          originalLine: line,
          originalStartLine: null,
          diffSide: "RIGHT",
          resolvedBy: null,
          comments: {
            nodes: [
              { databaseId: 1, author: { login: "octocat", avatarUrl: "" }, authorAssociation: "MEMBER", bodyHTML: `<p>${body}</p>${more}`, createdAt: ago(30), url: "", state: "SUBMITTED", originalCommit: { oid: on } },
            ],
          },
        });
        await route.fulfill({
          json: {
            data: {
              repository: {
                pullRequest: {
                  id: "PR_split",
                  headRefOid: created.threadsHead,
                  author: { login: "hubot" },
                  reviews: { nodes: created.pendingReview ? [{ id: "PRR_pending", commit: { oid: created.pendingReview.commit } }] : [] },
                  reviewThreads: {
                    nodes: [
                      reviewThread(
                        "PRRT_1",
                        "README.md",
                        305,
                        "aaaaaaa1",
                        "Is this still true?",
                        "<details><summary>Why I ask</summary><p>The planner changed.</p></details><p><strong>Check the docs.</strong></p><p><em>Source: review notes</em></p>",
                      ),
                      reviewThread("PRRT_2", "cmd/rebase.go", 44, "ccccccc3", "Log at debug level?"),
                      reviewThread("PRRT_3", "cmd/rebase.go", 44, "bbbbbbb2", "Was logging here before?"),
                      reviewThread("PRRT_4", "docs/same.md", 2, "aaaaaaa1", "Say which rebases."),
                    ],
                  },
                },
              },
            },
          },
        });
        return;
      }
      if (graphql?.query.includes("comments(first: 1) { nodes { databaseId")) {
        // PRRT_kwABzQN4 is thread 888, the number an outdated comment's link names it by.
        await route.fulfill({
          json: { data: { repository: { pullRequest: { reviewThreads: { nodes: [{ id: "PRRT_kwABzQN4", comments: { nodes: [{ databaseId: 999 }] } }] } } } } },
        });
        return;
      }
      if (graphql?.query.includes("pullRequests(headRefName")) {
        await route.fulfill({ json: { data: { repository: { b0: { nodes: [] } } } } });
        return;
      }
      if (graphql) {
        if (created.overviewDelay > 0) {
          await new Promise((resolve) => {
            setTimeout(resolve, created.overviewDelay);
          });
        }
        if (created.overviewFailure > 0) {
          await route.fulfill({ status: created.overviewFailure, json: { message: "Bad gateway" } });
          return;
        }
        await route.fulfill({
          json: {
            data: {
              viewer: { login: "octocat" },
              repository: {
                pullRequest: {
                  ...STACK_PULLS.find((pull) => pull.number === CURRENT),
                  ...(options.partial && { statusCheckRollup: null }),
                  id: "PR_current",
                  state: created.pull.state,
                  isDraft: created.pull.isDraft,
                  baseRefName: "main",
                  baseRefOid: "basebase",
                  headRefOid: "ccccccc3",
                  headRefName: "feat/rebase-planner",
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
                  dismissals: { nodes: [{ previousReviewState: "APPROVED", review: { url: `${PULL_URL}#pullrequestreview-pjhyett` } }] },
                  reviews: {
                    nodes: [
                      { ...review("defunkt", "CHANGES_REQUESTED"), id: "PRR_defunkt" },
                      review("mojombo", "CHANGES_REQUESTED"),
                      review("coderabbitai", "COMMENTED", "Bot"),
                      { ...review("pjhyett", "DISMISSED"), url: `${PULL_URL}#pullrequestreview-pjhyett` },
                      { ...review("octocat", "APPROVED"), commit: { oid: "aaaaaaa1" } },
                      review("wycats", "COMMENTED"),
                    ].map((node) => (options.discussion ? withDiscussionText(node) : node)),
                  },
                  ...(options.discussion && { comments: { nodes: DISCUSSION_COMMENTS } }),
                  turnThreads: { nodes: [turnThread("octocat", "hubot"), turnThread("defunkt", "hubot"), turnThread("mojombo", "mojombo", true), turnThread("wycats", "wycats")] },
                },
              },
            },
            ...(options.partial && {
                  errors: [
                    { message: UNREADABLE, path: ["repository", "pullRequest", "statusCheckRollup"] },
                    { message: UNREADABLE, path: ["repository", "pullRequest", "reviewRequests", "nodes", 2, "requestedReviewer"] },
                  ],
                }),
          },
        });
        return;
      }
      if (request.method() === "POST" && /\/issues\/\d+\/comments$/u.test(request.url())) {
        comments.push((request.postDataJSON() as { body: string }).body);
        await route.fulfill({ status: 201, json: {} });
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
      const reviews = /\/pulls\/\d+\/reviews(\/\d+\/(comments|events))?(\?|$)/u.exec(`${new URL(request.url()).pathname}?`);
      if (reviews) {
        const path = new URL(request.url()).pathname.replace(/^.*\/pulls\/\d+/u, "");
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
      const comment = /\/pulls\/comments\/(\d+)$/u.exec(request.url());
      if (comment) {
        if (created.commentDelay > 0) {
          await new Promise((resolve) => {
            setTimeout(resolve, created.commentDelay);
          });
        }
        // 999 was written on the reviewed v1, on a README.md line the head renumbers, and is outdated there; 777 on the
        // head, on the same line as the head numbers it.
        const outdated = comment[1] === "999";
        await route.fulfill({
          json: {
            path: "README.md",
            original_commit_id: outdated ? "aaaaaaa1" : "ccccccc3",
            original_line: outdated ? 305 : 326,
            original_start_line: null,
            line: outdated ? null : 326,
            start_line: null,
            side: "RIGHT",
            created_at: ago(outdated ? 40 : 1),
          },
        });
        return;
      }
      const compare = /\/compare\/(\w+)\.\.\.(\w+)/u.exec(request.url());
      if (compare) {
        const [, base, head] = compare as unknown as [string, string, string];
        compareLog.push(`${base}...${head}`);
        const files = VERSION_FILES[head] ?? VERSION_FILES.ccccccc3!;
        await route.fulfill({
          json: { status: head === "ccccccc3" ? "ahead" : "diverged", merge_base_commit: { sha: head === "ccccccc3" ? base : "oldbase" }, files },
        });
        return;
      }
      await route.fulfill({ status: 404, json: { message: "Not mocked" } });
    },
  };
  return created;
}

async function badgeText(context: BrowserContext): Promise<string | undefined> {
  const [worker] = context.serviceWorkers();
  const text = await worker?.evaluate(async () => chrome.action.getBadgeText({}));
  return text;
}

/**
 * @param api Answers GitHub's API from the start, so the refresh the stored token starts never reaches the real one.
 */
async function launch(colorScheme: "light" | "dark", api?: (route: Route) => Promise<void>): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext(await mkdtemp(nodePath.join(tmpdir(), "flohub-")), {
    channel: "chromium",
    headless: true,
    colorScheme,
    viewport: { width: 1280, height: 860 },
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
  });
  if (api) await context.route("https://api.github.com/**", api);
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  await worker.evaluate(async () => chrome.storage.local.set({ token: "test-token" }));
  return context;
}

function inlineBar(page: Page) {
  return page.locator('flohub-bar[data-mode="inline"]');
}

/** @returns Each reviewer row as its name and state, e.g. "defunkt: Changes requested", in order. */
async function reviewerRows(page: Page): Promise<string[]> {
  return inlineBar(page)
    .locator(".reviewer")
    .evaluateAll((rows) =>
      rows.map((row) => `${row.querySelector(".name")?.textContent ?? ""}${row.querySelector(".visually-hidden")?.textContent.split(". ", 1)[0] ?? ""}`),
    );
}

/** @returns The value a versions-view picker shows as picked, such as "1" for v1 or "0" for the base branch. */
async function pickerValue(scope: Locator, name: string): Promise<string> {
  return (await scope.locator(`[data-picker="${name}"] > button`).getAttribute("data-value")) ?? "";
}

/** Opens the files the versions view folded because they're marked Viewed, once the marks are in, to see their threads. */
async function openViewed(scope: Locator): Promise<void> {
  // A redrawn diff folds them again: waiting for a folded one waits for the redraw.
  await scope.locator('details.file:not([open]) > summary > .viewed-box[aria-checked="true"]').first().waitFor();
  await scope.locator("details.file").evaluateAll((files) => {
    for (const file of files) (file as HTMLDetailsElement).open = true;
  });
}

/** Opens a versions-view picker and picks the choice with that value, as a click would. */
async function pickIn(scope: Locator, name: string, value: string): Promise<void> {
  await scope.locator(`[data-picker="${name}"] > button`).click();
  await scope.locator(`[data-picker="${name}"] [role="option"][data-value="${value}"]`).click();
}

function floatingBar(page: Page) {
  return page.locator('flohub-bar[data-mode="floating"]');
}

function visibleText(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.endsWith("conversations resolved") && !line.endsWith("between the versions"))
    .join(" ")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

async function diffAnchorOf(path: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(path));
  return `diff-${Buffer.from(digest).toString("hex")}`;
}

/**
 * @param on The page.
 * @param selector What should come into view.
 * @returns Whether it is inside the window within a few seconds.
 */
async function scrolledTo(on: Page, selector: string): Promise<boolean> {
  try {
    await on.waitForFunction((wanted) => {
      const box = document.querySelector(wanted)?.getBoundingClientRect();
      return box !== undefined && box.top >= 0 && box.bottom <= innerHeight;
    }, selector, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`ok - ${message}`);
}

const setup = await launch("light");
await setup.route("https://api.github.com/**", async (route) => createFixture().handle(route));
const [setupWorker] = setup.serviceWorkers();
await setupWorker?.evaluate(async () => chrome.storage.local.remove("token"));
const extensionId = new URL(setupWorker?.url() ?? "").host;
const options = await setup.newPage();
await options.goto(`chrome-extension://${extensionId}/options.html`);
await options.getByLabel("Personal access token").fill("github_pat_test");
await options.getByRole("button", { name: "Save and test" }).click();
await options.getByText("Signed in as octocat").waitFor();
const stored = await setupWorker?.evaluate(async () => chrome.storage.local.get("token"));
check(stored?.token === "github_pat_test", "options page tests the token against GitHub and stores it");
await options.screenshot({ path: `${SCREENSHOTS}/options-light.png` });
await setup.close();

const light = await launch("light");
const fixture = createFixture();
await light.route("https://api.github.com/**", async (route) => fixture.handle(route));
const page = await light.newPage();

await page.goto(`${PULL_URL}/files`);
await inlineBar(page).locator(".reviewer").first().waitFor();
const turnText = await inlineBar(page).locator(".turn").textContent();
const defunktRow = inlineBar(page).locator(".reviewer", { hasText: "defunkt" });
check(
  turnText?.startsWith("Your turn1 reply") === true &&
    (await defunktRow.getAttribute("data-waiting")) === "" &&
    (await defunktRow.locator(".turn-mark").textContent()) === "1",
  `the toolbar says it is the viewer's turn, and a reviewer the author answered last waits with a mark: ${turnText}`,
);
check(
  (await inlineBar(page).locator(".tool.progress").textContent())?.startsWith("Threads: 1 changed · 2 replied · 1 untouched") === true,
  `the toolbar counts the open threads by whether their code changed or the author answered: ${await inlineBar(page).locator(".tool.progress").textContent()}`,
);
const reviewers = await reviewerRows(page);
check(
  JSON.stringify(reviewers) ===
    JSON.stringify([
      "defunkt: Changes requested",
      "mojombo: Re-requested",
      "github/backend: Review requested",
      "pjhyett: Approval dismissed",
      "wycats: Commented",
      "octocat: Approved",
    ]),
  `reviewers are listed one per row, in status order, each named with its state: ${JSON.stringify(reviewers)}`,
);
const rings = await inlineBar(page)
  .locator(".reviewer")
  .evaluateAll((rows) =>
    rows.map((row) => `${(row as HTMLElement).dataset.ring}${(row as HTMLElement).dataset.waiting === undefined ? "" : " dashed"} ${row.querySelector<SVGElement>(".glyph")?.dataset.tone}`),
  );
check(
  JSON.stringify(rings) ===
    JSON.stringify(["attention dashed attention", "attention dashed attention", "muted dashed attention", "muted success", "muted muted", "success dashed success"]),
  `the ring says what counts now and dashes whose turn it is, while the glyph keeps what they said: ${JSON.stringify(rings)}`,
);
check(
  ((await inlineBar(page).locator(".reviewer", { hasText: "mojombo" }).getAttribute("data-tip")) ?? "").startsWith(
    "mojombo: Review requested again. Before, they requested changes",
  ),
  "a row's tooltip holds what its state leaves out",
);
await inlineBar(page).getByRole("button", { name: "Keyboard shortcuts" }).click();
const shortcutRows = await inlineBar(page).getByRole("dialog", { name: "Keyboard shortcuts" }).locator("dd").count();
await page.keyboard.press("Escape");
check(
  shortcutRows === (MAC ? 19 : 17) && (await inlineBar(page).getByRole("dialog", { name: "Keyboard shortcuts" }).count()) === 0,
  `the toolbar's keyboard button lists every shortcut, and Escape closes the list: ${shortcutRows} rows`,
);
const favicons = async () =>
  page.evaluate(() => [...document.head.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')].map((link) => decodeURIComponent(link.href)));
check(
  (await favicons()).length === 2 && (await favicons()).every((href) => href.startsWith("data:image/svg+xml,") && href.includes("#bf8700")),
  `the favicons show the pull request's status as a dot, not its checks: ${(await favicons()).length}`,
);
await page.evaluate(() => {
  document.head.querySelector('link[rel="icon"]')?.setAttribute("href", "https://github.githubassets.com/favicons/favicon-success.svg");
});
await page.waitForFunction(() => document.head.querySelector<HTMLLinkElement>('link[rel="icon"]')?.href.startsWith("data:"));
check(true, "the status favicon comes back when GitHub swaps in its checks favicon");
check(await floatingBar(page).isHidden(), "floating pill is hidden while the inline bar is in view");
check(
  (await inlineBar(page).getByRole("button", { name: /Re-request review from/u }).count()) === 3,
  "re-request is offered for defunkt, pjhyett and wycats only",
);
const dismissButtons = await inlineBar(page).getByRole("button", { name: /^Dismiss /u }).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")));
check(
  JSON.stringify(dismissButtons) === JSON.stringify(["Dismiss defunkt's change request"]),
  `only a standing verdict with a known review id can be dismissed, never the viewer's own: ${JSON.stringify(dismissButtons)}`,
);
const dismissDialog = page.locator("flohub-dialog dialog");
await inlineBar(page).getByRole("button", { name: "Dismiss defunkt's change request" }).click();
await page.getByRole("dialog", { name: "Dismiss defunkt's change request" }).waitFor();
check(await dismissDialog.getByRole("button", { name: "Dismiss review" }).isDisabled(), "a dismissal waits for the reason GitHub requires");
const dismissalsBefore = fixture.reviewActions.length;
await dismissDialog.getByRole("textbox").fill("Addressed in the latest push.");
await dismissDialog.getByRole("button", { name: "Dismiss review" }).click();
await dismissDialog.waitFor({ state: "hidden" });
check(
  fixture.reviewActions.slice(dismissalsBefore).join(" | ") ===
    'dismissPullRequestReview {"id":"PRR_defunkt","message":"Addressed in the latest push."}',
  `the X dismisses the review with its reason: ${fixture.reviewActions.slice(dismissalsBefore).join(" | ")}`,
);
const defunktStale = inlineBar(page).locator(".reviewer", { hasText: "defunkt" });
await defunktStale.locator(".behind").waitFor();
check(
  (await defunktStale.locator(".behind").textContent()) === "v1" &&
    (await defunktStale.getAttribute("data-tip"))?.includes("Requested changes on v1 · 2 versions ago.") === true &&
    (await inlineBar(page).locator(".reviewer", { hasText: "mojombo" }).locator(".behind").count()) === 0 &&
    (await inlineBar(page).getByRole("button", { name: /^Ask octocat/u }).count()) === 0,
  `a reviewer whose standing verdict is on an older version says which, one whose versions disagree says nothing, and the viewer isn't offered to nudge themselves: ${await defunktStale.getAttribute("data-tip")}`,
);
const rerequestsBeforeNudge = fixture.rerequests.length;
await defunktStale.getByRole("button", { name: /^Ask defunkt to look again/u }).click();
const nudgeDialog = page.getByRole("dialog", { name: "Ask defunkt to look again" });
await nudgeDialog.waitFor();
await readmeShot(nudgeDialog, "nudge-light");
const composed = await nudgeDialog.getByRole("textbox").inputValue();
check(
  composed.startsWith("@defunkt Since you requested changes on v1 (`aaaaaaa`): ") && composed.includes("flohub-versions="),
  `asking a reviewer to look again composes what changed since their verdict, with a link to that range: ${composed}`,
);
await nudgeDialog.getByRole("button", { name: "Post and ask" }).click();
await nudgeDialog.waitFor({ state: "hidden" });
check(
  fixture.comments.at(-1) === composed && fixture.rerequests.slice(rerequestsBeforeNudge).join(",") === "defunkt",
  `the comment is posted as composed, and the reviewer is asked to review again: ${fixture.rerequests.slice(rerequestsBeforeNudge).join(",")}`,
);
// The checks below expect defunkt not to be asked.
fixture.requested.splice(fixture.requested.findIndex((entry) => entry !== null && "login" in entry && entry.login === "defunkt"), 1);
await inlineBar(page).getByRole("button", { name: "Refresh reviewers" }).click();
await inlineBar(page).getByRole("button", { name: "Re-request review from defunkt" }).waitFor();
const rows = await inlineBar(page).locator(".stack-list > li").allInnerTexts();
check(
  JSON.stringify(rows.map((row) => visibleText(row))) ===
    JSON.stringify([
      "Draft #348 docs(stack): document server rebases 1w",
      "Checks failed #347 feat(stack): show adopted branches in status 0/3 5h",
      "Merge conflict #346 refactor(stack): share push helpers 1/1 2d",
      "Needs review #345 test(stack): cover rebase adoption 30m",
      `Changes requested #${CURRENT} Adopt equivalent server-rebased branches 2/4 3h`,
      "Ready to merge #341 feat(stack): adopt server-rebased branches 7/7 1d",
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
  (await inlineBar(page).getByRole("link", { name: /#345/u }).getAttribute("href")) === `${REPO_URL}/pull/345/files`,
  "stack links keep the Files changed tab",
);
await inlineBar(page).getByRole("button", { name: "2 merged" }).click();
await inlineBar(page).getByText("#338").waitFor();
check((await inlineBar(page).getByText("Merged", { exact: true }).count()) === 2, "merged layers expand on demand");
await inlineBar(page).screenshot({ path: `${SCREENSHOTS}/inline-light.png` });
await readmeShot(inlineBar(page), "bar-light");

check(
  (await inlineBar(page).getByRole("img", { name: /^Force-pushed/u }).getAttribute("aria-label")) === "Force-pushed 2 times, last 3 hours ago",
  "the toolbar counts the force pushes",
);
const diffSwitch = inlineBar(page).getByRole("group", { name: "What Files changed shows" });
await diffSwitch.getByRole("button", { name: "Versions", exact: true }).click();
check(
  (await diffSwitch.getByRole("button", { name: "Versions", exact: true }).getAttribute("aria-pressed")) === "true",
  "the diff switch shows the versions view as what Files changed shows",
);
const versions = page.locator("flohub-versions .surface");
await versions.locator("details.file").first().waitFor();
check(
  (await pickerValue(versions, "From")) === "1" && (await pickerValue(versions, "To")) === "3",
  "versions default to the viewer's last reviewed version → current",
);
await versions.locator('.viewed-box[aria-checked="true"]').waitFor();
// Up to the current version, each file header has GitHub's Viewed box, and the files the viewer viewed start folded.
const viewedBox = (path: string) => versions.locator("details.file", { hasText: path }).locator(".viewed-box");
const readmeFile = versions.locator("details.file", { hasText: "README.md" });
check(
  (await viewedBox("README.md").getAttribute("aria-checked")) === "true" &&
    !(await readmeFile.evaluate((file) => (file as HTMLDetailsElement).open)) &&
    (await versions.locator('nav.files button.file[data-viewed="VIEWED"]').innerText()).startsWith("README.md"),
  "a file marked Viewed has its box ticked, starts folded and is dimmed in the tree",
);
check(
  (await viewedBox("cmd/rebase.go").getAttribute("data-state")) === "DISMISSED" &&
    (await viewedBox("cmd/legacy.go").isHidden()),
  "a file that changed since it was viewed is marked as such, and one the pull request no longer changes has no box",
);
const fileRows = (await versions.locator("details.file > summary").allInnerTexts()).map((row) => visibleText(row));
check(
  JSON.stringify(fileRows) ===
    JSON.stringify([
      "cmd/adopt_test.go New file +3 View file at v3",
      "cmd/legacy.go No longer changed +1 −1 View file at v1",
      "cmd/rebase.go Changed +2 −1 View file at v3 Viewed",
      "README.md Changed +1 −1 View file at v3 Viewed",
    ]),
  `interdiff lists files whose change differs, ignoring moved hunks, folders first: ${JSON.stringify(fileRows)}`,
);
const treeRows = await versions
  .locator("nav.files button")
  .evaluateAll((buttons) => buttons.map((row) => [...row.querySelectorAll(":scope > .name, :scope > .counts > span")].map((part) => part.textContent).join(" ")));
check(
  JSON.stringify(treeRows) === JSON.stringify(["cmd", "adopt_test.go +3", "legacy.go +1 −1", "rebase.go +2 −1", "README.md +1 −1"]),
  `the file tree lists the compared files by folder with their version-diff totals: ${JSON.stringify(treeRows)}`,
);
const readmeRow = versions.locator("nav.files button.file", { hasText: "README.md" });
await readmeRow.click();
await page.waitForFunction(() => {
  const root = document.querySelector("flohub-versions")?.shadowRoot;
  const scroller = root?.querySelector("main")?.getBoundingClientRect();
  const target = [...(root?.querySelectorAll("details.file") ?? [])].find((file) => file.textContent.includes("README.md"));
  const top = target?.getBoundingClientRect().top;
  return scroller !== undefined && top !== undefined && top >= scroller.top - 1 && top < scroller.bottom;
});
check(
  (await readmeRow.getAttribute("aria-current")) === "location" &&
    (await page.evaluate(() => {
      const active = document.querySelector("flohub-versions")?.shadowRoot?.activeElement;
      return active?.localName === "summary" && active.textContent.includes("README.md");
    })),
  "a file tree row scrolls to its file, moves focus there and marks the row",
);
const rebaseFile = versions.locator("details.file", { hasText: "cmd/rebase.go" });
check(
  (await rebaseFile.locator(".line[data-outer='+'] .word").allInnerTexts()).join("|") === ", equivalent",
  "a line that replaced a similar one highlights only the words that differ",
);
check(
  (await rebaseFile.locator(".line[data-outer='+'] .num").allInnerTexts()).join(",") === ",43,,44",
  "lines are numbered as the version they come from numbers them",
);
const viewport = page.viewportSize();
await page.setViewportSize({ width: 1280, height: 400 });
const viewScroll = await versions.evaluate((surface) => ({ client: surface.clientHeight, scroll: surface.scrollHeight }));
check(
  viewScroll.scroll === viewScroll.client,
  `only the diff and the file tree scroll, never the view around them: ${JSON.stringify(viewScroll)}`,
);
if (viewport) await page.setViewportSize(viewport);
check(
  (await versions.locator("details.unchanged > summary").innerText()).startsWith("1 file makes the same change"),
  "docs/same.md, whose hunk only moved, counts as unchanged",
);
await page.waitForTimeout(250);
await page.screenshot({ path: `${SCREENSHOTS}/versions-light.png` });
await readmeShot(versions, "versions-light");
const readmeLines = await readmeFile.locator(".line").count();
await readmeFile.locator(".expander").first().click();
check(
  (await readmeFile.locator(".line").count()) > readmeLines,
  "expanding a gap shows the unchanged lines around a change",
);
check(
  (await versions.locator('[data-picker="From"] [role="option"][data-value="3"]').getAttribute("aria-disabled")) === "true",
  "From doesn't offer the version To shows, so the two sides can't be the same",
);
const rebaseOpen = async () => rebaseFile.evaluate((file) => (file as HTMLDetailsElement).open);
await page.keyboard.press("f");
await page.locator("flohub-toast").getByText("File not viewed yet 1 of 1.").waitFor();
check(
  await rebaseFile.evaluate((file) => Math.abs(file.getBoundingClientRect().top - file.closest("main")!.getBoundingClientRect().top) <= 2),
  "F in the versions view goes to the next file not marked Viewed",
);
await page.keyboard.press("Shift+F");
await page.locator("flohub-toast").getByText("Marked cmd/rebase.go as viewed. Every file in this diff is marked as viewed.").waitFor();
await viewedBox("cmd/rebase.go").and(versions.locator('[aria-checked="true"]')).waitFor();
check(
  fixture.viewedMarks.join(",") === "mark:cmd/rebase.go" && !(await rebaseOpen()),
  `⇧F in the versions view marks the file in view through GitHub's mark and folds it: ${fixture.viewedMarks.join(",")}`,
);
await viewedBox("cmd/rebase.go").click();
await viewedBox("cmd/rebase.go").and(versions.locator('[aria-checked="false"]')).waitFor();
check(
  fixture.viewedMarks.join(",") === "mark:cmd/rebase.go,unmark:cmd/rebase.go" && (await rebaseOpen()),
  `the Viewed box unmarks the file and opens it again, without the header's click folding it: ${fixture.viewedMarks.join(",")}`,
);
// With GitHub's React diff on the page, the box presses the file's own Viewed button, which flips only later.
await page.evaluate(() => {
  const header = document.querySelector('.file-header[data-path="README.md"]');
  const button = document.createElement("button");
  button.type = "button";
  button.className = "readme-viewed";
  const render = (pressed: boolean) => {
    button.setAttribute("aria-pressed", String(pressed));
    button.setAttribute("aria-label", pressed ? "Viewed" : "Not Viewed");
  };
  render(true);
  button.addEventListener("click", () => setTimeout(() => render(button.getAttribute("aria-pressed") !== "true"), 1000));
  header?.append(button);
});
await viewedBox("README.md").click();
const whileFlipping = await viewedBox("README.md").getAttribute("aria-checked");
await page.locator('.readme-viewed[aria-pressed="false"]').waitFor();
await page.waitForTimeout(200);
check(
  whileFlipping === "false" && (await viewedBox("README.md").getAttribute("aria-checked")) === "false" && fixture.viewedMarks.length === 2,
  `the Viewed box presses GitHub's own Viewed button instead of calling the API, and shows the new mark while GitHub catches up: ${whileFlipping}`,
);
await viewedBox("README.md").click();
await page.locator('.readme-viewed[aria-pressed="true"]').waitFor();
await viewedBox("README.md").and(versions.locator('[aria-checked="true"]')).waitFor();
await page.evaluate(() => document.querySelector(".readme-viewed")?.remove());
// The checks of GitHub's own file tree further on start from the fixture's marks.
fixture.viewedMarks.length = 0;
fixture.viewed["cmd/rebase.go"] = "DISMISSED";
await pickIn(versions, "From", "1");
await pickIn(versions, "To", "2");
await versions.locator("details.file").first().waitFor();
check(
  (await versions.locator(".viewed-box").count()) === 0,
  "ending at an older version, the versions view shows no Viewed boxes, as GitHub keeps the marks for the current version",
);
await page.keyboard.press("f");
await page.locator("flohub-toast").getByText("GitHub keeps the Viewed marks for the current version only.", { exact: false }).waitFor();
check(true, "F says why it has nothing to go to while the view ends at an older version");
const versionsParam = async () => page.evaluate(() => new URL(location.href).searchParams.get("flohub-versions"));
check((await versionsParam()) === "aaaaaaa..bbbbbbb", `the URL keeps the range on screen: ${await versionsParam()}`);
check(
  (await page.locator("flohub-versions").getAttribute("data-mode")) === "floating",
  "on GitHub's classic Files changed page the versions view floats over the diff",
);
await versions.locator('[data-picker="To"] > button').focus();
await page.keyboard.press("Escape");
check(await versions.isHidden(), "Escape inside the versions view closes it");
check((await versionsParam()) === null, "closing the versions view takes the range off the URL");
await diffSwitch.getByRole("button", { name: "Versions", exact: true }).click();
await versions.locator("details.file").first().waitFor();
const pickedRange = async () => `${await pickerValue(versions, "From")}→${await pickerValue(versions, "To")}`;
check((await pickedRange()) === "1→2", `reopening the versions view keeps the range picked: ${await pickedRange()}`);
await versions.getByRole("button", { name: "Close" }).click();
check(await versions.isHidden(), "Close closes the versions view");

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
await page.keyboard.press("Escape");
check(
  !(await removedMarker.locator(".panel").evaluate((panel) => panel.matches(":popover-open"))),
  "Escape closes the list of lines that are gone",
);
await readmeDiff.locator(`#${readmeAnchor}R324`).scrollIntoViewIfNeeded();
await page.waitForTimeout(150);
await readmeDiff.screenshot({ path: `${SCREENSHOTS}/since-review-light.png` });
await readmeShot(readmeDiff, "since-review-light");
const sinceReview = diffSwitch.getByRole("button", { name: /^Since v1/u });
check(
  (await sinceReview.getAttribute("aria-pressed")) === "true" &&
    (await sinceReview.getAttribute("data-tip")) === "3 files changed since your review (v1), highlighted in GitHub's diff",
  "the diff switch says what changed since the review, and that it is highlighted",
);
await inlineBar(page).getByLabel("1 file is no longer changed").click();
check(
  (await inlineBar(page).locator(".dropped li").allInnerTexts()).join(",") === "cmd/legacy.go",
  "the files the pull request no longer changes are listed on demand, reachable by keyboard",
);
await diffSwitch.getByRole("button", { name: "GitHub's diff" }).click();
await page.waitForFunction(() => document.querySelectorAll("[data-flohub-since], flohub-removed, flohub-since-badge").length === 0);
check(true, "GitHub's diff takes every highlight off the diff");
await sinceReview.click();
await changedCell.first().waitFor();
check(true, "Since v1 puts the highlights back");
const comparesBeforeReload = fixture.compareLog.length;
await page.reload();
await changedCell.first().waitFor();
check(
  fixture.compareLog.length === comparesBeforeReload,
  `a reload takes the highlights from storage, without comparing again: ${fixture.compareLog.length - comparesBeforeReload} new compares`,
);
await diffSwitch.getByRole("button", { name: "Versions", exact: true }).click();
await versions.locator("details.file").first().waitFor();
check(
  (await pickedRange()) === "1→2" && fixture.compareLog.length === comparesBeforeReload,
  `after a reload the versions view opens on the range picked last, without comparing again: ${await pickedRange()}, ${fixture.compareLog.length - comparesBeforeReload} new compares`,
);
const storedVersions = await (light.serviceWorkers()[0] ?? (await light.waitForEvent("serviceworker"))).evaluate(async () => {
  const local = await chrome.storage.local.get(["versionPatchIndex", "versionHistories", "versionRanges"]);
  const ranges = local.versionRanges as Record<string, { from: string; to: string }> | undefined;
  return {
    patches: Object.keys((local.versionPatchIndex as object | undefined) ?? {}).length,
    histories: Object.keys((local.versionHistories as object | undefined) ?? {}),
    ranges: Object.values(ranges ?? {}).map((range) => `${range.from}→${range.to}`),
  };
});
check(
  storedVersions.patches >= 2 && storedVersions.histories.length === 1 && storedVersions.ranges.join(",") === "aaaaaaa1→bbbbbbb2",
  `the versions, their patches and the range picked are stored, so they outlast the service worker: ${JSON.stringify(storedVersions)}`,
);
await versions.getByRole("button", { name: "Close" }).click();
await page.goto(`${PULL_URL}/files?flohub-versions=aaaaaaa..`);
await versions.locator("details.file").first().waitFor();
check((await pickedRange()) === "1→3", `a link with a range opens the versions view on it, an empty newer side on the head: ${await pickedRange()}`);
await versions.getByRole("button", { name: "Close" }).click();

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
await light.route("https://github.com/flohub/react-diff/**", async (route) =>
  route.fulfill({ body: REACT_PAGE, contentType: "text/html" }),
);
const reactPage = await light.newPage();
await reactPage.goto("https://github.com/flohub/react-diff/pull/1/changes");
await reactPage.locator("[data-flohub-since]").first().waitFor();
check(
  JSON.stringify(
    await reactPage
      .locator("[data-flohub-since]")
      .evaluateAll((cells) => cells.map((cell) => `${cell.dataset.diffSide}:${cell.dataset.lineNumber}`)),
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

// GitHub's split Files changed layout: the versions view takes the place of the file tree and diff, beside the comments.
const SPLIT_PAGE = `<!doctype html><html><head><title>Split layout</title></head><body>
<header style="height:300px">The pull request's title, tabs and FloHub's bar</header>
<div id="diff-comparison-viewer-container" style="display:flex"><div style="flex:1;display:flex;flex-wrap:wrap">
<section style="position:sticky;top:0;flex:1 1 100%;height:60px">Toolbar</section>
<div id="github-pane" style="position:sticky;top:60px;width:300px"><div data-component="SplitPageLayout.Pane">GitHub's file tree</div></div>
<div id="github-diff" data-component="SplitPageLayout.Content" style="flex:1;height:3000px">GitHub's diff</div>
</div><aside id="docked-side-panel-content" style="width:320px"><textarea aria-label="Reply"></textarea>
<div id="panelpullrequestreview-1"><h2><a id="outdated-link" href="/flohub/split-diff/pull/1/changes/aaaaaaa1?new_files_changed=true#r888">README.md</a></h2>
<div class="markdown-body"><p>Is this still true? See <a id="text-link" href="/flohub/split-diff/pull/1/changes#r777">the newer one</a>.</p></div></div>
<div id="panelpullrequestreview-2"><h2><a id="current-link" href="/flohub/split-diff/pull/1/changes#r777">README.md</a></h2></div>
</aside></div></body></html>`;
await light.route("https://github.com/flohub/split-diff/**", async (route) => route.fulfill({ body: SPLIT_PAGE, contentType: "text/html" }));
const splitPage = await light.newPage();
await splitPage.goto("https://github.com/flohub/split-diff/pull/1/changes?flohub-versions=");
const docked = splitPage.locator("flohub-versions");
await docked.locator("details.file").first().waitFor();
check(
  (await docked.locator(".hint", { hasText: "are on different bases" }).count()) === 1,
  "versions on different bases say they're compared patch by patch, and won't match GitHub's diff of the two commits",
);
const dockedLayout = await splitPage.evaluate(() => {
  const host = document.querySelector<HTMLElement>("flohub-versions");
  const box = host?.getBoundingClientRect();
  return {
    mode: host?.dataset.mode,
    top: host && getComputedStyle(host).top,
    fits: box !== undefined && Math.round(box.top) === 60 && box.bottom <= innerHeight,
    box: box && [Math.round(box.top), Math.round(box.bottom), innerHeight, Math.round(scrollY)],
    hidden: ["github-pane", "github-diff"].map((id) => getComputedStyle(document.getElementById(id)!).display),
  };
});
check(
  dockedLayout.mode === "docked" && dockedLayout.top === "60px" && dockedLayout.hidden.join(",") === "none,none" && dockedLayout.fits,
  `on GitHub's split layout the versions view takes the place of the file tree and diff, scrolled to fit under the toolbar: ${JSON.stringify(dockedLayout)}`,
);
const threadRows = docked.locator(".thread-row");
await openViewed(docked);
await threadRows.nth(1).waitFor();
const placedThreads = await threadRows.evaluateAll((blocks) =>
  blocks.map((block) => {
    const line = block.previousElementSibling?.textContent ?? "";
    const where = line.includes("Diverged stacks") ? "Diverged stacks" : (line.includes("log(branch)") ? "log(branch)" : line);
    return `${where} → ${block.textContent.includes("Is this still true") ? "v1 thread" : "v3 thread"}`;
  }),
);
check(
  JSON.stringify(placedThreads.toSorted((a, b) => a.localeCompare(b))) === JSON.stringify(["Diverged stacks → v1 thread", "log(branch) → v3 thread"]) &&
    (await docked.locator("nav.files button.file", { hasText: "README.md" }).locator(".comment-count").innerText()) === "0/1",
  `review threads sit under their lines, by the numbers of the version each was written on, and the file tree counts the resolved ones of them: ${JSON.stringify(placedThreads)}`,
);
await threadRows.locator(".label.progress").nth(1).waitFor();
const progressLabels = await threadRows.evaluateAll((blocks) =>
  blocks.map((block) => `${block.textContent.includes("Is this still true") ? "v1" : "v3"}: ${block.querySelector(".label.progress")?.textContent ?? "none"}`),
);
check(
  progressLabels.includes("v3: Untouched since your comment") && progressLabels.some((label) => /^v1: (Code changed|Untouched) since your comment$/u.test(label)),
  `each open thread says whether its code changed since the viewer's comment, a comment on the head never: ${JSON.stringify(progressLabels)}`,
);
// A comment of several blocks reads top to bottom, as on GitHub, and its blocks aren't laid out as the view's own.
const commentBlocks = await threadRows.filter({ hasText: "Is this still true" }).locator(".comment-body > *").evaluateAll((blocks) =>
  blocks.map((block) => Math.round(block.getBoundingClientRect().top)),
);
check(
  commentBlocks.length === 4 && commentBlocks.every((top, index) => index === 0 || top > commentBlocks[index - 1]!),
  `a comment's paragraphs and folded sections stack, one under the other: ${JSON.stringify(commentBlocks)}`,
);
const otherRow = docked.locator("details.file", { hasText: "cmd/rebase.go" }).locator(".other-threads button", { hasText: "Was logging here before?" });
check(
  (await otherRow.innerText()).includes("Changes since v2"),
  "a thread written on a version the diff doesn't show is listed at the top of its file, with where to see it",
);
await otherRow.click();
// The fixture's v2 has the head's files, so the thread's file makes the same change in both: the view says so.
await docked.locator(".notice", { hasText: "makes the same change in both versions" }).waitFor();
check(
  (await pickerValue(docked, "From")) === "2" && (await pickerValue(docked, "To")) === "3",
  "its row opens how the code changed since that version",
);
await pickIn(docked, "From", "1");
await docked.locator("details.unchanged").evaluate((details) => {
  (details as HTMLDetailsElement).open = true;
});
const unchangedRow = docked.locator("details.unchanged .other-threads button", { hasText: "Say which rebases." });
check((await unchangedRow.innerText()).includes("Code at v1"), "a thread on a file that makes the same change in both versions is listed under it");
await unchangedRow.click();
await docked.locator(".line.target").waitFor();
check(
  (await pickerValue(docked, "From")) === "0" &&
    (await pickerValue(docked, "To")) === "1" &&
    (await docked.locator(".line.target").innerText()).includes("Adopts server rebases."),
  "its row opens the code as the thread saw it, at its line",
);
await pickIn(docked, "To", "3");
await docked.locator(".timeline li").nth(2).locator("button").click();
check(
  (await pickerValue(docked, "From")) === "2" && (await pickerValue(docked, "To")) === "3",
  "a version picked on the timeline inside the range becomes the older side",
);
await pickIn(docked, "From", "1");
check(
  (await docked.locator(".version-pick .pick-words").first().textContent()) === "v1 your review",
  "the From picker names the version in a few words, marking the viewer's review",
);
const optionsOutOfOrder = async (name: string) =>
  docked.locator(`[data-picker="${name}"] [role="option"][aria-disabled="true"]`).evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset.value).join(","));
check(
  (await optionsOutOfOrder("To")) === "1" && (await optionsOutOfOrder("From")) === "3",
  `neither picker offers a version that would put the newer side before the older: To ${await optionsOutOfOrder("To")}, From ${await optionsOutOfOrder("From")}`,
);
await docked.locator('[data-picker="To"] > button').focus();
await splitPage.keyboard.press("ArrowDown");
await splitPage.keyboard.press("ArrowDown");
await splitPage.keyboard.press("Enter");
check(
  (await pickerValue(docked, "To")) === "2" && (await docked.locator('[data-picker="To"] [role="listbox"]').isHidden()),
  "the To picker opens with the down arrow, moves with the arrows and picks with Enter",
);
await pickIn(docked, "To", "3");
const reviewedSlots = async () =>
  docked.locator(".timeline li.reviewed").evaluateAll((items) =>
    items.map((item) => [...item.querySelectorAll(".verdict-mark")].map((badge) => (badge as HTMLElement).dataset.tone).join("+")),
  );
check(
  JSON.stringify(await reviewedSlots()) === JSON.stringify(["muted+attention", "attention", "success"]),
  `the timeline draws each reviewed version's reviewers with their verdicts: ${JSON.stringify(await reviewedSlots())}`,
);
await pickIn(docked, "Reviews", "mojombo");
check(
  JSON.stringify(await reviewedSlots()) === JSON.stringify(["attention", "success"]),
  `following one reviewer leaves only their reviews on the timeline, so their verdict's path shows: ${JSON.stringify(await reviewedSlots())}`,
);
const unseenButton = docked.locator(".tool.unseen");
check(await unseenButton.isHidden(), "a reviewer whose verdict is on the head has nothing they haven't seen");
await pickIn(docked, "From", "2");
await pickIn(docked, "Reviews", "defunkt");
await unseenButton.waitFor();
const unseenText = await unseenButton.textContent();
await unseenButton.click();
await docked.locator('[data-picker="From"] > button[data-value="1"]').waitFor();
check(
  unseenText === "What defunkt hasn't seen" && (await pickerValue(docked, "To")) === "3" && (await unseenButton.isHidden()),
  `following a reviewer offers what they haven't seen since their verdict, and picks it: ${unseenText}`,
);
await pickIn(docked, "Reviews", "");
await openViewed(docked);
await docked.locator(".thread-row").nth(1).waitFor();
await docked.getByLabel("Comments").uncheck();
check(await threadRows.first().isHidden(), "the Comments toggle hides the threads");
await docked.getByLabel("Comments").check();
await docked.getByLabel("Split view").check();
await openViewed(docked);
const changedPair = docked.locator("details.file", { hasText: "README.md" }).locator(".line.split", { hasText: "Sync adopts server rebases." });
await changedPair.waitFor();
check(
  (await changedPair.locator(".cell.left").innerText()).includes("Sync adopts server rebases.") &&
    (await changedPair.locator(".cell.right").innerText()).includes("If GitHub already rebased") &&
    (await docked.locator(".thread-row").count()) === 2,
  "side by side, a line that changed between the versions sits beside its replacement, and the threads stay at their lines",
);
const threadColumns = await docked.locator(".thread-row").evaluateAll((blocks) =>
  blocks.map((block) => {
    const older = block.classList.contains("column-older");
    const code = block.previousElementSibling?.querySelector(older ? ".cell.left .code" : ".cell.right .code");
    const offset = Math.abs((block.querySelector(".thread")?.getBoundingClientRect().left ?? 0) - (code?.getBoundingClientRect().left ?? -99));
    return `${block.textContent.includes("Is this still true") ? "v1" : "v3"} ${older ? "left" : "right"}${offset <= 2 ? "" : ` off by ${Math.round(offset)}px`}`;
  }),
);
check(
  JSON.stringify(threadColumns.toSorted((a, b) => a.localeCompare(b))) === JSON.stringify(["v1 left", "v3 right"]),
  `side by side, a thread sits in its version's column, lined up with its code: ${JSON.stringify(threadColumns)}`,
);
check(
  await (light.serviceWorkers()[0] ?? (await light.waitForEvent("serviceworker"))).evaluate(async () => {
    const layout = await chrome.storage.local.get("versionsSplitView");
    return layout.versionsSplitView === true;
  }),
  "the layout is remembered",
);
await docked.getByLabel("Split view").uncheck();
await openViewed(docked);
await docked.locator("details.file", { hasText: "README.md" }).locator(".line:not(.split)", { hasText: "Sync adopts server rebases." }).waitFor();

// ] and [ step through the unresolved threads the view shows, starting over past the last.
await splitPage.evaluate(() => (document.querySelector("flohub-versions")?.shadowRoot?.activeElement as HTMLElement | null)?.blur());
const focusedThread = async () =>
  splitPage.evaluate(() => (document.querySelector("flohub-versions")?.shadowRoot?.activeElement?.closest(".thread-row") as HTMLElement | null)?.dataset.thread ?? "");
const steps: string[] = [];
for (const key of ["]", "]", "]", "["]) {
  const before = await focusedThread();
  await splitPage.keyboard.press(key);
  await splitPage.waitForFunction(
    (previous) => ((document.querySelector("flohub-versions")?.shadowRoot?.activeElement?.closest(".thread-row") as HTMLElement | null)?.dataset.thread ?? "") !== previous,
    before,
  );
  steps.push(await focusedThread());
}
const stepToast = (await splitPage.locator("flohub-toast").getByText(/nresolved thread/u).innerText()).trim();
check(
  steps[0] !== steps[1] && steps[2] === steps[0] && steps[3] === steps[1] && /^(Unresolved thread|Back to the (first|last) unresolved thread,) [12] of 2\.$/u.test(stepToast),
  `] and [ step through the versions view's two unresolved threads, focusing each and starting over past the end: ${JSON.stringify(steps)}, "${stepToast}"`,
);

// Commenting from the view, on v3, the head; the fixture records what would go to GitHub.
const rebaseRow = (code: string) => docked.locator("details.file", { hasText: "cmd/rebase.go" }).locator(".line", { hasText: code });
const addOn = async (code: string, shift = false) => {
  await rebaseRow(code).hover();
  await rebaseRow(code).locator(".add-comment").click({ modifiers: shift ? ["Shift"] : [] });
};
const composer = docked.locator(".composer-row");
const lastAction = () => fixture.reviewActions.at(-1) ?? "";
await addOn("log(branch)");
await composer.getByRole("textbox").fill("Please log at debug level.");
await composer.getByRole("button", { name: "Add single comment" }).click();
await composer.waitFor({ state: "detached" });
check(
  lastAction() === 'POST pulls/1/comments {"body":"Please log at debug level.","commit_id":"ccccccc3","path":"cmd/rebase.go","line":44,"side":"RIGHT"}',
  `a single comment goes out on the head's line, as GitHub's diff numbers it: ${lastAction()}`,
);
fixture.threadsHead = "ddddddd4";
const sentBefore = fixture.reviewActions.length;
await addOn("log(branch)");
await composer.getByRole("textbox").fill("Is this still needed?");
await composer.getByRole("button", { name: "Add single comment" }).click();
await composer.locator(".problem", { hasText: "The author pushed since" }).waitFor();
check(
  fixture.reviewActions.length === sentBefore && (await composer.getByRole("textbox").inputValue()) === "Is this still needed?",
  "a comment on a head the author has pushed over is refused, and keeps its text",
);
await composer.getByRole("button", { name: "Cancel" }).click();
fixture.threadsHead = "ccccccc3";
await addOn("adopt(branch, equivalent)");
await addOn("log(branch)", true);
check((await composer.locator(".title").innerText()).startsWith("Comment on lines 43–44"), "shift-click stretches the comment over the lines between");
await composer.getByRole("textbox").fill("These two belong together.");
await composer.getByRole("button", { name: "Start a review" }).click();
await composer.waitFor({ state: "detached" });
check(
  fixture.reviewActions.slice(-2).join(" | ") ===
    'addPullRequestReview {"pull":"PR_split","commit":"ccccccc3"} | addPullRequestReviewThread {"review":"PRR_new","path":"cmd/rebase.go","body":"These two belong together.","line":44,"side":"RIGHT","startLine":43,"startSide":"RIGHT"}',
  `Start a review starts a pending review on the head and adds the comment to it: ${fixture.reviewActions.slice(-2).join(" | ")}`,
);
const readmeThread = docked.locator(".thread-row", { hasText: "Is this still true" });
await readmeThread.getByRole("button", { name: "Write a reply" }).click();
await readmeThread.getByRole("textbox").fill("Yes, still true.");
await readmeThread.locator(".box").getByRole("button", { name: "Reply" }).click();
await readmeThread.locator(".box").waitFor({ state: "detached" });
check(lastAction() === 'POST pulls/1/comments/1/replies {"body":"Yes, still true."}', `a reply goes out at once without a pending review: ${lastAction()}`);
fixture.pendingReview = { commit: "ccccccc3" };
await readmeThread.getByRole("button", { name: "Resolve comment" }).click();
for (let tries = 0; tries < 50 && !lastAction().startsWith("resolveReviewThread"); tries++) await splitPage.waitForTimeout(100);
check(lastAction() === 'resolveReviewThread {"id":"PRRT_1"}', `Resolve comment resolves the thread: ${lastAction()}`);
await addOn("log(branch)");
check(
  JSON.stringify(await composer.getByRole("button").allInnerTexts()) === JSON.stringify(["Cancel", "Add review comment"]),
  "with a pending review on the head, a new comment can only join it",
);
await composer.getByRole("textbox").fill("Part of my review.");
await composer.getByRole("button", { name: "Add review comment" }).click();
await composer.waitFor({ state: "detached" });
check(
  lastAction().startsWith('addPullRequestReviewThread {"review":"PRR_pending","path":"cmd/rebase.go","body":"Part of my review.","line":44'),
  `Add review comment adds to the pending review: ${lastAction()}`,
);
fixture.pendingReview = { commit: "aaaaaaa1" };
await readmeThread.getByRole("button", { name: "Write a reply" }).click();
await readmeThread.getByRole("textbox").fill("Noted.");
await readmeThread.locator(".box").getByRole("button", { name: "Add review comment" }).click();
await readmeThread.locator(".box").waitFor({ state: "detached" });
await addOn("log(branch)");
check(
  (await composer.locator(".problem").innerText()).includes("Your pending review is on an older version") &&
    JSON.stringify(await composer.getByRole("button").allInnerTexts()) === JSON.stringify(["Cancel"]),
  "a pending review on an older version has to be submitted before commenting on the head",
);
await composer.getByRole("button", { name: "Cancel" }).click();
fixture.pendingReview = null;
await splitPage.getByLabel("Reply").fill("Looks good now");
check((await splitPage.getByLabel("Reply").inputValue()) === "Looks good now", "the comments beside the docked view stay usable");
const jumpLink = splitPage.locator("#outdated-link");
await jumpLink.click();
const jumpMenu = splitPage.locator("flohub-jump-menu");
await jumpMenu.getByRole("menuitem", { name: /^Changes since v1/u }).waitFor();
await readmeShot(jumpMenu.getByRole("menu"), "jump-menu-light");
check(
  !splitPage.url().includes("#r888") &&
    (await jumpMenu.getByRole("menuitem", { name: /^In the current diff/u }).isDisabled()),
  "a comment's link to its code opens FloHub's menu instead of GitHub's jump, and an outdated comment has no current lines",
);
await jumpMenu.getByRole("menuitem", { name: /^Changes since v1/u }).click();
const target = docked.locator("details.file", { hasText: "README.md" }).locator(".line.target");
await target.first().waitFor();
check(
  (await pickerValue(docked, "From")) === "1" &&
    (await pickerValue(docked, "To")) === "3" &&
    (await target.count()) === 1 &&
    (await target.innerText()).includes("Diverged stacks") &&
    (await target.evaluate((row) => {
      const box = row.getBoundingClientRect();
      const pane = row.closest("main")!.getBoundingClientRect();
      return box.top >= pane.top && box.bottom <= pane.bottom;
    })),
  "Changes since v1 compares v1 with the head and marks the commented line, found by the number v1 gave it",
);
await jumpLink.click();
await jumpMenu.getByRole("menuitem", { name: /^Code at v1/u }).waitFor();
check(
  (await jumpMenu.getByRole("menuitem", { name: /^Code at v1/u }).getAttribute("aria-keyshortcuts")) === "2",
  "each choice in the jump menu carries the number key that picks it",
);
await splitPage.keyboard.press("2");
await docked.getByText("Shows the pull request's changes as v1 made them").waitFor();
check(
  (await pickerValue(docked, "From")) === "0" &&
    (await docked.locator(".line.target").innerText()).includes("Diverged stacks") &&
    splitPage.url().includes("flohub-versions=base..aaaaaaa"),
  "the 2 key picks Code at v1, which shows v1 against the base branch, at the commented line, and the URL says so",
);
await splitPage.locator("#current-link").click();
await jumpMenu.getByRole("menuitem", { name: /^In the current diff/u }).click();
await docked.getByText("Shows the pull request's changes as v3 made them").waitFor();
check(
  (await pickerValue(docked, "From")) === "0" &&
    (await pickerValue(docked, "To")) === "3" &&
    (await docked.locator(".line.target").innerText()).includes("Diverged stacks"),
  "a current comment's In the current diff shows the head against the base branch, at the line as the head numbers it",
);
await docked.getByRole("button", { name: "Close" }).click();
check(
  (await splitPage.evaluate(() => getComputedStyle(document.getElementById("github-diff")!).display)) !== "none" &&
    !splitPage.url().includes("flohub-versions"),
  "closing the docked view shows GitHub's diff again and takes the range off the URL",
);
fixture.commentDelay = 5000;
await splitPage.evaluate(() => {
  const thread = Object.assign(document.createElement("div"), { id: "r777", textContent: "GitHub's thread" });
  thread.style.marginTop = "2500px";
  document.getElementById("github-diff")!.append(thread);
});
await splitPage.locator("#current-link").click();
await jumpMenu.getByRole("status").waitFor();
check(
  (await jumpMenu.getByRole("menuitem").count()) === 1 && (await jumpMenu.getByRole("menuitem", { name: /^In the current diff/u }).isEnabled()),
  "while the comment loads, a current comment's menu already offers In the current diff, and only that",
);
await jumpMenu.getByRole("menuitem", { name: /^In the current diff/u }).click();
check(
  await scrolledTo(splitPage, "#r777"),
  "In the current diff scrolls to GitHub's expanded thread before the comment arrives",
);
fixture.commentDelay = 0;
// A collapsed thread, a resolved one for instance, is only avatars on its line: GitHub draws no #r<comment id> for it.
await splitPage.evaluate(() => {
  document.getElementById("r777")!.remove();
  scrollTo(0, 0);
  const table = document.createElement("table");
  table.setAttribute("aria-label", "Diff for: README.md");
  table.style.marginTop = "2500px";
  table.innerHTML = '<tr><td class="diff-text-cell" data-diff-side="right" data-line-number="326">Diverged stacks</td></tr>';
  document.getElementById("github-diff")!.append(table);
});
await splitPage.locator("#current-link").click();
await jumpMenu.getByRole("menuitem", { name: /^In the current diff/u }).click();
check(
  await scrolledTo(splitPage, 'td[data-line-number="326"]'),
  "In the current diff finds a collapsed thread by its line in GitHub's diff, where GitHub draws no thread to scroll to",
);
await splitPage.locator("#text-link").click();
check(
  (await jumpMenu.count()) === 0 && splitPage.url().endsWith("#r777"),
  "a link in a comment's text stays GitHub's, even when it points at a comment",
);
fixture.threadsDelay = 1500;
await splitPage.goto("https://github.com/flohub/split-diff/pull/1/changes");
await splitPage.locator("#outdated-link").click();
await jumpMenu.getByRole("menuitem", { name: /^Changes since v1/u }).click();
await docked.locator(".line.target").waitFor();
await docked.locator(".thread-row").nth(1).waitFor();
check(
  await docked.locator(".line.target").evaluate((row) => {
    const box = row.getBoundingClientRect();
    const pane = row.closest("main")!.getBoundingClientRect();
    return box.top >= pane.top && box.bottom <= pane.bottom;
  }),
  "threads that arrive after a jump keep the commented line on screen",
);
fixture.threadsDelay = 0;
await splitPage.close();

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
  (await diffStat("README.md").innerText()).replaceAll(/\s+/gu, " ") === "+2 \u{2212}1" &&
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
  .evaluateAll((items) => items.map((item) => item.querySelector(".ActionList-item-label")?.textContent.trim()));
check(
  JSON.stringify(viewedFolders) === JSON.stringify(["docs/src/content/docs", "guides", "reference"]),
  `only folders whose files are all viewed are dimmed: ${JSON.stringify(viewedFolders)}`,
);
const urlBeforeToggle = page.url();
await viewedToggle("cmd/rebase_test.go").click();
await tree.locator('flohub-viewed[data-path="cmd/rebase_test.go"][aria-checked="true"]').waitFor();
await viewedToggle("README.md").click();
await tree.locator('flohub-viewed[data-path="README.md"][aria-checked="false"]').waitFor();
// The checkbox flips before the API call goes out, so give the call a moment to arrive.
for (let tries = 0; tries < 50 && fixture.viewedMarks.length < 2; tries++) await page.waitForTimeout(100);
check(
  fixture.viewedMarks.join(",") === "mark:cmd/rebase_test.go,unmark:README.md",
  `tree checkboxes mark and unmark files through the API: ${fixture.viewedMarks.join(",")}`,
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

// F goes to the next file not marked Viewed, ⇧F marks the one in view and goes on.
const fileAtTop = async () => {
  const id = await page.evaluate(() => {
    const files = [...document.querySelectorAll<HTMLElement>("[id^='diff-']")].filter((file) => /^diff-[\da-f]{64}$/u.test(file.id));
    return files.find((file) => Math.abs(file.getBoundingClientRect().top - 60) <= 2)?.id ?? "";
  });
  return Object.keys(CHANGED_FILES).find((path) => `diff-${createHash("sha256").update(path).digest("hex")}` === id) ?? id;
};
await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
await page.keyboard.press("f");
await page.locator("flohub-toast").getByText(/^File not viewed yet \d+ of \d+\.$/u).waitFor();
const firstUnviewed = await fileAtTop();
check(
  (await viewedToggle(firstUnviewed).getAttribute("aria-checked")) === "false",
  `F scrolls to a file not marked Viewed: ${firstUnviewed}`,
);
await page.keyboard.press("Shift+F");
await page.locator("flohub-toast").getByText(`Marked ${firstUnviewed} as viewed.`, { exact: false }).waitFor();
await tree.locator(`flohub-viewed[data-path="${firstUnviewed}"][aria-checked="true"]`).waitFor();
const nextUnviewed = await fileAtTop();
check(
  nextUnviewed !== firstUnviewed && (await viewedToggle(nextUnviewed).getAttribute("aria-checked")) === "false",
  `⇧F marks the file in view as viewed and goes to the next one not viewed: ${firstUnviewed} → ${nextUnviewed}`,
);

await inlineBar(page).getByRole("button", { name: "Stack" }).click();
check(
  (await inlineBar(page).locator(".stack-list").count()) === 0 &&
    (await inlineBar(page).locator(".stack-header .segment").count()) === STACK_PULLS.length,
  "stack collapses to a strip",
);
await inlineBar(page).screenshot({ path: `${SCREENSHOTS}/inline-collapsed-light.png` });
await page.reload();
await inlineBar(page).locator(".reviewers .faces li").first().waitFor();
check(
  (await inlineBar(page).locator(".stack-list").count()) === 0 && (await inlineBar(page).locator(".reviewers .faces li").count()) === 6,
  "collapsed stack stays collapsed after a reload, with the reviewers shrunk to their faces",
);
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
await inlineBar(page).locator(".reviewer").first().waitFor();
await page.mouse.wheel(0, 2400);
await restoreTab.waitFor();
check(await floatingBar(page).locator(".pill").isHidden(), "the floating bar stays minimized after a reload");
await restoreTab.click();
await floatingBar(page).locator(".pill").waitFor({ state: "visible" });
check(await restoreTab.isHidden(), "the edge tab restores the floating pill");

await page.mouse.wheel(0, -5000);
const rerequestsBefore = fixture.rerequests.length;
await inlineBar(page).getByRole("button", { name: "Re-request review from defunkt" }).click();
await inlineBar(page).locator(".reviewer[data-waiting]", { hasText: "defunkt" }).waitFor();
check(fixture.rerequests.slice(rerequestsBefore).join(",") === "defunkt", "re-request posts only defunkt to requested_reviewers");

await page.getByRole("link", { name: /Conversation/u }).first().click();
await page.waitForURL(/\/pull\/\d+$/u);
await inlineBar(page).getByText("Re-requested").first().waitFor();
check(await inlineBar(page).isVisible(), "bar survives in-page navigation to the Conversation tab");
const header = await page.evaluate((number) => {
  const area = document.querySelector('[data-component="TitleArea"]');
  const title = area?.querySelector("h1");
  const label = [...(area?.querySelectorAll("span") ?? [])].find(
    (span) => span.textContent.trim() === `#${number}` && !span.classList.contains("sr-only") && span.getClientRects().length > 0,
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
await cached.route("https://api.github.com/**", async (route) => cachedFixture.handle(route));
const cachedPage = await cached.newPage();
await cachedPage.goto(`${PULL_URL}/files`);
await inlineBar(cachedPage).locator(".stack-list").waitFor();
await inlineBar(cachedPage).locator(".reviewer").first().waitFor();
cachedFixture.overviewDelay = 5000;
await cachedPage.reload();
const reloadStarted = Date.now();
await inlineBar(cachedPage).locator(".stack-list").waitFor({ timeout: 3000 });
check(
  Date.now() - reloadStarted < 3000 &&
    (await inlineBar(cachedPage).locator(".reviewer").count()) === 6 &&
    (await inlineBar(cachedPage).getByRole("button", { name: "Refresh reviewers" }).getAttribute("aria-busy")) === "true",
  "a revisit shows the cached stack and reviewers at once, marked as refreshing",
);
await inlineBar(cachedPage).locator('.refresh:not([aria-busy="true"])').waitFor({ timeout: 10_000 });
check(true, "the fresh overview replaces the cached one when it arrives");

await cachedPage.goto(PULL_URL, { waitUntil: "commit" });
const longestGap = await cachedPage.evaluate(
  async () =>
    new Promise<number>((resolve) => {
      // oxlint-disable-next-line unicorn/consistent-function-scoping -- the function runs in the page, where outer scopes don't exist
      const shown = () =>
        Boolean(document.querySelector('flohub-bar[data-mode="inline"]')?.shadowRoot?.querySelector(".stack-header"));
      let firstShown = 0;
      let hiddenSince = 0;
      let longest = 0;
      const timer = setInterval(() => {
        const now = performance.now();
        if (shown()) {
          if (firstShown === 0) firstShown = now;
          if (hiddenSince !== 0) longest = Math.max(longest, now - hiddenSince);
          hiddenSince = 0;
        } else if (firstShown !== 0 && hiddenSince === 0) {
          hiddenSince = now;
        }
        if (firstShown === 0 || now - firstShown <= 3000) return;
        clearInterval(timer);
        resolve(hiddenSince === 0 ? longest : now - hiddenSince);
      }, 10);
    }),
);
check(longestGap < 150, `once shown, the cached stack stays while GitHub re-renders the header (longest gap ${Math.round(longestGap)}ms)`);

// An overview still on its way would store this layer's own entry again over the one the next check plants.
await inlineBar(cachedPage).locator('.refresh:not([aria-busy="true"])').waitFor({ timeout: 10_000 });
const [cachedWorker] = cached.serviceWorkers();
await cachedWorker?.evaluate(async (current) => {
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- the function runs in the service worker, where outer scopes don't exist
  const key = (n: number) => `github/gh-stack#${n}`;
  const saved = await chrome.storage.local.get(["overviewIndex", `overview:${key(current)}`]);
  const overview = saved[`overview:${key(current)}`] as { repository: { pullRequest: { number: number } } };
  overview.repository.pullRequest.number = 999;
  const index = { [key(999)]: { savedAt: Date.now(), repo: "github/gh-stack", members: [current, 999] } };
  await chrome.storage.local.set({ overviewIndex: index, [`overview:${key(999)}`]: overview });
}, CURRENT);
await cachedPage.reload();
await inlineBar(cachedPage).locator(".stack-list").waitFor({ timeout: 3000 });
check(
  (await inlineBar(cachedPage).locator('[aria-current="page"]').innerText()).includes(`#${CURRENT}`) &&
    (await inlineBar(cachedPage).getByText("Loading reviewers…").count()) === 1,
  "a layer without its own cache shows the stack cached from another layer, with reviewers still loading",
);
await inlineBar(cachedPage).locator(".reviewer").first().waitFor({ timeout: 10_000 });
check(true, "reviewers fill in once the fresh overview arrives");
await cachedWorker?.evaluate(async (current) => {
  // The fresh overview is stored after it reaches the page; a write still on its way would undo the edit below.
  for (let tries = 0; tries < 50; tries++) {
    const written = (await chrome.storage.local.get("overviewIndex")) as { overviewIndex?: Record<string, { savedAt: number }> };
    if (Date.now() - (written.overviewIndex?.[`github/gh-stack#${current}`]?.savedAt ?? 0) < 5000) break;
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
  }
  const { overviewIndex: index } = (await chrome.storage.local.get("overviewIndex")) as {
    overviewIndex: Record<string, { savedAt: number }>;
  };
  const own = index[`github/gh-stack#${current}`];
  const other = index["github/gh-stack#999"];
  if (own) own.savedAt = Date.now() - 10 * 3_600_000;
  if (other) other.savedAt = Date.now();
  await chrome.storage.local.set({ overviewIndex: index });
}, CURRENT);
await cachedPage.reload();
await inlineBar(cachedPage).locator(".stack-list").waitFor({ timeout: 3000 });
check(
  (await inlineBar(cachedPage).getByText("Loading reviewers…").count()) === 1,
  "a layer's own cache gives way to a later one fetched from another layer of its stack",
);
await inlineBar(cachedPage).locator(".reviewer").first().waitFor({ timeout: 10_000 });
cachedFixture.overviewDelay = 3000;
cachedFixture.overviewFailure = 502;
await cachedPage.reload();
await inlineBar(cachedPage).locator(".stack-list").waitFor({ timeout: 3000 });
await inlineBar(cachedPage).getByRole("button", { name: "Retry" }).waitFor({ timeout: 10_000 });
check(
  (await inlineBar(cachedPage).locator(".reviewer").count()) === 0,
  "when the first fresh load fails, the cached overview gives way to the error and Retry",
);
await cached.close();

for (const scheme of ["light", "dark"] as const) {
  const inboxContext = await launch(scheme, async (route) => createFixture().handle(route));
  // Tabs the extension opens skip the route, so their rows point at pull requests that do not exist and do not redirect.
  await inboxContext.route("https://github.com/octo-org/api/pull/77/files", async (route) =>
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
            heading: "Your turn6",
            rows: [
              "#77 fix(auth): refresh tokens before they expire and retry the failed request once",
              "#903 feat(ui): render the stack",
              "#901 feat(api): add the stack endpoint",
              "#130 fix(sync): keep local commits on rebase",
              "#121 feat(stack): show failing checks",
              "#120 docs: explain the stack badge",
            ],
          },
          { heading: "Their turn1", rows: ["#122 feat(stack): page through long stacks"] },
          { heading: "Reviewed by someone else0", rows: [] },
          { heading: "Drafts0", rows: [] },
          { heading: "Everything else0", rows: [] },
        ]),
      `popup sorts pull requests by whose turn it is, the reviews asked again first, a stack's layers together top first: ${JSON.stringify(sections)}`,
    );
    const categories = await popup.locator(".category").evaluateAll((headings) =>
      headings.map((heading) => {
        const list = heading.nextElementSibling?.matches(".groups") ? heading.nextElementSibling : null;
        const numbers = [...(list?.querySelectorAll(":scope .pull .number") ?? [])].map((number) => number.textContent.trim());
        return `${heading.textContent}:${numbers.join(" ")}`;
      }),
    );
    check(
      JSON.stringify(categories) ===
        JSON.stringify([
          "Re-requested1:#77",
          "New review requests2:#903 #901",
          "Replies to you0:",
          "New commits since your review1:#130",
          "Your pull requests: to fix1:#121",
          "Your pull requests: ask for a review0:",
          "Your pull requests: ready to merge1:#120",
          "Waiting for the author0:",
          "Waiting for reviewers1:#122",
        ]),
      `each section names every category, empty ones too, and each pull request sits under why it waits: ${JSON.stringify(categories)}`,
    );
    const chips = async (number: number) => (await popup.locator(".pull", { hasText: `#${number} ` }).locator(".status").allTextContents()).join(",");
    check(
      (await chips(121)) === "Checks failed" && (await chips(120)) === "Ready to merge" && (await chips(122)) === "Needs review,Waiting for defunkt",
      `own pull requests say why they wait, and for whom: ${await chips(121)} | ${await chips(120)} | ${await chips(122)}`,
    );
    check(
      (await popup.locator(".pull", { hasText: "#77" }).getByText("Re-requested").count()) === 0 &&
        (await popup.locator('.category[data-category="rerequested"] + .groups').locator(".pull", { hasText: "#77" }).count()) === 1,
      "a review request the viewer answered before goes to Re-requested, which needs no chip to say so",
    );
    const waitingFlags = await popup.locator(".pull", { hasText: "#130" }).locator(".status").allTextContents();
    check(
      waitingFlags.join(",") === "You requested changes,New commits",
      `a pull request waiting for its author shows the viewer's verdict and the author's push since: ${waitingFlags.join(",")}`,
    );
    check(
      (await popup.locator(".pull", { hasText: "#130" }).locator(".faces").getAttribute("title")) === "defunkt approved" &&
        (await popup.locator(".pull", { hasText: "#130" }).locator(".faces .verdict-mark").getAttribute("data-tone")) === "success",
      "a row shows everyone else's verdict as faces, the viewer's own left to its flag",
    );
    check(
      (await popup.locator(".pull .tag").count()) === 0,
      "no row paints a status as a badge; every one is plain tone-coloured text",
    );
    const positions = await popup.locator(".pull").evaluateAll((pulls) =>
      pulls.map((row) => row.querySelector(":scope .position [aria-hidden]")?.textContent ?? null),
    );
    check(
      JSON.stringify(positions) === JSON.stringify([null, "3/3", "1/3", null, null, null, null]) &&
        (await popup.locator(".group-label").count()) === 0,
      `stacked rows show their layer inline, with no group heading: ${JSON.stringify(positions)}`,
    );
    const diffStats = await popup.locator(".pull").evaluateAll((pulls) =>
      pulls.map((row) => {
        const stat = row.querySelector(".diffstat");
        return stat ? { shown: stat.querySelector("[aria-hidden]")?.textContent, spoken: stat.querySelector(".visually-hidden")?.textContent } : null;
      }),
    );
    check(
      JSON.stringify(diffStats[1]) === JSON.stringify({ shown: "+48\u{2212}7", spoken: "48 additions, 7 deletions" }) &&
        diffStats.filter((stat) => stat !== null).length === 1,
      `rows show the pull request's added and deleted lines, and none without lines: ${JSON.stringify(diffStats)}`,
    );
    const badge = await inboxContext.serviceWorkers()[0]?.evaluate(async () => chrome.action.getBadgeText({}));
    check(badge === "6", `the toolbar badge counts the pull requests waiting for the viewer's move: "${badge}"`);
    const longTitle = await popup.locator(".pull", { hasText: "#77" }).locator(".title").evaluate((title) => ({
      truncated: title.scrollWidth > title.clientWidth,
      tooltip: title.getAttribute("title"),
    }));
    check(
      longTitle.truncated && longTitle.tooltip === "#77 fix(auth): refresh tokens before they expire and retry the failed request once",
      `a long title truncates and keeps the full title as a tooltip: ${JSON.stringify(longTitle)}`,
    );

    const focusedRow = async () => popup.evaluate(() => document.activeElement?.querySelector(".number")?.textContent.trim() ?? null);
    check((await focusedRow()) === "#77", `the popup opens with focus on the first row: ${await focusedRow()}`);
    const visited: (string | null)[] = [];
    for (const key of ["ArrowDown", "j", "j", "k", "End", "ArrowUp", "Home", "ArrowUp"]) {
      await popup.keyboard.press(key);
      visited.push(await focusedRow());
    }
    check(
      visited.join(",") === "#903,#901,#130,#901,#122,#120,#77,#77",
      `arrow keys and j/k move through all sections, Home and End jump to the ends: ${visited.join(",")}`,
    );
    const tabStops = await popup.locator('.pull[tabindex="0"]').count();
    check(tabStops === 1, `the list holds a single tab stop: ${tabStops}`);
    await popup.keyboard.press("Shift+Tab");
    await popup.keyboard.press("ArrowDown");
    check((await focusedRow()) === "#77", "the arrow down steps from the header back into the list");

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
      background.url() === "https://github.com/github/gh-stack/pull/120" && !popup.isClosed(),
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
    // eslint-disable-next-line unicorn/prefer-await -- the press rejects once the popup closes, while waitForEvent waits for that close
    await Promise.all([launcher.waitForEvent("close"), launcher.keyboard.press("Enter").catch(() => undefined)]);
    check(
      inboxContext.pages().length === pagesBefore - 1 && inboxContext.pages().filter((tab) => tab.url().includes("/pull/77")).length === 1,
      "Enter switches to a tab that already shows the pull request and closes the popup",
    );
    await existing.close();

    await popup.getByRole("button", { name: /^Everything else/u }).click();
    await popup.getByRole("button", { name: /^Load every open pull request in /u }).click();
    await popup.locator(".pull", { hasText: "#140 " }).waitFor();
    check(
      (await popup.locator(".pull", { hasText: "#122 " }).count()) === 1 &&
        (await popup.locator(".layer", { hasText: "#140 " }).locator(".row-tools").count()) === 0 &&
        (await popup.locator(".everything-note", { hasText: /^Loaded /u }).count()) === 1,
      "Everything else loads every open pull request on request, once each, without pin and snooze for the loaded ones",
    );
    await popup.getByRole("button", { name: /^Everything else/u }).click();
    const rowOf = (number: number) => popup.locator(".layer", { hasText: `#${number} ` });
    const titles = async () => popup.locator(".pull .number").allTextContents();
    await rowOf(120).hover();
    await rowOf(120).getByRole("button", { name: "Pin to the top" }).click();
    await rowOf(120).locator(".pin-mark").waitFor();
    const pinnedOrder = await titles();
    const storedMarks = await inboxContext.serviceWorkers()[0]?.evaluate(async () => (await chrome.storage.local.get("inboxMarks")).inboxMarks);
    check(
      (await popup.locator('.category[data-category="merge"] + .groups .pull .number').first().textContent())?.trim() === "#120" &&
        JSON.stringify(storedMarks).includes("/pull/120"),
      `a pinned pull request sorts first in its category, and the pin is stored: ${pinnedOrder.join(",")}`,
    );
    await rowOf(121).locator(".pull").focus();
    await popup.keyboard.press("s");
    await rowOf(121).getByRole("menuitem", { name: "For an hour" }).waitFor();
    check(
      (await popup.evaluate(() => document.activeElement?.textContent)) === "For an hour",
      "s opens the focused row's snooze menu, on its first choice",
    );
    await popup.keyboard.press("Enter");
    await rowOf(121).waitFor({ state: "detached" });
    const snoozedToggle = popup.getByRole("button", { name: "Show 1 snoozed" });
    check(
      (await snoozedToggle.count()) === 1 && (await popup.getByRole("button", { name: /^Your turn/u }).textContent()) === "Your turn5",
      "a snoozed pull request leaves its section, which counts it out and offers to show it",
    );
    let snoozedBadge = "";
    for (let tries = 0; tries < 50 && snoozedBadge !== "5"; tries++) {
      await popup.waitForTimeout(100);
      snoozedBadge = (await badgeText(inboxContext)) ?? "";
    }
    check(snoozedBadge === "5", `the badge leaves a snoozed pull request out: "${snoozedBadge}"`);
    await snoozedToggle.click();
    await rowOf(121).getByText("Snoozed", { exact: true }).waitFor();
    await rowOf(121).hover();
    await popup.screenshot({ path: `${SCREENSHOTS}/popup-marks-${scheme}.png` });
    await rowOf(121).getByRole("button", { name: "Wake: show it again" }).click();
    await popup.getByRole("button", { name: /snoozed$/u }).waitFor({ state: "detached" });
    check((await rowOf(121).locator(".status", { hasText: "Snoozed" }).count()) === 0, "waking a snoozed pull request puts it back");

    const reviewToggle = popup.getByRole("button", { name: /^Your turn/u });
    await reviewToggle.click();
    check(
      (await reviewToggle.getAttribute("aria-expanded")) === "false" &&
        (await popup.locator(".pull").count()) === 1 &&
        (await popup.evaluate(() => document.activeElement?.id)) === "section-you",
      "a section heading collapses its rows and keeps focus",
    );
    await popup.reload();
    await popup.getByText("feat(stack): page through long stacks").waitFor();
    check(
      (await reviewToggle.getAttribute("aria-expanded")) === "false" && (await popup.locator(".pull", { hasText: "#903" }).count()) === 0,
      "a collapsed section stays collapsed the next time the popup opens",
    );
    await reviewToggle.press("Enter");
    await popup.locator(".pull", { hasText: "#903" }).waitFor();
    check((await reviewToggle.getAttribute("aria-expanded")) === "true", "Enter on a collapsed heading expands it again");
    await popup.mouse.move(0, 0);
    await popup.keyboard.press("Home");
  }
  await popup.waitForFunction(() => [...document.images].every((image) => image.complete));
  await popup.screenshot({ path: `${SCREENSHOTS}/popup-${scheme}.png`, fullPage: true });
  await popup.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await readmeShot(popup.locator("#app"), `inbox-${scheme}`);
  await inboxContext.serviceWorkers()[0]?.evaluate(async () => chrome.storage.local.remove("token"));
  await popup.reload();
  await popup.getByRole("button", { name: "Set up token" }).waitFor();
  check(
    (await badgeText(inboxContext)) === "" && (await popup.evaluate(() => document.activeElement?.textContent)) === "Set up token",
    `without a token the popup asks for one, focuses the button and the badge clears (${scheme})`,
  );
  await inboxContext.close();
}

for (const scheme of ["light", "dark"] as const) {
  const { promise: gate, resolve: release } = Promise.withResolvers<null>();
  const emptyContext = await launch(scheme, async (route) => createFixture({ inbox: EMPTY_INBOX, inboxGate: gate }).handle(route));
  const popupId = new URL(emptyContext.serviceWorkers()[0]?.url() ?? "").host;
  const popup = await emptyContext.newPage();
  await popup.setViewportSize({ width: 504, height: 600 });
  await popup.goto(`chrome-extension://${popupId}/popup.html`);
  await popup.locator(".skeleton").waitFor();
  check((await popup.locator("main").getAttribute("aria-busy")) === "true", `the first open shows a busy skeleton (${scheme})`);
  if (scheme === "light") await popup.screenshot({ path: `${SCREENSHOTS}/popup-loading-light.png`, fullPage: true });
  release(null);
  await popup.getByText("Nothing to review").waitFor();
  check(
    (await popup.locator("section").count()) === 0 && (await popup.locator("main").getAttribute("aria-busy")) === "false",
    `an empty inbox shows one combined empty state (${scheme})`,
  );
  await popup.screenshot({ path: `${SCREENSHOTS}/popup-empty-${scheme}.png`, fullPage: true });
  if (scheme === "light") {
    // The popup closes while the key is still being pressed.
    // eslint-disable-next-line unicorn/prefer-await -- the press rejects once the popup closes, while waitForEvent waits for that close
    await Promise.all([popup.waitForEvent("close"), popup.keyboard.press("Escape").catch(() => undefined)]);
    check(true, "Escape closes the popup");
  }
  await emptyContext.close();
}

// A repository's pull request list, as a signed-in viewer sees it: FloHub's views go below the sidebar's own lists,
// and one that's open stands in for GitHub's list.
const PULLS_PAGE = `<!doctype html><html><head><title>Pull requests</title></head><body>
<nav aria-label="Pull request lists"><ul>
<li><a href="/octo-org/api/pulls" aria-current="page">Pull requests</a></li>
<li><a href="/octo-org/api/pulls/review-requested/octocat">Review requests</a></li>
</ul></nav>
<main><div id="_r_1_-list-view-container">GitHub's list</div></main></body></html>`;
const pullsContext = await launch("light", async (route) => createFixture().handle(route));
await pullsContext.route("https://github.com/octo-org/api/pulls**", async (route) => route.fulfill({ body: PULLS_PAGE, contentType: "text/html" }));
const pullsPage = await pullsContext.newPage();
await pullsPage.goto("https://github.com/octo-org/api/pulls");
const viewLinks = pullsPage.locator('[data-flohub="repo-views"] .view-link');
await viewLinks.locator(".view-count").first().waitFor();
const viewCounts = await viewLinks.evaluateAll((links) => links.map((link) => link.textContent));
check(
  JSON.stringify(viewCounts) === JSON.stringify(["Your turn3", "Re-requested1", "Their turn1", "Reviewed by others0"]),
  `the pull request list's sidebar counts the repository's pull requests in each of FloHub's views: ${JSON.stringify(viewCounts)}`,
);
await viewLinks.filter({ hasText: "Re-requested" }).click();
await pullsPage.locator('[data-flohub="repo-list"] .pull').first().waitFor();
check(
  new URL(pullsPage.url()).hash === "#flohub=rerequested" &&
    (await pullsPage.locator('[id$="-list-view-container"]').isHidden()) &&
    (await pullsPage.locator('[data-flohub="repo-list"] .pull .title').allTextContents()).join("\n") ===
      "#77 fix(auth): refresh tokens before they expire and retry the failed request once" &&
    (await pullsPage.getByRole("link", { name: "Pull requests", exact: true }).getAttribute("aria-current")) === "false",
  "a FloHub view opens in the address, stands in for GitHub's list and takes the current mark from GitHub's own",
);
await pullsPage.screenshot({ path: `${SCREENSHOTS}/repo-pulls-rerequested.png`, fullPage: true });
await pullsPage.reload();
await pullsPage.locator('[data-flohub="repo-list"] .pull').first().waitFor();
check(true, "a reload keeps the open view");
await pullsPage.getByRole("link", { name: "Pull requests", exact: true }).click();
await pullsPage.locator('[id$="-list-view-container"]').waitFor();
check(
  (await pullsPage.locator('[data-flohub="repo-list"]').count()) === 0 && (await pullsPage.locator('[data-flohub="repo-views"] .view-link[aria-current="page"]').count()) === 0,
  "GitHub's own list brings GitHub's list back and closes FloHub's view",
);
await pullsContext.close();

const dark = await launch("dark");
await dark.route("https://api.github.com/**", async (route) => createFixture().handle(route));
const darkPage = await dark.newPage();
await darkPage.goto(`${PULL_URL}/files`);
await inlineBar(darkPage).locator(".reviewer").first().waitFor();
await inlineBar(darkPage).screenshot({ path: `${SCREENSHOTS}/inline-dark.png` });
await readmeShot(inlineBar(darkPage), "bar-dark");
await inlineBar(darkPage).getByRole("button", { name: "Versions", exact: true }).click();
await darkPage.locator("flohub-versions details.file").first().waitFor();
await darkPage.waitForTimeout(250);
await darkPage.screenshot({ path: `${SCREENSHOTS}/versions-dark.png` });
await readmeShot(darkPage.locator("flohub-versions .surface"), "versions-dark");
await darkPage.locator("flohub-versions").getByRole("button", { name: "Close" }).click();
await darkPage.mouse.wheel(0, 2400);
await floatingBar(darkPage).locator(".pill").click();
await floatingBar(darkPage).locator(".panel").waitFor();
await darkPage.waitForTimeout(250);
await darkPage.screenshot({ path: `${SCREENSHOTS}/floating-expanded-dark.png` });

const [worker] = dark.serviceWorkers();
await worker?.evaluate(async () => chrome.storage.local.remove("token"));
await darkPage.goto(`${PULL_URL}/files`);
await inlineBar(darkPage).getByRole("button", { name: "Set up token" }).waitFor();
check(true, "missing token shows the setup prompt");
await inlineBar(darkPage).screenshot({ path: `${SCREENSHOTS}/setup-dark.png` });
await dark.close();

const keys = await launch("light");
const keyFixture = createFixture();
await keys.route("https://api.github.com/**", async (route) => keyFixture.handle(route));
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
  const body = (await response.text()).replace(/<head[^>]*>/u, (head) => `${head}${pageShortcut}`);
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
const pageKeys = async () => keyPage.evaluate(() => (globalThis as unknown as { pageKeys: string[] }).pageKeys.join(","));
check((await pageKeys()) === "", `GitHub's own y shortcut never sees the Y of R→Y: "${await pageKeys()}"`);
await keyPage.keyboard.press("y");
check((await pageKeys()) === "keydown,keyup", "a plain Y still reaches GitHub's own shortcut");

await keys.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://github.com" });
await keyPage.keyboard.press("c");
await keyPage.keyboard.press("c");
await toast.getByText(`Copied gh pr checkout ${CURRENT}`).waitFor();
const readClipboard = async () => keyPage.evaluate(async () => navigator.clipboard.readText());
const checkoutCommand = await readClipboard();
await keyPage.keyboard.press("c");
await keyPage.keyboard.press("g");
await toast.getByText(`Copied ${PULL_URL}`).waitFor();
const pullLink = await readClipboard();
const pageC = await keyPage.evaluate(() => (globalThis as unknown as { pageC: string[] }).pageC.join(","));
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
await keyPage.keyboard.press("Escape");
await reviewDialog.waitFor({ state: "hidden" });
check(keyFixture.submissions.length === 2, "Escape closes the request-changes dialog without submitting");

await keyPage.keyboard.press("r");
await keyPage.keyboard.press("n");
await reviewDialog.getByText("No pending review comments.").waitFor();
await keyPage.keyboard.press("Meta+Enter");
await toast.getByText(`Requested changes on #${CURRENT}.`).waitFor();
check(
  JSON.stringify(keyFixture.submissions[2]) ===
    JSON.stringify({ path: "/reviews", body: { event: "REQUEST_CHANGES", body: "\u{200B}" } }),
  `R→N submits an empty change request, with a zero-width space as the comment GitHub requires: ${JSON.stringify(keyFixture.submissions[2])}`,
);

keyFixture.reviewState.pendingComments = 2;
await keyPage.keyboard.press("r");
await keyPage.keyboard.press("n");
await reviewDialog.getByText("Submits your pending review with its 2 draft comments.").waitFor();
await keyPage.screenshot({ path: `${SCREENSHOTS}/review-dialog-pending-light.png` });
await keyPage.keyboard.press("Meta+Enter");
await reviewDialog.waitFor({ state: "hidden" });
for (let waited = 0; keyFixture.submissions.length < 4 && waited < 5000; waited += 50) await keyPage.waitForTimeout(50);
check(
  JSON.stringify(keyFixture.submissions[3]) ===
    JSON.stringify({ path: "/reviews/9/events", body: { event: "REQUEST_CHANGES" } }),
  "R→N with draft comments submits the pending review, comment optional",
);

// A chord's first key alone shows, after a pause, what may follow, and waits past the chord's timeout for it.
const chordHint = keyPage.locator("flohub-chord-hint");
await keyPage.keyboard.press("c");
await chordHint.getByText("Copy the pull request's branch").waitFor();
const hintKeys = await chordHint.locator("dt kbd").allInnerTexts();
await keyPage.waitForTimeout(1600);
await keyPage.keyboard.press("b");
await toast.getByText("Copied feat/rebase-planner").waitFor();
check(
  JSON.stringify(hintKeys) === JSON.stringify(["C", "G", "B"]) && (await chordHint.count()) === 0 && (await readClipboard()) === "feat/rebase-planner",
  `C alone shows what may follow, and C then B, even after the hint's wait, copies the pull request's branch: ${JSON.stringify(hintKeys)}`,
);
await keyPage.keyboard.press("d");
await chordHint.getByText("Convert to draft", { exact: false }).waitFor();
await keyPage.keyboard.press("Escape");
await keyPage.keyboard.press("d");
await keyPage.waitForTimeout(100);
check(
  (await chordHint.count()) === 0 && keyFixture.pull.moves.length === 0,
  `Esc puts the hint away and drops the chord, so the next D starts afresh: ${keyFixture.pull.moves.join(",")}`,
);
await keyPage.keyboard.press("x");

// ? shows every shortcut, instead of GitHub's own list, and ? again puts it away.
await keyPage.keyboard.press("Shift+Slash");
await chordHint.getByText("Keyboard shortcuts").waitFor();
const listedRows = await chordHint.locator("dt").count();
await keyPage.keyboard.press("Shift+Slash");
await keyPage.waitForTimeout(100);
check(
  listedRows === (MAC ? 19 : 17) && (await chordHint.count()) === 0,
  `? lists every shortcut and ? again puts the list away: ${listedRows} rows`,
);

// ] in GitHub's own diff goes to the one unresolved thread with lines in it, below the fold, and counts the rest.
// GitHub folds it on its line while the comments panel is open: only a "View comments" button, which GitHub adds to the
// line's cell while the mouse is over it, unfolds it. The panel lists the thread as a card.
await keyPage.evaluate(() => {
  const table = document.createElement("table");
  table.setAttribute("aria-label", "Diff for: cmd/rebase.go");
  table.style.margin = "3000px 0";
  table.innerHTML = '<tbody><tr class="diff-line-row"><td class="diff-text-cell" data-diff-side="right" data-line-number="44">log(branch)</td></tr></tbody>';
  const cell = table.querySelector("td")!;
  cell.addEventListener("mouseover", () => {
    if (cell.querySelector("button")) return;
    const button = Object.assign(document.createElement("button"), { type: "button", textContent: "2" });
    button.setAttribute("aria-label", "View comments");
    button.addEventListener("click", () => {
      const drawn = document.getElementById("r1");
      if (drawn) drawn.remove();
      else cell.append(Object.assign(document.createElement("div"), { id: "r1", textContent: "Log at debug level?" }));
    });
    cell.append(button);
  });
  cell.addEventListener("mouseout", () => cell.querySelector("button")?.remove());
  const panel = Object.assign(document.createElement("div"), { id: "docked-side-panel-content" });
  panel.innerHTML = '<div style="height: 200px; overflow: auto"><div style="height: 900px"></div><article><div id="paneldiscussion_r1">Log at debug level?</div></article><div style="height: 900px"></div></div>';
  document.body.append(table, panel);
  scrollTo({ top: 0, behavior: "instant" });
});
await keyPage.keyboard.press("]");
await toast.getByText("Unresolved thread 1 of 1. 3 outdated ones aren't in the current diff; the versions view shows them.").waitFor();
await keyPage.locator("#r1").waitFor();
const landedThread = await keyPage.evaluate(() => {
  const row = document.querySelector('table[aria-label="Diff for: cmd/rebase.go"] tr')!;
  const card = document.querySelector("#docked-side-panel-content article")!;
  const list = card.parentElement!;
  return {
    off: Math.round(row.getBoundingClientRect().top - innerHeight * 0.3),
    marked: card.matches("[data-flohub-current-thread]"),
    cardTop: Math.round(card.getBoundingClientRect().top - list.getBoundingClientRect().top),
    buttonLeft: document.querySelectorAll('button[aria-label="View comments"]').length,
  };
});
check(
  Math.abs(landedThread.off) <= 2 && landedThread.marked && landedThread.cardTop === 12 && landedThread.buttonLeft === 0,
  `] scrolls GitHub's diff to the thread's line, unfolds it, and scrolls the comments panel to its card and marks it: ${JSON.stringify(landedThread)}`,
);
await keyPage.keyboard.press("]");
await toast.getByText("Unresolved thread 1 of 1.", { exact: false }).waitFor();
check((await keyPage.locator("#r1").count()) === 1, "] again leaves an unfolded thread unfolded");
await keyPage.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));

// P then P pokes every requested reviewer who hasn't answered; the poke test below covers one at a time.
await keyPage.keyboard.press("p");
await keyPage.keyboard.press("p");
const poked = (await toast.getByText(/^Poked /u).innerText()).trim();
check(
  poked === "Poked mojombo and github/backend. GitHub notifies them within a minute." &&
    keyFixture.requestLog.toSorted((a, b) => a.localeCompare(b)).join(",") === "add:mojombo,add:team:backend,remove:mojombo,remove:team:backend",
  `P then P pokes every requested reviewer who hasn't answered: "${poked}", ${keyFixture.requestLog.join(",")}`,
);
await keyPage.keyboard.press("p");
await keyPage.keyboard.press("p");
await toast.getByText("Nobody requested is waiting: everyone answered, or was poked within the hour.").waitFor();
check(true, "P then P again pokes nobody within the hour");

// R then R asks again everyone whose verdict is on an older version: defunkt requested changes on v1.
await inlineBar(keyPage).locator(".reviewer", { hasText: "defunkt" }).locator(".behind").waitFor();
const rerequestsBeforeKeys = keyFixture.rerequests.length;
await keyPage.keyboard.press("r");
await keyPage.keyboard.press("r");
await toast.getByText("Re-requested review from defunkt.").waitFor();
check(
  keyFixture.rerequests.slice(rerequestsBeforeKeys).join(",") === "defunkt",
  `R then R re-requests review from the reviewers whose verdict is on an older version: ${keyFixture.rerequests.slice(rerequestsBeforeKeys).join(",")}`,
);

await keyPage.keyboard.press("v");
await keyPage.locator("flohub-versions").waitFor({ state: "attached" });
await keyPage.keyboard.press("v");
await keyPage.locator("flohub-versions").waitFor({ state: "detached" });
check(true, "V opens the versions view and closes it again");

const filter = keyPage.getByPlaceholder("Filter changed files");
await filter.click();
await keyPage.keyboard.type("ry");
await keyPage.keyboard.press("Escape");
await filter.blur();
check(keyFixture.submissions.length === 4, "keys typed into GitHub's own text fields are ignored");

const pullState = inlineBar(keyPage).locator(".pull-state > summary");
await keyPage.keyboard.press("d");
await keyPage.keyboard.press("d");
await toast.getByText(`Turned #${CURRENT} into a draft. D then D marks it ready.`).waitFor();
await pullState.getByText("Draft").waitFor();
await keyPage.keyboard.press("d");
await keyPage.keyboard.press("d");
await toast.getByText(`Marked #${CURRENT} ready for review.`, { exact: false }).waitFor();
await pullState.getByText("Open").waitFor();
check(
  JSON.stringify(keyFixture.pull.moves) === JSON.stringify(["convertPullRequestToDraft", "markPullRequestReadyForReview"]),
  `D then D turns the pull request into a draft, and again marks it ready: ${JSON.stringify(keyFixture.pull.moves)}`,
);
await pullState.click();
await inlineBar(keyPage).getByRole("menuitem", { name: /Close pull request/u }).click();
await toast.getByText(`Closed #${CURRENT}.`, { exact: false }).waitFor();
await pullState.getByText("Closed").waitFor();
if (MAC) {
  await keyPage.keyboard.press("Meta+Shift+Escape");
} else {
  await pullState.click();
  await inlineBar(keyPage).getByRole("menuitem", { name: /Reopen pull request/u }).click();
}
await toast.getByText(`Reopened #${CURRENT}.`, { exact: false }).waitFor();
if (MAC) {
  await keyPage.keyboard.press("Meta+Escape");
  await toast.getByText(`Closed #${CURRENT}. ⌘⇧Esc reopens it.`).waitFor();
  await keyPage.keyboard.press("Meta+Escape");
  await toast.getByText("The pull request is already closed.").waitFor();
  await keyPage.keyboard.press("Meta+Shift+Escape");
  await toast.getByText(`Reopened #${CURRENT}.`, { exact: false }).waitFor();
}
check(
  keyFixture.pull.moves.slice(2).join(",") ===
    (MAC ? "closePullRequest,reopenPullRequest,closePullRequest,reopenPullRequest" : "closePullRequest,reopenPullRequest"),
  `the state menu closes the pull request${MAC ? ", ⌘⇧Esc reopens it, ⌘Esc closes it and only once" : " and reopens it"}: ${keyFixture.pull.moves.join(",")}`,
);

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
await darkKeys.route("https://api.github.com/**", async (route) => createFixture().handle(route));
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
await pokes.route("https://api.github.com/**", async (route) => pokeFixture.handle(route));
const pokePage = await pokes.newPage();
await pokePage.goto(`${PULL_URL}/files`);
await inlineBar(pokePage).locator(".stack-list").waitFor();
const pokeButtons = await inlineBar(pokePage).getByRole("button", { name: /^Poke /u }).evaluateAll((buttons) =>
  buttons.map((button) => button.getAttribute("aria-label")?.split(":", 1)[0]),
);
check(
  JSON.stringify(pokeButtons) === JSON.stringify(["Poke mojombo", "Poke github/backend"]),
  `only currently requested reviewers can be poked: ${JSON.stringify(pokeButtons)}`,
);
await inlineBar(pokePage).getByRole("button", { name: /^Poke mojombo/u }).click();
await pokePage.locator("flohub-toast").getByText("Poked mojombo. GitHub notifies them within a minute.").waitFor();
await inlineBar(pokePage).locator(".reviewer", { hasText: "mojombo" }).locator(".poked").waitFor();
await inlineBar(pokePage).getByRole("button", { name: /^Poke github\/backend/u }).click();
await inlineBar(pokePage).locator(".reviewer", { hasText: "github/backend" }).locator(".poked").waitFor();
check(
  pokeFixture.requestLog.join(",") === "remove:mojombo,add:mojombo,remove:team:backend,add:team:backend",
  `a poke removes and re-adds the request, for users and teams: ${pokeFixture.requestLog.join(",")}`,
);
await inlineBar(pokePage).screenshot({ path: `${SCREENSHOTS}/poke-light.png` });
await pokePage.reload();
await inlineBar(pokePage).locator(".reviewer", { hasText: "mojombo" }).locator(".poked").waitFor();
check(
  (await inlineBar(pokePage).getByRole("button", { name: /^Poke /u }).count()) === 0,
  "a poked reviewer can't be poked again within the hour, across reloads",
);
await pokes.close();

const failedPoke = await launch("light");
const failedFixture = createFixture({ failReadd: true });
await failedPoke.route("https://api.github.com/**", async (route) => failedFixture.handle(route));
const failedPage = await failedPoke.newPage();
await failedPage.goto(`${PULL_URL}/files`);
await inlineBar(failedPage).locator(".stack-list").waitFor();
await inlineBar(failedPage).getByRole("button", { name: /^Poke mojombo/u }).click();
await failedPage.locator("flohub-toast").getByText(/Re-request mojombo by hand\./u).waitFor();
check(
  failedFixture.requestLog.join(",") === "remove:mojombo,add:mojombo,add:mojombo",
  `a failed re-add is retried once and then tells you to re-request by hand: ${failedFixture.requestLog.join(",")}`,
);
await failedPoke.close();

const discussionContext = await launch("light", async (route) => createFixture({ discussion: true }).handle(route));
const [discussionWorker] = discussionContext.serviceWorkers();
await discussionWorker?.evaluate(async (at) => chrome.storage.local.set({ discussionSeen: { "github/gh-stack#344": at } }), ago(10));
const discussionPage = await discussionContext.newPage();
await discussionPage.goto(`${PULL_URL}/files`);
const discussion = inlineBar(discussionPage);
await discussion.locator(".discussion-item").first().waitFor();
const discussionItems = async () =>
  discussion.locator(".discussion-item").evaluateAll((items) =>
    items.map((item) => `${item.querySelector(".name")?.textContent}${item.classList.contains("unread") ? "*" : ""}`),
  );
check(
  (await discussion.locator(".discussion-new").innerText()) === "2 new" &&
    JSON.stringify(await discussionItems()) === JSON.stringify(["mojombo*", "wycats*"]),
  `the discussion shows the comments since the last visit, not the viewer's own or bots': ${JSON.stringify(await discussionItems())}`,
);
await discussion.getByRole("button", { name: "Discussion: 4 comments, 2 new. Show all" }).click();
check(
  JSON.stringify(await discussionItems()) === JSON.stringify(["octocat", "mojombo*", "wycats*", "defunkt"]) &&
    (await discussion.locator(".discussion-item", { hasText: "defunkt" }).locator(".discussion-verdict").innerText()) === "Requested changes",
  `Show all lists every review text and comment, newest first, with the review's verdict: ${JSON.stringify(await discussionItems())}`,
);
await discussion.getByRole("button", { name: "Show 2 comments from bots and stack tools" }).click();
check((await discussion.locator(".discussion-item").count()) === 6, "Show bots adds the bot review and the stack tool's comment");
await discussion.getByRole("button", { name: "Hide 2 comments from bots and stack tools" }).click();
const longText = discussion.locator(".discussion-item", { hasText: "mojombo" }).locator(".discussion-text");
const clampedBefore = await longText.evaluate((text) => text.classList.contains("clamped") && text.scrollHeight > text.clientHeight);
await discussion.locator(".discussion-item", { hasText: "mojombo" }).getByRole("button", { name: "Show more" }).click();
const clampedAfter = await longText.evaluate((text) => text.classList.contains("clamped"));
check(clampedBefore && !clampedAfter, "a long comment is clamped to three lines until Show more");
check(
  (await discussion.locator(".discussion-item", { hasText: "wycats" }).getByRole("link", { name: /on GitHub/u }).getAttribute("href")) ===
    `${PULL_URL}#issuecomment-1`,
  "each item links to its comment on GitHub",
);
const rich = await discussion.locator(".discussion-item").evaluateAll((items) => {
  const by = (name: string) => items.find((item) => item.querySelector(".name")?.textContent === name)!.querySelector(".discussion-text")!;
  const mojombo = by("mojombo");
  const link = by("wycats").querySelector("a");
  return {
    strong: by("defunkt").querySelector("strong")?.textContent,
    listItems: mojombo.querySelectorAll(":scope ol > li").length,
    code: [...mojombo.querySelectorAll("code")].map((code) => code.textContent),
    link: [link?.getAttribute("href"), link?.getAttribute("target")],
    unsafe: {
      scripts: mojombo.querySelectorAll("script, svg").length,
      handlers: [...mojombo.querySelectorAll("*")].filter((element) => [...element.attributes].some((attribute) => attribute.name.startsWith("on"))).length,
      javascriptLinks: [...mojombo.querySelectorAll("a")].filter((anchor) => !/^https?:/u.test(anchor.getAttribute("href") ?? "")).length,
      linkTextKept: mojombo.textContent.includes("harmless looking"),
    },
  };
});
check(
  JSON.stringify(rich) ===
    JSON.stringify({
      strong: "rebase planner",
      listItems: 2,
      code: ["cmd/rebase_test.go", "--server-rebased"],
      link: ["https://github.com/github/gh-stack/pull/341", "_top"],
      unsafe: { scripts: 0, handlers: 0, javascriptLinks: 0, linkTextKept: true },
    }) && (await discussionPage.title()) !== "pwned",
  `comments render GitHub's formatting and drop scripts, handlers and javascript: links: ${JSON.stringify(rich)}`,
);
await discussion.getByRole("button", { name: "Show 2 comments from bots and stack tools" }).click();
check(
  (await discussion.locator(".markdown-alert.markdown-alert-warning").count()) === 1 &&
    (await discussion.locator(".markdown-alert svg").count()) === 0,
  "GitHub's alert boxes keep their kind, without their icons",
);
await discussion.getByRole("button", { name: "Hide 2 comments from bots and stack tools" }).click();
const seenNow = await discussionWorker?.evaluate(async () => {
  const saved = await chrome.storage.local.get("discussionSeen");
  return (saved.discussionSeen as Record<string, string>)["github/gh-stack#344"];
});
check(Date.now() - Date.parse(seenNow ?? "") < 60_000, `opening the pull request records the visit: ${seenNow}`);
await inlineBar(discussionPage).screenshot({ path: `${SCREENSHOTS}/discussion-light.png` });
await discussionContext.close();

const partial = await launch("light");
await partial.route("https://api.github.com/**", async (route) => createFixture({ partial: true }).handle(route));
const partialPage = await partial.newPage();
await partialPage.goto(`${PULL_URL}/files`);
await inlineBar(partialPage).locator(".stack-list").waitFor();
const notice = await inlineBar(partialPage).getByRole("alert").innerText();
check(
  notice.includes("statusCheckRollup") && notice.includes("requestedReviewer") &&
    (await inlineBar(partialPage).locator(".reviewer").count()) === 6,
  `fields the token cannot read leave the rest of the overview intact: "${notice}"`,
);
await inlineBar(partialPage).screenshot({ path: `${SCREENSHOTS}/partial-light.png` });
await partial.close();

console.log(`Screenshots in ${SCREENSHOTS}`);
