import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { interdiff } from "./interdiff";

// The versions view counts what the newer version does to the code, as GitHub's diff of one version against the
// other does. These tests hold it to that: a real pull request's patches, and random versions whose patches git
// makes the way GitHub does, three lines of context around each change.

/** @returns The two versions' patch of a file, as GitHub's compare API answers it. */
async function fixture(name: string): Promise<string> {
  return Bun.file(new URL(`fixtures/uneven-hunks.${name}.patch`, import.meta.url)).text();
}

const version = (patch: string) => [{ filename: "a.json", status: "modified", sha: patch, patch }];
const SAME_BASE = { sameBase: true };

describe("a real pull request whose later version changed further down", () => {
  // From a pull request's lint config: v4 also changed lines further down, so GitHub cut its hunks differently from
  // v3's. Every line of code is replaced by a placeholder; markers, hunk headers and which lines are equal remain.
  test("reads like GitHub's diff of one version against the other: +1 −6", async () => {
    const [file] = interdiff(version(await fixture("older")), version(await fixture("newer")), SAME_BASE);
    expect([file?.added, file?.removed]).toEqual([1, 6]);
  });
});

/** A seeded random number generator, so a failing case can be run again. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

/**
 * Edits a file at a few random places: removes lines, adds new ones, or replaces some.
 * @param lines The file.
 * @param next The random numbers.
 * @param fresh Makes a line no file has had yet.
 * @returns The edited file.
 */
function edit(lines: string[], next: () => number, fresh: () => string): string[] {
  const edited = [...lines];
  for (let edits = 1 + Math.floor(next() * 4); edits > 0; edits--) {
    const at = Math.floor(next() * (edited.length + 1));
    const removed = Math.floor(next() * 3);
    const added = Array.from({ length: Math.floor(next() * 3) }, fresh);
    edited.splice(at, removed, ...added);
  }
  return edited;
}

/** @returns How many lines a minimal diff from a to b adds and removes, from their longest common subsequence. */
function diffCounts(a: string[], b: string[]): [number, number] {
  const lengths = Array.from({ length: a.length + 1 }, () => Array.from({ length: b.length + 1 }, () => 0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i]![j] = a[i] === b[j] ? lengths[i + 1]![j + 1]! + 1 : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }
  const common = lengths[0]![0]!;
  return [b.length - common, a.length - common];
}

/** @returns git's patch from one file to another, from its first hunk on, as GitHub's compare API answers it. */
function gitPatch(directory: string, from: string[], to: string[]): string {
  const [a, b] = [nodePath.join(directory, "a"), nodePath.join(directory, "b")];
  writeFileSync(a, `${from.join("\n")}\n`);
  writeFileSync(b, `${to.join("\n")}\n`);
  const { stdout } = Bun.spawnSync(["git", "diff", "--no-index", "--no-color", "-U3", a, b]);
  const text = stdout.toString();
  const start = text.indexOf("@@");
  return start === -1 ? "" : text.slice(start).trimEnd();
}

describe("random versions, their patches made by git", () => {
  test("count what the newer version does to the code, as git's diff of one version against the other", () => {
    const directory = mkdtempSync(nodePath.join(tmpdir(), "flohub-interdiff-"));
    try {
      const mismatches: string[] = [];
      // 80 cases run in about two seconds; the bugs these were written against showed in the first ten.
      for (let seed = 1; seed <= 80; seed++) {
        const next = random(seed);
        let made = 0;
        const fresh = () => `line ${seed}.${++made}`;
        const base = Array.from({ length: 30 + Math.floor(next() * 40) }, fresh);
        const older = edit(base, next, fresh);
        // A later version usually builds on the older one, and sometimes starts again from the base.
        const newer = edit(next() < 0.8 ? older : base, next, fresh);
        const [file] = interdiff(version(gitPatch(directory, base, older)), version(gitPatch(directory, base, newer)), SAME_BASE);
        const counts = [file?.added ?? 0, file?.removed ?? 0];
        const expected = diffCounts(older, newer);
        if (counts.join(",") !== expected.join(",")) mismatches.push(`seed ${seed}: +${counts[0]} −${counts[1]}, git +${expected[0]} −${expected[1]}`);
      }
      expect(mismatches).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
    // Each case runs git twice. Alone that takes two seconds, but beside a build or the e2e run it passed bun's five
    // second default, and the cases cut off past it read as mismatches.
  }, 30_000);
});
