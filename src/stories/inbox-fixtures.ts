import type { Inbox, InboxGroup, InboxPull } from "../core/inbox";
import { NOW } from "./shadow";

/*
 * The pull requests the inbox's stories draw: review requests, the viewer's own, the ones they reviewed and the rest,
 * across a few repositories of one owner.
 */

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
const AVATAR = "https://avatars.githubusercontent.com/u/583231?v=4";

/**
 * @param overrides The numbers and title, plus whatever the row's state needs.
 * @returns A pull request as the inbox holds it.
 */
export function pull(overrides: Partial<InboxPull> & Pick<InboxPull, "number" | "title">): InboxPull {
  return {
    url: `https://github.com/octo-org/api/pull/${overrides.number}`,
    tone: "accent",
    label: "Needs review",
    author: "mona",
    avatarUrl: AVATAR,
    position: null,
    lastActivity: new Date(NOW - 5 * HOUR).toISOString(),
    resolvedThreads: 0,
    totalThreads: 0,
    rerequested: false,
    additions: 0,
    deletions: 0,
    ...overrides,
  };
}

/** @returns One stack, or one pull request outside a stack when the number is null. */
export function group(repo: string, stackNumber: number | null, pulls: InboxPull[]): InboxGroup {
  return { key: `${repo}#${stackNumber ?? pulls[0]?.number ?? 0}`, repo, stackNumber, stackSize: stackNumber === null ? 1 : pulls.length, pulls };
}

export const REVIEW: InboxGroup = group("octo-org/api", 12, [
  pull({
    number: 903,
    title: "feat(ui): render the stack in the inbox",
    tone: "success",
    label: "Ready to merge",
    position: 3,
    totalThreads: 3,
    resolvedThreads: 3,
    additions: 48,
    deletions: 7,
    turn: { whose: "them", reasons: [{ code: "approved-by-other", who: ["octocat", "ada"] }] },
    reviews: [
      { login: "octocat", avatarUrl: AVATAR, verdict: "approved" },
      { login: "ada", avatarUrl: null, verdict: "approved" },
    ],
  }),
  pull({
    number: 902,
    title: "feat(api): page through the stack entries",
    tone: "attention",
    label: "Changes requested",
    position: 2,
    totalThreads: 1,
    lastActivity: new Date(NOW - 26 * HOUR).toISOString(),
    turn: { whose: "them", reasons: [{ code: "changes-by-other", who: ["octocat"] }] },
    reviews: [{ login: "octocat", avatarUrl: AVATAR, verdict: "changes_requested" }],
  }),
  pull({
    number: 901,
    title: "fix(auth): refresh tokens before they expire and retry the failed request once",
    label: "Needs review",
    position: 1,
    rerequested: true,
    viaTeam: true,
    turn: { whose: "you", reasons: [{ code: "rerequested" }] },
  }),
]);

/** A first-time review request nobody has a verdict on yet. */
export const FRESH: InboxGroup = group("octo-org/web", null, [
  pull({ number: 88, title: "feat(web): remember the last filter", lastActivity: new Date(NOW - 2 * HOUR).toISOString(), turn: { whose: "you", reasons: [{ code: "requested" }] } }),
]);

/** Pull requests the searches found that wait for nobody in particular: one the viewer approved. */
const OTHER: InboxGroup[] = [
  group("octo-org/web", null, [pull({ number: 70, title: "chore(web): bump the bundler", tone: "success", label: "Ready to merge", author: "ada" })]),
];

/** Every other open pull request of the owners, loaded on request. */
export const LOADED: InboxGroup[] = [
  group("octo-org/api", null, [pull({ number: 140, title: "refactor(api): split the resolvers", author: "grace", lastActivity: new Date(NOW - 30 * HOUR).toISOString() })]),
  group("octo-org/docs", null, [pull({ number: 31, title: "docs: a page on profiles", tone: "neutral", label: "Draft", author: "linus" })]),
];

export const SCOPES = ["octo-org", "tizian"];

export const WAITING: InboxGroup[] = [
  group("octo-org/api", null, [
    pull({
      number: 130,
      title: "fix(sync): keep local commits on rebase",
      tone: "danger",
      label: "Checks failed",
      yourVerdict: "changes_requested",
      pushedSinceReview: true,
      turn: { whose: "you", reasons: [{ code: "replies", count: 2 }, { code: "pushed-since-review" }] },
      reviews: [{ login: "linus", avatarUrl: null, verdict: "commented" }],
    }),
  ]),
  group("octo-org/docs", null, [
    pull({ number: 128, title: "docs: explain the stack badge", tone: "neutral", label: "Draft", yourVerdict: "commented", turn: { whose: "none", reasons: [{ code: "draft" }] } }),
  ]),
  group("octo-org/web", null, [
    pull({
      number: 77,
      title: "fix(web): debounce the search box",
      label: "Needs review",
      yourVerdict: "changes_requested",
      turn: { whose: "them", reasons: [{ code: "waiting-on-author" }] },
    }),
  ]),
];

export const MINE: InboxGroup[] = [
  group("octo-org/api", 42, [
    pull({
      number: 121,
      title: "feat(stack): show failing checks",
      tone: "danger",
      label: "Checks failed",
      author: "tizian",
      position: 2,
      additions: 10,
      deletions: 2,
      lastActivity: new Date(NOW - 40 * MINUTE).toISOString(),
      turn: { whose: "you", reasons: [{ code: "checks-failed" }, { code: "changes-requested", who: ["mona"] }, { code: "replies", count: 1 }] },
      reviews: [
        { login: "mona", avatarUrl: null, verdict: "changes_requested" },
        { login: "octocat", avatarUrl: AVATAR, verdict: "approved" },
        { login: "ada", avatarUrl: null, verdict: "approved" },
        { login: "grace", avatarUrl: null, verdict: "commented" },
        { login: "linus", avatarUrl: null, verdict: "commented" },
      ],
    }),
    pull({
      number: 120,
      title: "docs: explain the stack badge",
      tone: "success",
      label: "Ready to merge",
      author: "tizian",
      position: 1,
      totalThreads: 2,
      resolvedThreads: 1,
      turn: { whose: "you", reasons: [{ code: "ready-to-merge" }] },
      reviews: [{ login: "octocat", avatarUrl: AVATAR, verdict: "approved" }],
    }),
  ]),
  group("octo-org/web", null, [
    pull({
      number: 64,
      title: "feat(web): keyboard shortcuts for the inbox",
      label: "Needs review",
      author: "tizian",
      turn: { whose: "them", reasons: [{ code: "waiting-on-reviewers", who: ["ada", "grace"] }] },
    }),
  ]),
];

/** @returns A full inbox, every section populated. */
export function ready(overrides: Partial<Inbox> = {}): Inbox {
  return {
    viewer: "tizian",
    fetchedAt: NOW - 4 * MINUTE,
    review: [REVIEW, FRESH],
    waiting: WAITING,
    mine: MINE,
    other: OTHER,
    reviewCount: 4,
    ...overrides,
  };
}
