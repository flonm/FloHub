import { describe, expect, test } from "bun:test";
import { splitRows } from "./split";

describe("splitRows", () => {
  test("a row both sides have sits on both", () => {
    expect(splitRows([" ", " "])).toEqual([
      { kind: "pair", left: 0, right: 0 },
      { kind: "pair", left: 1, right: 1 },
    ]);
  });

  test("removed rows pair with the added rows that follow them, the longer run going on alone", () => {
    expect(splitRows([" ", "-", "-", "+", " "])).toEqual([
      { kind: "pair", left: 0, right: 0 },
      { kind: "pair", left: 1, right: 3 },
      { kind: "pair", left: 2, right: null },
      { kind: "pair", left: 4, right: 4 },
    ]);
    expect(splitRows(["+", "+"])).toEqual([
      { kind: "pair", left: null, right: 0 },
      { kind: "pair", left: null, right: 1 },
    ]);
  });

  test("added rows before removed ones don't pair with them, as GitHub's split doesn't", () => {
    expect(splitRows(["+", "-"])).toEqual([
      { kind: "pair", left: null, right: 0 },
      { kind: "pair", left: 1, right: null },
    ]);
  });

  test("a header runs across both sides", () => {
    expect(splitRows(["full", " "])).toEqual([
      { kind: "full", index: 0 },
      { kind: "pair", left: 1, right: 1 },
    ]);
  });

  test("no rows make no split rows", () => {
    expect(splitRows([])).toEqual([]);
  });
});
