import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("compiler type-only brands do not allocate native fields or erase ordinary field mutations", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "type_only_fields" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
class Box {
  declare private readonly then?: never;
  declare private readonly anotherBrand: void;
  value: number = 3;
  read(): number { return this.value; }
}
export function main(): void {
  const first = new Box();
  const second = first;
  second.value = 9;
  check(first.read() === 9);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.doesNotMatch(output, /(?:then|another_brand):/u);
  validateGeneratedProject("compiler-type-only-fields", result.artifacts, { run: true });
});

test("numeric membership retains generic results, lazy failure and operand order", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "diverging_branches" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
let failures = 0;
let order = 0;
function key(): number { order = order * 10 + 1; return 0; }
function array(): number[] { order = order * 10 + 2; return [3]; }
function fail(): never { failures += 1; throw new Error("absent"); }
function read<T>(values: T[], index: number): T {
  return index in values ? values[index] : fail();
}
function inverse<T>(bad: boolean, value: T): T { return bad ? fail() : value; }
export function main(): void {
  check(key() in array());
  check(order === 12);
  const maybe: (number | undefined)[] = [undefined];
  check(0 in maybe && !(-1 in maybe));
  check(0 in maybe && maybe[0] === undefined);
  maybe[0] = undefined;
  check(0 in maybe);
  check(read<number>([3], 0) === 3);
  check(inverse<string>(false, "kept") === "kept" && failures === 0);
  let caught = false;
  try { read<number>([3], 1); } catch { caught = true; }
  check(caught && failures === 1);
  caught = false;
  try { inverse<number>(true, 3); } catch { caught = true; }
  check(caught && failures === 2);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("compiler-diverging-branches", result.artifacts, { run: true });
});

test("ordinary incompatible conditional branches remain rejected", () => {
  assert.throws(() => compileRust({ files: { "index.ts": `
export function choose(flag: boolean): number { return flag ? 3 : "invalid"; }
` } }), /TS2322/u);
});
