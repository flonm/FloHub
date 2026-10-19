import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import nodePath from "node:path";

// The tests-and-stories skill asks every change for tests and every view for a story. This check holds the line for
// new modules: a module that builds DOM needs a story in src/stories/, any other module needs its own .test.ts.
// Modules are named by their path under src/, without the extension, so two files of the same name in different
// folders stay apart. The entry points (background, content, options, popup) sit at the top, the rest in core/, api/
// or ui/; stories/ holds the stories themselves and is not checked.

/** Modules that had no unit test when this check came in. Write the test, then take the module off the list. */
const WITHOUT_TEST = new Set([
  "api/github",
  "api/messages",
  "background",
  "content",
  "core/rich-text",
  "ui/anchor",
  "ui/bar-styles",
  "ui/diff-highlights",
]);

/** Modules that build DOM but had no story when this check came in. Write the story, then take the module off. */
const WITHOUT_STORY = new Set([
  "options",
  "popup",
  "ui/bar",
  "ui/discussion-view",
  "ui/file-tree",
  "ui/inbox-view",
  "ui/review-dialog",
  "ui/toast",
  "ui/versions-dialog",
]);

const SRC = new URL(".", import.meta.url).pathname;
const STORIES = `${SRC}stories/`;

/** @param dir A directory under src/. @returns Every .ts file below it, but nothing from stories/. */
function walk(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".ts")).map((entry) => `${dir}${entry.name}`);
  const folders = entries.filter((entry) => entry.isDirectory() && entry.name !== "stories");
  return [...files, ...folders.flatMap((entry) => walk(`${dir}${entry.name}/`))];
}

/** @param file An absolute path. @returns Its module name, its path under src/ without the extension. */
function moduleName(file: string): string {
  return nodePath.relative(SRC, file).replace(/\.ts$/u, "");
}

const files = walk(SRC);
const modules = files.filter((file) => !file.endsWith(".test.ts")).map((file) => moduleName(file));
const tested = new Set(files.filter((file) => file.endsWith(".test.ts")).map((file) => moduleName(file).replace(/\.test$/u, "")));

/** @param file An absolute path. @returns Every module it imports by a relative path. */
function importsOf(file: string): string[] {
  return [...readFileSync(file, "utf8").matchAll(/from "([^"]+)"/gu)].map((match) => match[1]!);
}

const storied = new Set(
  readdirSync(STORIES)
    .filter((file) => file.endsWith(".stories.ts"))
    .flatMap((file) => importsOf(`${STORIES}${file}`))
    .filter((specifier) => specifier.startsWith("."))
    .map((specifier) => nodePath.relative(SRC, nodePath.resolve(STORIES, specifier))),
);

/** @param module A module name. @returns Whether it builds DOM: a view or dialog, or anything importing the DOM helpers. */
function buildsDom(module: string): boolean {
  if (/-(view|dialog)$/u.test(module)) return true;
  const file = `${SRC}${module}.ts`;
  return importsOf(file)
    .filter((specifier) => specifier.startsWith("."))
    .some((specifier) => nodePath.relative(SRC, nodePath.resolve(nodePath.dirname(file), specifier)) === "ui/dom");
}

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
