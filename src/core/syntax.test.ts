// The strings under test are TypeScript source, where `${` is text to highlight rather than a placeholder.
/* oxlint-disable no-template-curly-in-string */
import { describe, expect, test } from "bun:test";
import type { InterdiffLine } from "./interdiff";
import { highlightLine, highlightLines, type Language, languageFor, overlay, START, type State, type Token } from "./syntax";

/** @returns The line's tokens as `kind:text`, plain code left out, so a test reads what got colored. */
function colored(code: string, language: Language = "typescript", state: State = START): string[] {
  return highlightLine(code, language, state)
    .tokens.filter((token) => token.kind !== null)
    .map((token) => `${token.kind}:${token.text}`);
}

/** @returns The state after each line, starting from the top of a file. */
function after(lines: string[], language: Language = "typescript"): State {
  let state = START;
  for (const line of lines) ({ state } = highlightLine(line, language, state));
  return state;
}

describe("languageFor", () => {
  test.each([
    ["src/core/syntax.ts", "typescript"],
    ["src/ui/App.TSX", "typescript"],
    ["build.mjs", "typescript"],
    ["db/migrations/0042_retry.sql", "sql"],
    ["tsconfig.json", "json"],
    ["cmd/rebase.go", null],
    ["Makefile", null],
    ["docs/v1.2/README", null],
  ])("%s is highlighted as %p", (path, language) => {
    expect(languageFor(path)).toBe(language as Language | null);
  });
});

describe("highlightLine", () => {
  test("tokens join back to the line", () => {
    const code = '  const retries = await fetch(`${base}/x`, { tries: 3 }); // why';
    expect(highlightLine(code, "typescript", START).tokens.map((token) => token.text).join("")).toBe(code);
  });

  test("an empty line has no tokens", () => {
    expect(highlightLine("", "typescript", START).tokens).toEqual([]);
  });

  test("colors TypeScript's keywords, strings, numbers, constants, types and calls", () => {
    expect(colored('export const delay: number = retry("fast", 0x1f) ?? null;')).toEqual([
      "keyword:export",
      "keyword:const",
      "type:number",
      "function:retry",
      'string:"fast"',
      "number:0x1f",
      "constant:null",
    ]);
  });

  test("a capitalized name is a type, and a keyword after a dot is just a property", () => {
    expect(colored("const node: VersionFile = file.type;")).toEqual(["keyword:const", "type:VersionFile"]);
  });

  test("an escaped quote doesn't end a string", () => {
    expect(colored(String.raw`say('it\'s', 1)`)).toEqual(["function:say", String.raw`string:'it\'s'`, "number:1"]);
  });

  test("a slash after an operator opens a regular expression, after a value it divides", () => {
    expect(colored(String.raw`const words = /\w+[/]/gu;`)).toEqual(["keyword:const", String.raw`regexp:/\w+[/]/gu`]);
    expect(colored("const half = total / 2 / 1;")).toEqual(["keyword:const", "number:2", "number:1"]);
  });

  test("a template literal colors its interpolations as code", () => {
    expect(colored("`v${version.number} of ${count(1)}`")).toEqual([
      "string:`v",
      "keyword:${",
      "keyword:}",
      "string: of ",
      "keyword:${",
      "function:count",
      "number:1",
      "keyword:}",
      "string:`",
    ]);
  });

  test("braces inside an interpolation don't close it", () => {
    expect(colored("`${fn({ a: 1 })}x`").at(-1)).toBe("string:x`");
  });

  test("a block comment carries over to the next line", () => {
    const state = after(["const a = 1; /** Starts here"]);
    expect(colored(" * and ends here */ return a;", "typescript", state)).toEqual(["comment: * and ends here */", "keyword:return"]);
    expect(after(["/** One line. */"]).stack).toEqual([]);
  });

  test("a template literal carries over to the next line, interpolations and all", () => {
    expect(colored("  ${name}`;", "typescript", after(["const text = `line one"]))).toEqual(["string:  ", "keyword:${", "keyword:}", "string:`"]);
  });

  test("a hunk that starts inside a JSDoc reads its first lines as comment", () => {
    expect(colored(" * @param path A file's path.")).toEqual(["comment: * @param path A file's path."]);
    expect(colored(" */")).toEqual(["comment: */"]);
    expect(colored("  * factor;", "typescript", after(["const area = width"]))).toEqual([]);
  });

  test("an unterminated string ends with the line", () => {
    expect(colored("'open")).toEqual(["string:'open"]);
    expect(after(["'open"]).stack).toEqual([]);
  });

  test("colors SQL's keywords in any case, its types and its functions", () => {
    expect(colored("SELECT id, count(*) FROM pulls WHERE state = 'open' AND n > 3;", "sql")).toEqual([
      "keyword:SELECT",
      "function:count",
      "keyword:FROM",
      "keyword:WHERE",
      "string:'open'",
      "keyword:AND",
      "number:3",
    ]);
    expect(colored("alter table pulls add column merged_at timestamptz not null default now();", "sql")).toEqual([
      "keyword:alter",
      "keyword:table",
      "keyword:add",
      "keyword:column",
      "type:timestamptz",
      "keyword:not",
      "keyword:null",
      "keyword:default",
      "function:now",
    ]);
  });

  test("SQL doubles a quote to escape it, and a double-quoted name isn't a keyword", () => {
    expect(colored(`select "order" from t where name = 'O''Brien' -- the one`, "sql")).toEqual([
      "keyword:select",
      "keyword:from",
      "keyword:where",
      "string:'O''Brien'",
      "comment:-- the one",
    ]);
  });

  test("a SQL parameter is a constant, not a dollar quote", () => {
    expect(colored("where id = $1", "sql")).toEqual(["keyword:where", "constant:$1"]);
  });

  test("a dollar-quoted body is a string until its own tag closes it", () => {
    const state = after(["create function f() returns int as $body$"], "sql");
    expect(colored("  select $$ inner $$;", "sql", state)).toEqual(["string:  select $$ inner $$;"]);
    expect(colored("$body$ language sql;", "sql", state)).toEqual(["string:$body$", "keyword:language"]);
  });

  test("JSON colors its strings, numbers and constants", () => {
    expect(colored('{ "strict": true, "target": "es2024", "max": 3 }', "json")).toEqual([
      'string:"strict"',
      "constant:true",
      'string:"target"',
      'string:"es2024"',
      'string:"max"',
      "number:3",
    ]);
  });
});

const line = (mark: InterdiffLine["mark"], display: string): InterdiffLine => ({ mark, effect: mark, text: display, display, left: null, right: null });

describe("highlightLines", () => {
  test("hunk headers and the no-newline note get no tokens", () => {
    const tokens = highlightLines([line(" ", "@@ -1 +1 @@ fn"), line(" ", String.raw`\ No newline at end of file`)], "typescript");
    expect(tokens).toEqual([null, null]);
  });

  test("a comment the older version opened doesn't run into the newer version's lines", () => {
    const tokens = highlightLines(
      [line("-", "+/* old comment"), line("+", "+const fresh = 1;"), line("-", "+*/"), line(" ", " done();")],
      "typescript",
    );
    expect(tokens[1]?.[0]).toEqual({ text: "const", kind: "keyword" });
    expect(tokens[3]).toEqual([
      { text: "done", kind: "function" },
      { text: "();", kind: null },
    ]);
  });

  test("a comment the pull request removes doesn't run into the lines it adds", () => {
    const tokens = highlightLines([line(" ", "-/** gone"), line(" ", "+const kept = 1;"), line(" ", "- */")], "typescript");
    expect(tokens[1]?.[0]).toEqual({ text: "const", kind: "keyword" });
    expect(tokens[2]).toEqual([{ text: " */", kind: "comment" }]);
  });

  test("a hunk header resets what an earlier hunk left open", () => {
    const tokens = highlightLines([line(" ", " /* never closed"), line(" ", "@@ -9 +9 @@"), line(" ", " return 1;")], "typescript");
    expect(tokens[2]?.[0]).toEqual({ text: "return", kind: "keyword" });
  });
});

describe("overlay", () => {
  const tokens: Token[] = [
    { text: "const", kind: "keyword" },
    { text: " a = ", kind: null },
    { text: "250", kind: "number" },
    { text: ";", kind: null },
  ];

  test("splits where either a token or a word highlight ends", () => {
    expect(
      overlay(tokens, [
        { text: "const a = 2", changed: false },
        { text: "50", changed: true },
        { text: ";", changed: false },
      ]),
    ).toEqual([
      { text: "const", kind: "keyword", changed: false },
      { text: " a = ", kind: null, changed: false },
      { text: "2", kind: "number", changed: false },
      { text: "50", kind: "number", changed: true },
      { text: ";", kind: null, changed: false },
    ]);
  });

  test("a line without word highlights keeps its tokens", () => {
    expect(overlay(tokens, [{ text: "const a = 250;", changed: false }]).map((piece) => piece.text)).toEqual(["const", " a = ", "250", ";"]);
  });

  test("an empty line gives no pieces", () => {
    expect(overlay([], [])).toEqual([]);
  });
});
