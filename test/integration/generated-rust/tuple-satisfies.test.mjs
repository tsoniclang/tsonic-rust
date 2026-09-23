import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { tupleSatisfiesSource, invalidTupleSatisfiesSources } from "../../../../tsonic/test/fixtures/tuple-satisfies.mjs";

test("checked satisfies tuples preserve distinct optional elements and evaluation order", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "tuple_satisfies" } },
    files: { "index.ts": `${tupleSatisfiesSource}
      import { check } from "@acme/testing";
      export function main(): void { check(run()); }` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("tuple-satisfies", result.artifacts, { run: true });
});

test("satisfies tuples reject incompatible, missing and excess elements", () => {
  for (const source of invalidTupleSatisfiesSources) {
    assert.throws(() => compileRust({ surfaces: ["js"], files: { "index.ts": source } }), /error TS/u);
  }
});
