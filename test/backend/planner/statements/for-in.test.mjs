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

  const pair: Pair = { first: 1, second: 2 };
  let shapeKeys: string = "";
  for (const key in pair) {
    shapeKeys = shapeKeys + key;
  }
  check(shapeKeys === "firstsecond");

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
  assert.equal(validateGeneratedProject("for-in-policies", result.artifacts, { run: true }).status, 0);
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
