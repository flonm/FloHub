import { describe, expect, test } from "bun:test";
import type { FileInterdiff } from "./interdiff";
import type { Reviewer } from "./reviewers";
import {
  nameList,
  pokeMessage,
  rangeFileStats,
  type RangeFileStat,
  staleLabel,
  staleReviewers,
  standingVerdict,
  unseenRange,
  versionsRangeUrl,
  VERSIONS_PARAM,
  waitingReviewers,
} from "./since-review";
import { parseRangeParam, type Version, type VersionReview } from "./versions";

const review = (login: string, verdict: VersionReview["verdict"], dismissed?: boolean): VersionReview => ({
  login,
  avatarUrl: null,
  verdict,
  ...(dismissed && { dismissed }),
});

/** Versions 1 to `count`, the last one current, each with an oid like `aaaaaa1…`. */
function history(count: number, reviews: Record<number, VersionReview[]> = {}): Version[] {
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    return {
      oid: `${String(number).padStart(7, "a")}${"0".repeat(33)}`,
      number,
      at: `2026-10-${String(number).padStart(2, "0")}T10:00:00Z`,
      pushedBy: null,
      reviewedBy: (reviews[number] ?? []).map((entry) => entry.login),
      reviews: reviews[number] ?? [],
      viewerLatestReview: false,
      current: number === count,
    };
  });
}

const file = (path: string, change: FileInterdiff["change"], added: number, removed: number) => ({ path, change, added, removed }) as FileInterdiff;

const stat = (path: string, additions: number, deletions: number): RangeFileStat => ({ path, additions, deletions });

describe("a reviewer's standing verdict", () => {
  test("is their latest approval, with how many versions were pushed since", () => {
    const standing = standingVerdict(history(4, { 2: [review("alice", "approved")] }), "alice");
    expect(standing?.verdict).toBe("approved");
    expect(standing?.version.number).toBe(2);
    expect(standing?.current.number).toBe(4);
    expect(standing?.behind).toBe(2);
  });

  test("a later change request replaces an earlier approval", () => {
    const versions = history(5, { 1: [review("alice", "approved")], 3: [review("alice", "changes_requested")] });
    expect(standingVerdict(versions, "alice")).toMatchObject({ verdict: "changes_requested", behind: 2 });
  });

  test("a later plain comment doesn't replace it", () => {
    const versions = history(4, { 2: [review("alice", "approved")], 3: [review("alice", "commented")] });
    expect(standingVerdict(versions, "alice")).toMatchObject({ verdict: "approved", behind: 2 });
  });

  test("a dismissal ends it, and the approval before doesn't come back", () => {
    const versions = history(5, { 2: [review("alice", "approved")], 4: [review("alice", "changes_requested", true)] });
    expect(standingVerdict(versions, "alice")).toBeNull();
  });

  test("a dismissal the timeline no longer explains ends it too", () => {
    expect(standingVerdict(history(3, { 2: [review("alice", "dismissed")] }), "alice")).toBeNull();
  });

  test("a verdict on the current version is zero versions behind", () => {
    expect(standingVerdict(history(3, { 3: [review("alice", "approved")] }), "alice")?.behind).toBe(0);
  });

  test.each([
    ["never reviewed", history(3, { 2: [review("bob", "approved")] })],
    ["only commented", history(3, { 2: [review("alice", "commented")] })],
    ["a history cached before verdicts", history(3)],
    ["no versions", []],
  ])("there is none when they %s", (_case, versions) => {
    expect(standingVerdict(versions, "alice")).toBeNull();
  });

  test("each reviewer has their own", () => {
    const versions = history(4, { 2: [review("alice", "approved"), review("bob", "changes_requested")], 3: [review("bob", "approved")] });
    expect(standingVerdict(versions, "alice")).toMatchObject({ verdict: "approved", behind: 2 });
    expect(standingVerdict(versions, "bob")).toMatchObject({ verdict: "approved", behind: 1 });
  });
});

describe("the reviewer row's staleness", () => {
  test.each([
    ["an approval two versions back", { 26: [review("alice", "approved")] }, 28, "approved v26 · 2 versions ago"],
    ["an approval one version back", { 27: [review("alice", "approved")] }, 28, "approved v27 · 1 version ago"],
    ["a change request", { 26: [review("alice", "changes_requested")] }, 28, "requested changes on v26 · 2 versions ago"],
    ["a verdict on the current version", { 28: [review("alice", "approved")] }, 28, null],
    ["no verdict", {}, 28, null],
  ])("%s", (_case, reviews, count, expected) => {
    expect(staleLabel(standingVerdict(history(count, reviews), "alice"))).toBe(expected);
  });
});

describe("what a reviewer hasn't seen", () => {
  test("runs from the version of their verdict to the current one, as the versions view numbers them", () => {
    expect(unseenRange(standingVerdict(history(28, { 26: [review("alice", "approved")] }), "alice"))).toEqual({ from: 26, to: 28 });
  });

  test("is nothing when they reviewed the current version or never gave a verdict", () => {
    expect(unseenRange(standingVerdict(history(3, { 3: [review("alice", "approved")] }), "alice"))).toBeNull();
    expect(unseenRange(standingVerdict(history(3), "alice"))).toBeNull();
  });
});

describe("a link to a range in the versions view", () => {
  const versions = history(4);

  test("opens the Files changed tab on the range by commit, the head left open to follow later pushes", () => {
    const url = versionsRangeUrl("https://github.com/octocat/hello/pull/7", versions[1]!, versions[3]!);
    expect(url).toBe(`https://github.com/octocat/hello/pull/7/changes?${VERSIONS_PARAM}=aaaaaa2..`);
  });

  test("pins a newer side that isn't the head, and takes a pull request URL with a trailing slash", () => {
    const url = versionsRangeUrl("https://github.com/octocat/hello/pull/7/", versions[0]!, versions[2]!);
    expect(url).toBe("https://github.com/octocat/hello/pull/7/changes?flohub-versions=aaaaaa1..aaaaaa3");
  });

  test("reads back as the range the view opens on", () => {
    const param = new URL(versionsRangeUrl("https://github.com/octocat/hello/pull/7", versions[1]!, versions[3]!)).searchParams.get(VERSIONS_PARAM);
    expect(parseRangeParam(param ?? "", 0)).toEqual({ from: "aaaaaa2", to: "", toCurrent: true, at: 0 });
  });
});

describe("the files a range changes", () => {
  test("leaves out files both versions change the same way", () => {
    expect(rangeFileStats([file("a.ts", "changed", 3, 1), file("b.ts", "unchanged", 0, 0), file("c.png", "opaque", 0, 0)])).toEqual([
      { path: "a.ts", additions: 3, deletions: 1 },
      { path: "c.png", additions: 0, deletions: 0 },
    ]);
  });

  test("is empty for an empty comparison", () => {
    expect(rangeFileStats([])).toEqual([]);
  });
});

describe("the poke message", () => {
  const url = "https://github.com/octocat/hello/pull/7/changes?flohub-versions=aaaaa26..";
  const approval = standingVerdict(history(28, { 26: [review("alice", "approved")] }), "alice")!;
  const changeRequest = standingVerdict(history(28, { 27: [review("bob", "changes_requested")] }), "bob")!;

  test("names the files changed since the approval, with their lines, and links to the range", () => {
    const files = [stat("a.ts", 10, 2), stat("b.ts", 1, 2), stat("c.ts", 1, 0)];
    expect(pokeMessage("alice", approval, files, url)).toBe(
      `@alice Since your approval on v26 (\`aaaaa26\`): 3 files changed (+12 \u{2212}4): \`a.ts\`, \`b.ts\`, \`c.ts\`. [See what changed](${url})`,
    );
  });

  test("names a few files, then sums up the rest", () => {
    const files = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"].map((path) => stat(path, 1, 0));
    expect(pokeMessage("alice", approval, files, url)).toBe(
      `@alice Since your approval on v26 (\`aaaaa26\`): 5 files changed (+5): \`a.ts\`, \`b.ts\`, \`c.ts\` and 2 more. [See what changed](${url})`,
    );
  });

  test("says so for a change request, and counts one file and large numbers as GitHub does", () => {
    expect(pokeMessage("bob", changeRequest, [stat("src/app.ts", 1200, 0)], url)).toBe(
      `@bob Since you requested changes on v27 (\`aaaaa27\`): 1 file changed (+1,200): \`src/app.ts\`. [See what changed](${url})`,
    );
  });

  test("leaves the lines out when the files change none, as binaries and pure renames don't", () => {
    expect(pokeMessage("alice", approval, [stat("logo.png", 0, 0)], url)).toBe(
      `@alice Since your approval on v26 (\`aaaaa26\`): 1 file changed: \`logo.png\`. [See what changed](${url})`,
    );
  });

  test("fences a path that holds a backtick", () => {
    expect(pokeMessage("alice", approval, [stat("odd`name.ts", 1, 1)], url)).toContain(": `` odd`name.ts ``.");
  });

  test("counts the versions when the files aren't known", () => {
    expect(pokeMessage("alice", approval, null, url)).toBe(`@alice Since your approval on v26 (\`aaaaa26\`), 2 versions were pushed. [See what changed](${url})`);
    expect(pokeMessage("bob", changeRequest, null, url)).toBe(`@bob Since you requested changes on v27 (\`aaaaa27\`), 1 version was pushed. [See what changed](${url})`);
  });

  test("says when the versions since change no files, as after a plain rebase", () => {
    expect(pokeMessage("alice", approval, [], url)).toBe(`@alice Since your approval on v26 (\`aaaaa26\`): 2 versions pushed, with no file changes. [See what changed](${url})`);
  });

  test("is nothing when the verdict is on the current version", () => {
    const fresh = standingVerdict(history(3, { 3: [review("alice", "approved")] }), "alice")!;
    expect(pokeMessage("alice", fresh, [stat("a.ts", 1, 0)], url)).toBeNull();
  });
});

/** A reviewer the viewer may re-request or poke, with what the test says. */
function reviewer(name: string, overrides: Partial<Reviewer> = {}): Reviewer {
  return {
    key: `user:${name}`,
    kind: "user",
    name,
    avatarUrl: null,
    url: `https://github.com/${name}`,
    status: "approved",
    previous: null,
    dismissedFrom: null,
    dismissId: null,
    at: null,
    canRerequest: true,
    canPoke: false,
    ...overrides,
  };
}

describe("staleReviewers", () => {
  const versions = history(4);
  const standing = (verdict: "approved" | "changes_requested", on: number) => {
    const [version, current] = [versions[on - 1], versions[3]];
    if (!version || !current) throw new Error("no such version");
    return { verdict, version, current, behind: current.number - version.number };
  };

  test("picks the reviewers whose verdict is on an older version and who may be asked again", () => {
    const reviewers = [
      reviewer("mona"),
      reviewer("octocat", { status: "changes_requested" }),
      reviewer("tizian"),
      reviewer("hubot", { canRerequest: false }),
      reviewer("defunkt", { status: "rerequested", previous: "approved", canRerequest: false }),
    ];
    const standings = new Map([
      ["mona", standing("approved", 2)],
      ["octocat", standing("changes_requested", 3)],
      ["tizian", standing("approved", 4)],
      ["hubot", standing("approved", 1)],
      ["defunkt", standing("approved", 1)],
    ]);
    expect(staleReviewers(reviewers, standings).map((each) => each.name)).toEqual(["mona", "octocat"]);
  });

  test("skips a reviewer whose standing verdict the rows don't show, or who has none", () => {
    const standings = new Map([["mona", standing("changes_requested", 1)]]);
    expect(staleReviewers([reviewer("mona"), reviewer("octocat")], standings)).toEqual([]);
  });
});

describe("waitingReviewers", () => {
  const HOUR = 3_600_000;
  test("picks the requested reviewers who haven't answered, less those poked within the cooldown", () => {
    const reviewers = [
      reviewer("mona", { status: "pending", canPoke: true }),
      reviewer("octocat", { status: "rerequested", previous: "changes_requested", canPoke: true }),
      reviewer("tizian", { status: "pending", canPoke: true }),
      reviewer("hubot", { status: "changes_requested", canPoke: true }),
      reviewer("defunkt", { status: "pending", canPoke: false }),
    ];
    const pokedAt = new Map([["user:tizian", 10 * HOUR - 60_000], ["user:mona", 8 * HOUR]]);
    expect(waitingReviewers(reviewers, pokedAt, 10 * HOUR, HOUR).map((each) => each.name)).toEqual(["mona", "octocat"]);
  });
});

describe("nameList", () => {
  test.each([
    [[], ""],
    [["mona"], "mona"],
    [["mona", "hubot"], "mona and hubot"],
    [["mona", "hubot", "octocat"], "mona, hubot and octocat"],
  ])("%p", (names, said) => {
    expect(nameList(names)).toBe(said);
  });
});
