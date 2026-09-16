import assert from "node:assert/strict";
import { test } from "node:test";

import {
  acmeTestingPackage,
  artifactText,
  compileRust,
} from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";

const imports = `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";
`;

test("for-in lowers finalized JS-array and project-shape key policies", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "for_in_policies" } },
    files: {
      "index.ts": `
${imports}
interface Pair {
  first: int32;
  second: int32;
}
interface NumericKeys {
  2: int32;
  10: int32;
  last: int32;
  first: int32;
}

export function main(): void {
  let denseKeys: string = "";
  for (let key in [4, 5, 6]) {
    denseKeys = denseKeys + key;
    key = "consumed";
    check(key === "consumed");
  }
  check(denseKeys === "012");

  const sparseValues: (int32 | undefined)[] = [1, , 3];
  let sparseKeys: string = "";
  for (const key in sparseValues) {
    sparseKeys = sparseKeys + key;
  }
  check(sparseKeys === "02");

  const pair: Pair = { second: 2, first: 1 };
  const alias = pair;
  let shapeKeys: string = "";
  for (const key in alias) {
    shapeKeys = shapeKeys + key;
  }
  check(shapeKeys === "secondfirst");

  const numeric: NumericKeys = { last: 3, 10: 4, first: 5, 2: 6 };
  let numericKeys: string = "";
  for (const key in numeric) numericKeys = numericKeys + key + ":";
  check(numericKeys === "2:10:last:first:");

  let assignedKey: string = "";
  for (assignedKey in [7, 8]) {
  }
  check(assignedKey === "1");
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /JsArray::from_dense\(vec!\[4\.0, 5\.0, 6\.0\]\)\.enumerable_own_keys\(\)/u);
  assert.match(source, /enumerable_own_keys\(\)/u);
  assert.match(source, /String::from\("first"\)/u);
  assert.match(source, /assigned_key = for_in_key;/u);
  assert.doesNotMatch(source, /retains unused generated storage/u);
  assert.equal(validateGeneratedProject("for-in-policies", result.artifacts, { run: true }).status, 0);
});

test("for-in cannot invent a derived object's keys from its base parameter", () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
    class Base { count = 1; }
    class Derived extends Base { extra = 2; }
    function keys(value: Base): string {
      let text = "";
      for (const key in value) text += key;
      return text;
    }
    export function run(): string { return keys(new Derived()); }
  ` } });
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_ITERATION_CARRIER_UNSUPPORTED"));
  assert.equal(result.artifacts.length, 0);
});

test("for-in requires one unchanged closed construction origin", () => {
  for (const body of [
    `let value: Pair = { first: 1, second: 2 }; value = { second: 2, first: 1 };`,
    `const value: Pair = { ...{ second: 2, first: 1 } };`,
  ]) {
    const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
      interface Pair { first: number; second: number; }
      export function run(): string {
        ${body}
        let text = "";
        for (const key in value) text += key;
        return text;
      }
    ` } });
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_ITERATION_CARRIER_UNSUPPORTED"));
    assert.equal(result.artifacts.length, 0);
  }
});

test("for-in fails closed when the target carrier has no key policy", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

interface BaseCounter {
  base: int32;
}

interface Counter extends BaseCounter {
  value: int32;
}

export function keys(counter: Counter): string {
  let result: string = "";
  for (const key in counter) {
    result = result + key;
  }
  return result;
}
`,
    },
  });

  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.code === "RUST_ITERATION_CARRIER_UNSUPPORTED"));
  assert.equal(result.artifacts.length, 0);
});
