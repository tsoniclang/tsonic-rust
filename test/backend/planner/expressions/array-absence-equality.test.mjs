import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";

test("dense array comparisons use one absence and retain present values without repeated reads", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "array_absence_equality" } },
    files: { "index.ts": `
let reads = 0;
function readIndex(index: number): number { reads += 1; return index; }
function check(value: boolean): void { if (!value) throw new Error("array absence"); }
export function main(): void {
  const optional: (number | undefined)[] = [1, undefined, undefined];
  const nullable: (number | null)[] = [1, null];
  check(optional[readIndex(0)] === 1);
  check(1 === optional[readIndex(0)]);
  check(optional[1] === undefined && optional[2] === undefined);
  check(nullable[0] === 1 && nullable[1] === null);
  check(nullable[0] !== null && nullable[1] === undefined);
  check(optional[0] !== undefined && optional[0] !== 2);
  optional[1] = 7;
  nullable[1] = 9;
  check(optional[1] !== undefined && nullable[1] !== null);
  check(optional[1] !== null && nullable[1] === undefined);
  optional[1] = undefined;
  nullable[1] = null;
  check(optional[1] === undefined && nullable[1] === null);
  check(1 in optional && 2 in optional && reads === 2);
  const allUndefined: undefined[] = [undefined, undefined, undefined];
  const allNull: null[] = [null, null];
  check(allUndefined[readIndex(0)] === undefined && allUndefined[1] === undefined);
  check(allUndefined[0] !== null && !(allUndefined[1] !== undefined));
  check(allNull[0] === null && allNull[1] === null);
  check(allNull[0] !== undefined && allNull[1] !== undefined);
  check(reads === 3);
  check(optional.at(1) === undefined && optional.at(0) !== undefined);
  check(nullable.at(1) === null && nullable.at(1) === undefined);
  check(nullable.at(9) === undefined && nullable.at(9) === null);
  check(optional.find(() => true) !== undefined);
  check(optional.findLast(() => true) === undefined);
  check(undefined === optional.findLast(() => true));
  check(nullable.findLast(() => true) === null);
  check(nullable.findLast(() => true) === undefined);
  check(nullable.find(() => false) === undefined);
  check(nullable.find(() => false) === null);
  check(optional.findLast(() => { if (reads < 0) throw new Error("predicate"); return true; }) === undefined);
  check(optional.pop() === undefined && optional.shift() === 1);
  check(nullable.pop() === null && nullable.shift() === 1);
  const lookup = new Map<string, number | null>();
  lookup.set("present", null);
  check(lookup.has("present") && !lookup.has("missing"));
  check(lookup.get("present") === null && lookup.get("present") === undefined);
  check(lookup.get("missing") === undefined && lookup.get("missing") === null);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("array-absence-equality", result.artifacts, { run: true });
});
