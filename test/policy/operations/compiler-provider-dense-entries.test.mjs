import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("dense compiler-provider entries retain generic and stored-undefined payloads", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "dense_provider_entries" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
function visit<E>(values: readonly E[], write: (value: E) => void): void {
  const entries = values.entries();
  const alias = entries;
  for (const [index, value] of alias) {
    check(index >= 0);
    write(value);
  }
}
export function main(): void {
  const values: number[] = [];
  const alias = values;
  alias.push(3);
  values.push(5);
  let sum = 0;
  visit(values, (value: number): void => { sum += value; });
  check(sum === 8);
  const optional: (number | undefined)[] = [undefined, 7];
  let absent = 0;
  let present = 0;
  visit(optional, (value: number | undefined): void => {
    if (value === undefined) absent++;
    else present += value;
  });
  check(absent === 1 && present === 7);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("compiler-provider-dense-entries", result.artifacts, { run: true });
});

for (const mutation of [
  "alias.length = 4;",
  "alias[5] = 1;",
  "values.forEach((_value, _index, receiver) => { receiver.length = 4; });",
  "escape(values);",
]) {
  test(`entries do not assert density after ${mutation}`, () => {
    const { result } = compileRust({
      surfaces: ["js"],
      files: { "index.ts": `
function escape(values: number[]): void { values.length = 4; }
function consume(value: number): number { return value + 1; }
export function main(): void {
  const values = [1, 2];
  const alias = values;
  ${mutation}
  for (const [index, value] of values.entries()) consume(value);
}
` },
    });
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.category === "error"));
  });
}
