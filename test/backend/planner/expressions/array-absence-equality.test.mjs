import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";

test("array comparisons distinguish holes, undefined, null and present values without repeated reads", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "array_absence_equality" } },
    files: { "index.ts": `
let reads = 0;
function readIndex(index: number): number { reads += 1; return index; }
function check(value: boolean): void { if (!value) throw new Error("array absence"); }
export function main(): void {
  const optional: (number | undefined)[] = [1, , undefined];
  const nullable: (number | null)[] = [1, null];
  delete nullable[0];
  check(optional[readIndex(0)] === 1);
  check(1 === optional[readIndex(0)]);
  check(optional[1] === undefined && optional[2] === undefined);
  check(nullable[0] === undefined && nullable[1] === null);
  check(nullable[0] !== null && nullable[1] !== undefined);
  check(optional[0] !== undefined && optional[0] !== 2);
  check(!(1 in optional) && 2 in optional && reads === 2);
  const allUndefined: undefined[] = [undefined, , undefined];
  const allNull: null[] = [null, null];
  delete allNull[0];
  check(allUndefined[readIndex(0)] === undefined && allUndefined[1] === undefined);
  check(allUndefined[0] !== null && !(allUndefined[1] !== undefined));
  check(allNull[0] === undefined && allNull[1] === null);
  check(allNull[0] !== null && allNull[1] !== undefined);
  check(reads === 3);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("array-absence-equality", result.artifacts, { run: true });
});
