import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, compileRust } from "../../helpers/rust-session.mjs";
import { rustTargetOperationFactKey } from "../../../dist/analysis/facts/keys.js";

test("provider sequence arguments never acquire fabricated scalar source ABI", () => {
  for (const element of ["number", "uint8"]) {
    const options = {
      surfaces: ["js"],
      files: { "index.ts": `
import type { uint8 } from "@tsonic/core/types.js";
export function text(values: ${element}[]): string { return String.fromCharCode(...values); }
` },
    };
    const { result } = compileRust(options);
    assert.equal(result.artifacts.length, 0);
    assert.ok(result.diagnostics.some(diagnostic =>
      diagnostic.category === "error" && /selected call argument/u.test(diagnostic.message)));
    assert.throws(() => analyzeRust(options), /selected call argument cannot be represented/u);
  }
});

test("ordinary scalar provider arguments retain their actual byte carrier", () => {
  const { source, program } = analyzeRust({
    surfaces: ["js"],
    files: { "index.ts": `
import type { uint8 } from "@tsonic/core/types.js";
export function text(value: uint8): string { return String.fromCharCode(value); }
` },
  });
  let calls = 0;
  const visit = node => {
    if (source.ast.is.IsCallExpression(node)) {
      calls += 1;
      const fact = program.facts.getFact(node, rustTargetOperationFactKey);
      assert.equal(fact?.kind, "provider-operation");
      assert.deepEqual(fact.abi.sourceArguments[0].carrier, { kind: "source-primitive", name: "uint8" });
    }
    source.ast.forEachChild(node, child => { visit(child); });
  };
  const file = program.sourceFiles.find(file => source.ast.getFileName(file).endsWith("index.ts"));
  assert.ok(file);
  visit(file);
  assert.equal(calls, 1);
});
