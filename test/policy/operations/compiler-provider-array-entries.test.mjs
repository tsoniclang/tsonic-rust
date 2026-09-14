import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("compiler provider array entries preserve live storage, holes and iterator aliases", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "provider_array_entries" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
function countPresent<T>(values: readonly T[]): number {
  let count = 0;
  for (const [index, value] of values.entries()) {
    if (value !== undefined) count += index + 1;
  }
  return count;
}
export function main(): void {
  const values = [10, 20];
  const readonlyValues: readonly number[] = values;
  const entries = readonlyValues.entries();
  const alias = entries;
  check(!entries.next().done);
  values[1] = 30;
  let total = 0;
  for (const [index, value] of alias) {
    if (value !== undefined) total += index + value;
    if (index === 1) values.push(40);
  }
  check(total === 73 && entries.next().done === true);
  values.push(50);
  check(alias.next().done === true);
  check(countPresent(values) === 10);
  const sparse = new Array<number>(3);
  sparse[1] = 7;
  let holes = 0;
  let seen = 0;
  let payload = 0;
  let nulls = 0;
  for (const [index, value] of sparse.entries()) {
    const alias = value;
    seen += index + 1;
    if (alias === undefined) holes++;
    else payload += value;
    if (value === null) nulls++;
  }
  check(holes === 2 && seen === 6 && countPresent(sparse) === 2 && payload === 7 && nulls === 0);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("compiler-provider-array-entries", result.artifacts, { run: true });
});
