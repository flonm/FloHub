/** Which side of a split diff a row belongs to: both, only the left, only the right, or across both, like a header. */
export type SplitSide = " " | "-" | "+" | "full";

/** One row of a split diff: the left and right side's rows, by their index in the unified rows, or a full-width row. */
export type SplitRow = { kind: "pair"; left: number | null; right: number | null } | { kind: "full"; index: number };

/**
 * Lays unified rows out side by side, as GitHub's split diff does: a row both sides have sits on both, and a run of
 * rows only the left has pairs, row by row, with the run of rows only the right has that follows it.
 * @param sides Each unified row's side, in order.
 * @returns The split rows, by the indices of the unified rows they show.
 */
export function splitRows(sides: SplitSide[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let index = 0;
  while (index < sides.length) {
    const side = sides[index];
    if (side === "full") {
      rows.push({ kind: "full", index });
      index++;
    } else if (side === " ") {
      rows.push({ kind: "pair", left: index, right: index });
      index++;
    } else {
      const lefts: number[] = [];
      const rights: number[] = [];
      while (sides[index] === "-") lefts.push(index++);
      while (sides[index] === "+") rights.push(index++);
      for (let pair = 0; pair < Math.max(lefts.length, rights.length); pair++) {
        rows.push({ kind: "pair", left: lefts[pair] ?? null, right: rights[pair] ?? null });
      }
    }
  }
  return rows;
}
