import { type InterdiffLine, type Segment, splitLine } from "./interdiff";

type TokenKind = "keyword" | "string" | "comment" | "number" | "constant" | "type" | "function" | "regexp";

/** A run of a line's code, and what it is; null for plain code such as names and punctuation. */
export interface Token {
  text: string;
  kind: TokenKind | null;
}

/** A run of a line's code with both its syntax and whether it differs from the line it pairs with. */
export interface Piece extends Token {
  changed: boolean;
}

export type Language = "typescript" | "json" | "sql";

type Frame = { mode: "block" } | { mode: "template" } | { mode: "interp"; depth: number } | { mode: "dollar"; tag: string };

/**
 * Where a line starts: inside a comment, a template literal or a dollar-quoted string, or in plain code. `fresh` marks
 * the first line after a hunk header, where the patch may start in the middle of a comment.
 */
export interface State {
  stack: readonly Frame[];
  fresh: boolean;
}

/** The state at the top of a file or a hunk. */
export const START: State = { stack: [], fresh: true };

interface Grammar {
  keywords: Set<string>;
  constants: Set<string>;
  types: Set<string>;
  /** Whether keywords match regardless of case, as SQL's do. */
  caseless: boolean;
  lineComment: string;
  /** Quotes that open a string, which ends on the same line. */
  quotes: string;
  /** Quotes that open a name, like SQL's "column", shown as plain code. */
  nameQuotes: string;
  /** Backtick templates with `${}` interpolation. */
  templates: boolean;
  /** Postgres' `$$ … $$` and `$tag$ … $tag$` strings. */
  dollarQuotes: boolean;
  regexps: boolean;
  /** Whether a capitalized name is a type, as by TypeScript's convention. */
  pascalTypes: boolean;
  identifier: RegExp;
}

const words = (list: string) => new Set(list.split(" "));

const TYPESCRIPT: Grammar = {
  keywords: words(
    "abstract accessor as asserts async await break case catch class const continue debugger declare default delete do else enum export extends finally for from function get if implements import in infer instanceof interface is keyof let namespace new of out override private protected public readonly return satisfies set static super switch throw try type typeof unique using var void while with yield",
  ),
  constants: words("true false null undefined this NaN Infinity"),
  types: words("any bigint boolean never number object string symbol unknown"),
  caseless: false,
  lineComment: "//",
  quotes: `'"`,
  nameQuotes: "",
  templates: true,
  dollarQuotes: false,
  regexps: true,
  pascalTypes: true,
  identifier: /[A-Za-z_$][\w$]*/uy,
};

const JSON_GRAMMAR: Grammar = {
  ...TYPESCRIPT,
  keywords: new Set(),
  constants: words("true false null"),
  types: new Set(),
  quotes: '"',
  templates: false,
  regexps: false,
  pascalTypes: false,
};

const SQL: Grammar = {
  keywords: words(
    "add all alter and any as asc begin between by cascade case check column commit constraint create cross database declare default delete desc distinct do drop else end exists extension foreign from function full grant group having if in index inner insert into is join key language left like limit materialized not null nulls offset on or order outer over partition policy primary procedure references rename replace restrict returning returns revoke right rollback schema select sequence set table then to transaction trigger truncate union unique update using values view when where window with without",
  ),
  constants: words("true false"),
  types: words(
    "bigint bigserial bit bool boolean bytea char character date decimal double float int int2 int4 int8 integer interval json jsonb numeric precision real serial smallint text time timestamp timestamptz uuid varchar varying",
  ),
  caseless: true,
  lineComment: "--",
  quotes: "'",
  nameQuotes: '"`',
  templates: false,
  dollarQuotes: true,
  regexps: false,
  pascalTypes: false,
  identifier: /[A-Za-z_][\w$]*/uy,
};

const GRAMMARS: Record<Language, Grammar> = { typescript: TYPESCRIPT, json: JSON_GRAMMAR, sql: SQL };

const EXTENSIONS: Record<string, Language> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "typescript",
  jsx: "typescript",
  mjs: "typescript",
  cjs: "typescript",
  json: "json",
  jsonc: "json",
  sql: "sql",
};

const NUMBER = /(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?|\.\d[\d_]*(?:[eE][+-]?\d+)?)n?/uy;
const DOLLAR_QUOTE = /\$(?:[A-Za-z_]\w*)?\$/uy;
const SQL_PARAMETER = /\$\d+/uy;
/** A regular expression literal on one line: escapes, and character classes, which may hold a slash. */
const REGEXP = /\/(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\[])+\/[a-z]*/uy;
/** A line that continues a block comment the hunk starts inside of, like a JSDoc's ` * @param`. */
const COMMENT_CONTINUATION = /^\s*\*(?:\/|\s|$)/u;
/** What can come right before a regular expression literal, where a slash can't be a division. */
const BEFORE_REGEXP = words("( , = : [ ! & | ? { ; + - * % < > ~ ^ return typeof case do else in of new delete void throw yield await instanceof");

/**
 * @param path A file's path.
 * @returns The language to highlight it as, or null for one this highlighter doesn't know.
 */
export function languageFor(path: string): Language | null {
  const extension = /\.([^./]+)$/u.exec(path)?.[1]?.toLowerCase();
  return extension ? (EXTENSIONS[extension] ?? null) : null;
}

/**
 * Splits a line of code into tokens, carrying what spans lines (comments, templates, dollar quotes) in the state.
 * @param code The line, without a diff marker.
 * @param language Its language.
 * @param state Where the line starts.
 * @returns Its tokens, which join back to the line, and where the next line starts.
 */
export function highlightLine(code: string, language: Language, state: State): { tokens: Token[]; state: State } {
  const grammar = GRAMMARS[language];
  const stack = [...state.stack];
  const tokens: Token[] = [];
  const push = (text: string, kind: TokenKind | null) => {
    if (text === "") return;
    const last = tokens.at(-1);
    if (last?.kind === kind) last.text += text;
    else tokens.push({ text, kind });
  };
  let previous: string | null = null;
  const significant = (text: string) => {
    if (text.trim() !== "") previous = text.trim();
  };
  if (state.fresh && stack.length === 0 && COMMENT_CONTINUATION.test(code)) stack.push({ mode: "block" });

  let at = 0;
  while (at < code.length) {
    const top = stack.at(-1);
    if (top?.mode === "block") {
      const end = code.indexOf("*/", at);
      const stop = end === -1 ? code.length : end + 2;
      push(code.slice(at, stop), "comment");
      at = stop;
      if (end !== -1) stack.pop();
      continue;
    }
    if (top?.mode === "dollar") {
      const end = code.indexOf(top.tag, at);
      const stop = end === -1 ? code.length : end + top.tag.length;
      push(code.slice(at, stop), "string");
      at = stop;
      if (end !== -1) stack.pop();
      continue;
    }
    if (top?.mode === "template") {
      let end = at;
      while (end < code.length && code[end] !== "`" && !code.startsWith("${", end)) end += code[end] === "\\" ? 2 : 1;
      end = Math.min(end, code.length);
      push(code.slice(at, end), "string");
      at = end;
      if (code[at] === "`") {
        push("`", "string");
        at++;
        stack.pop();
        previous = "`";
      } else if (code.startsWith("${", at)) {
        push("${", "keyword");
        at += 2;
        stack.push({ mode: "interp", depth: 0 });
        previous = "{";
      }
      continue;
    }

    const char = code.charAt(at);
    if (top?.mode === "interp" && (char === "{" || char === "}")) {
      if (char === "}" && top.depth === 0) {
        stack.pop();
        push("}", "keyword");
      } else {
        stack[stack.length - 1] = { mode: "interp", depth: top.depth + (char === "{" ? 1 : -1) };
        push(char, null);
      }
      at++;
      previous = char;
      continue;
    }
    if (code.startsWith(grammar.lineComment, at)) {
      push(code.slice(at), "comment");
      break;
    }
    if (code.startsWith("/*", at)) {
      stack.push({ mode: "block" });
      push("/*", "comment");
      at += 2;
      continue;
    }
    if (grammar.templates && char === "`") {
      stack.push({ mode: "template" });
      push("`", "string");
      at++;
      continue;
    }
    if (grammar.quotes.includes(char) || grammar.nameQuotes.includes(char)) {
      const end = closingQuote(code, at, char, grammar.caseless);
      push(code.slice(at, end), grammar.quotes.includes(char) ? "string" : null);
      at = end;
      previous = char;
      continue;
    }
    if (grammar.dollarQuotes && char === "$") {
      const parameter = sticky(SQL_PARAMETER, code, at);
      if (parameter) {
        push(parameter, "constant");
        at += parameter.length;
        previous = parameter;
        continue;
      }
      const tag = sticky(DOLLAR_QUOTE, code, at);
      if (tag) {
        stack.push({ mode: "dollar", tag });
        push(tag, "string");
        at += tag.length;
        continue;
      }
    }
    if (grammar.regexps && char === "/" && (previous === null || BEFORE_REGEXP.has(previous))) {
      const literal = sticky(REGEXP, code, at);
      if (literal) {
        push(literal, "regexp");
        at += literal.length;
        previous = "/";
        continue;
      }
    }
    const number = /\d|\./u.test(char) ? sticky(NUMBER, code, at) : null;
    if (number) {
      push(number, "number");
      at += number.length;
      previous = number;
      continue;
    }
    const name = sticky(grammar.identifier, code, at);
    if (name) {
      push(name, nameKind(name, grammar, previous === ".", code.slice(at + name.length)));
      at += name.length;
      previous = name;
      continue;
    }
    push(char, null);
    significant(char);
    at++;
  }
  const fresh = state.fresh && code.trim() === "";
  return { tokens, state: { stack, fresh } };
}

function sticky(pattern: RegExp, code: string, at: number): string | null {
  pattern.lastIndex = at;
  return pattern.exec(code)?.[0] ?? null;
}

/**
 * @returns Where a string or quoted name that opens at `at` ends: after its closing quote, or at the end of the line.
 * SQL escapes a quote by doubling it, the others with a backslash.
 */
function closingQuote(code: string, at: number, quote: string, doubled: boolean): number {
  let end = at + 1;
  while (end < code.length) {
    const escaped = doubled ? code[end] === quote && code[end + 1] === quote : code[end] === "\\";
    if (escaped) end += 2;
    else if (code[end] === quote) return end + 1;
    else end++;
  }
  return code.length;
}

function nameKind(name: string, grammar: Grammar, member: boolean, after: string): TokenKind | null {
  const word = grammar.caseless ? name.toLowerCase() : name;
  const call = /^\s*\(/u.test(after);
  // After a dot a name is a property, whatever word it is: `node.type`, `query.select(…)`.
  if (!member) {
    if (grammar.keywords.has(word)) return "keyword";
    if (grammar.constants.has(word)) return "constant";
    if (grammar.types.has(word) && !call) return "type";
  }
  if (call) return "function";
  if (grammar.pascalTypes && /^[A-Z][a-z]\w*$/u.test(name)) return "type";
  return null;
}

/** One of the four texts a file's interdiff interleaves: a version's base or head side. */
type Text = "new-head" | "new-base" | "old-head" | "old-base";

function startStates(): Record<Text, State> {
  return { "new-head": START, "new-base": START, "old-head": START, "old-base": START };
}

/**
 * Highlights a file's interdiff lines. They interleave four texts (each version's base and head side), so each text
 * carries its own state, and a line starts in the state of the newest text it belongs to.
 * @param lines The file's lines, in order.
 * @param language Their language.
 * @returns Each line's tokens, or null for hunk headers and the no-newline note.
 */
export function highlightLines(lines: InterdiffLine[], language: Language): (Token[] | null)[] {
  let states = startStates();
  return lines.map((line) => {
    const { kind, code } = splitLine(line.display);
    if (kind === "hunk") {
      states = startStates();
      return null;
    }
    if (kind === "\\") return null;
    const versions = line.mark === " " ? ["new", "old"] : [line.mark === "+" ? "new" : "old"];
    const sides = kind === " " ? ["head", "base"] : [kind === "+" ? "head" : "base"];
    const texts = versions.flatMap((version) => sides.map((side) => `${version}-${side}` as Text));
    const ends = new Map<string, { tokens: Token[]; state: State }>();
    const run = (state: State) => {
      const key = JSON.stringify(state);
      const known = ends.get(key);
      if (known) return known;
      const result = highlightLine(code, language, state);
      ends.set(key, result);
      return result;
    };
    const [newest = "new-head"] = texts;
    const shown = run(states[newest]);
    for (const text of texts) states[text] = run(states[text]).state;
    return shown.tokens;
  });
}

/**
 * Lays a line's word highlights over its syntax tokens. Both split the same code, at different places.
 * @param tokens The line's syntax.
 * @param segments The line's runs of what differs from the line it pairs with.
 * @returns Runs that carry both, which join back to the line.
 */
export function overlay(tokens: Token[], segments: Segment[]): Piece[] {
  const pieces: Piece[] = [];
  let token = 0;
  let segment = 0;
  let tokenAt = 0;
  let segmentAt = 0;
  for (;;) {
    const current = tokens[token];
    const run = segments[segment];
    if (!current || !run) return pieces;
    const { text, kind } = current;
    const length = Math.min(text.length - tokenAt, run.text.length - segmentAt);
    pieces.push({ text: text.slice(tokenAt, tokenAt + length), kind, changed: run.changed });
    tokenAt += length;
    segmentAt += length;
    if (tokenAt === text.length) {
      token++;
      tokenAt = 0;
    }
    if (segmentAt < run.text.length) continue;
    segment++;
    segmentAt = 0;
  }
}
