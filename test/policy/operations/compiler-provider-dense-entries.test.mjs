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
export function materialize<E>(values: readonly E[]): E[] {
  const result: E[] = [];
  for (const value of values) result.push(value);
  return result;
}
function visit<E>(values: readonly E[], write: (value: E) => void): void {
  const copied = values.map((value): E => value);
  check(copied.length === values.length);
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
  const copiedValues = materialize(values);
  visit(copiedValues, (value: number): void => { sum += value; });
  check(sum === 16);
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

test("an implicit arguments object cannot justify a dense parameter", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: { "index.ts": `
function visit(values: number[]): number {
  const escaped = arguments[0] as number[];
  escaped.length = 4;
  let total = 0;
  for (const [index, value] of values.entries()) total += value + index;
  return total;
}
export function main(): void { visit([1, 2]); }
` },
  });
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.category === "error"));
});

for (const mutation of [
  "alias.length = 4;",
  "alias[5] = 1;",
  "values.forEach((_value, _index, receiver) => { receiver.length = 4; });",
  "for (const value of values) { if (value > 0) alias.length = 4; }",
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

test("a returned cached array is not a fresh dense factory result", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: { "index.ts": `
const cached = [1, 2];
function values(): number[] { return cached; }
export function main(): void {
  const array = values();
  cached.length = 4;
  let total = 0;
  for (const [index, value] of array.entries()) total += index + value;
}
` },
  });
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.category === "error"));
});
