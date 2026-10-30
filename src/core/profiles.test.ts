import { describe, expect, test } from "bun:test";
import type { Inbox, InboxGroup, InboxPull } from "./inbox";
import { assignEntry, DEFAULT_PROFILES, knownEntries, profileInbox, profileOf, type Profiles, readProfiles, showsRepo } from "./profiles";

const WORK: Profiles = { names: ["Work", "Personal"], active: 0, entries: { "octo-org": 0, mona: 1, "octo-org/party": 1, "mona/notes": 0 } };

function group(repo: string, whose: "you" | "them" = "you"): InboxGroup {
  const pull = { number: 1, url: `https://github.com/${repo}/pull/1`, turn: { whose, reasons: [] } } as unknown as InboxPull;
  return { key: `${repo}#1`, repo, stackNumber: null, stackSize: 1, pulls: [pull] };
}

function inbox(groups: Partial<Pick<Inbox, "review" | "mine" | "waiting">>): Inbox {
  const review = groups.review ?? [];
  return { viewer: "mona", fetchedAt: 0, review, mine: groups.mine ?? [], waiting: groups.waiting ?? [], reviewCount: review.length, turnCount: 99 };
}

describe("readProfiles", () => {
  test.each([undefined, null, "work", 3])("falls back to the defaults for %p", (raw) => {
    expect(readProfiles(raw)).toEqual(DEFAULT_PROFILES);
  });

  test("keeps what is valid and drops the rest", () => {
    expect(readProfiles({ names: ["Job", "  "], active: 2, entries: { "Octo-Org": 1, bad: "x", "other/Repo": 0 } })).toEqual({
      names: ["Job", "Personal"],
      active: null,
      entries: { "octo-org": 1, "other/repo": 0 },
    });
  });
});

describe("showsRepo", () => {
  test.each([
    ["octo-org/api", true, "an owner on the active profile"],
    ["Octo-Org/api", true, "an owner in another case"],
    ["mona/dotfiles", false, "an owner on the other profile"],
    ["hubot/scripts", true, "an owner on neither profile shows in both"],
    ["octo-org/party", false, "a repository on the other profile than its owner"],
    ["Mona/Notes", true, "a repository on the active profile though its owner isn't"],
  ])("%s: %p, %s", (repo, shown) => {
    expect(showsRepo(WORK, repo)).toBe(shown);
  });

  test("shows every repository while no profile is active", () => {
    expect(showsRepo({ ...WORK, active: null }, "mona/dotfiles")).toBe(true);
  });
});

describe("profileInbox", () => {
  test("hides the other profile's repositories in every section and counts again", () => {
    const whole = inbox({
      review: [group("octo-org/api"), group("mona/dotfiles")],
      mine: [group("mona/site")],
      waiting: [group("hubot/scripts", "them")],
    });
    const shown = profileInbox(whole, WORK);
    expect(shown.review.map((entry) => entry.repo)).toEqual(["octo-org/api"]);
    expect(shown.mine).toEqual([]);
    expect(shown.waiting?.map((entry) => entry.repo)).toEqual(["hubot/scripts"]);
    expect(shown.reviewCount).toBe(1);
    expect(shown.turnCount).toBe(1);
  });

  test("returns the same inbox when it hides nothing", () => {
    const whole = inbox({ review: [group("octo-org/api")] });
    expect(profileInbox(whole, WORK)).toBe(whole);
    const personal = inbox({ review: [group("mona/x")] });
    expect(profileInbox(personal, { ...WORK, active: null })).toBe(personal);
  });
});

describe("profileOf", () => {
  test.each([
    ["octo-org/api", 0],
    ["octo-org/party", 1],
    ["mona/notes", 0],
    ["hubot/scripts", null],
  ])("%s belongs to %p", (repo, profile) => {
    expect(profileOf(WORK, repo)).toBe(profile as 0 | 1 | null);
  });
});

describe("knownEntries", () => {
  test("lists the inbox's owners and the profiles' entries once, lowercase, each repository after its owner", () => {
    const whole = inbox({ review: [group("Zeta/a"), group("octo-org/b")], mine: [group("octo-org/c"), group("octo-org-labs/x")] });
    expect(knownEntries(whole, WORK)).toEqual(["mona", "mona/notes", "octo-org", "octo-org/party", "octo-org-labs", "zeta"]);
  });

  test("lists the profiles' entries without an inbox", () => {
    expect(knownEntries(undefined, { ...WORK, entries: { mona: 1 } })).toEqual(["mona"]);
  });
});

describe("assignEntry", () => {
  test("moves an owner or a repository to a profile, and to both with null", () => {
    expect(assignEntry(WORK, "Hubot", 1).entries).toEqual({ ...WORK.entries, hubot: 1 });
    expect(assignEntry(WORK, "Octo-Org/Party", null).entries).toEqual({ "octo-org": 0, mona: 1, "mona/notes": 0 });
  });
});
