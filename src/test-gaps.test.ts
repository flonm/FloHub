import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

// The tests-and-stories skill asks every change for tests and every view for a story. This check holds the line for
// new modules: a module that builds DOM needs a story in src/stories/, any other module needs its own .test.ts.

/** Modules that had no unit test when this check came in. Write the test, then take the module off the list. */
const WITHOUT_TEST = new Set(["anchor", "background", "bar-styles", "content", "diff-highlights", "github", "messages", "rich-text"]);

/** Modules that build DOM but had no story when this check came in. Write the story, then take the module off. */
const WITHOUT_STORY = new Set(["bar", "discussion-view", "file-tree", "inbox-view", "options", "popup", "review-dialog", "toast", "versions-dialog"]);

const SRC = new URL(".", import.meta.url).pathname;
const STORIES = `${SRC}stories/`;

const modules = readdirSync(SRC)
  .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
  .map((file) => file.slice(0, -".ts".length));
const tested = new Set(readdirSync(SRC).filter((file) => file.endsWith(".test.ts")).map((file) => file.slice(0, -".test.ts".length)));
const storied = new Set(
  readdirSync(STORIES)
    .filter((file) => file.endsWith(".stories.ts"))
    .flatMap((file) => [...readFileSync(`${STORIES}${file}`, "utf8").matchAll(/from "\.\.\/([\w-]+)"/gu)].map((match) => match[1])),
);
const buildsDom = (module: string) =>
  /-(view|dialog)$/u.test(module) || readFileSync(`${SRC}${module}.ts`, "utf8").includes('from "./dom"');

test("every module that builds DOM appears in a story", () => {
  const missing = modules.filter((module) => buildsDom(module) && !storied.has(module) && !WITHOUT_STORY.has(module));
  expect(missing).toEqual([]);
});

test("every other module has its own unit test", () => {
  const missing = modules.filter((module) => !buildsDom(module) && !tested.has(module) && !storied.has(module) && !WITHOUT_TEST.has(module));
  expect(missing).toEqual([]);
});

test("the lists of known gaps only name modules that still have the gap", () => {
  const closed = [
    ...[...WITHOUT_TEST].filter((module) => !modules.includes(module) || tested.has(module)),
    ...[...WITHOUT_STORY].filter((module) => !modules.includes(module) || storied.has(module)),
  ];
  expect(closed).toEqual([]);
});
