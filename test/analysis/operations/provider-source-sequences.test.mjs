import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, compileRust } from "../../helpers/rust-session.mjs";
import { rustTargetOperationFactKey } from "../../../dist/analysis/facts/keys.js";

test("provider sequence arguments retain collection and element ABI independently", () => {
  for (const element of ["number", "uint8"]) {
    const options = {
      surfaces: ["js"],
      files: { "index.ts": `
import type { uint8 } from "@tsonic/core/types.js";
export function text(values: ${element}[]): string { return String.fromCharCode(...values); }
` },
    };
    const { source, program } = analyzeRust(options);
    let calls = 0;
    const visit = node => {
      if (source.ast.is.IsCallExpression(node)) {
        calls += 1;
        const fact = program.facts.getFact(node, rustTargetOperationFactKey);
        assert.equal(fact?.kind, "provider-operation");
        assert.equal(fact.abi.sourceArguments[0].form, "spread-sequence");
        assert.equal(fact.abi.sourceArguments[0].carrier.id, "rust.js.JsArray");
        const input = fact.abi.targetArguments[0].elements[0];
        assert.equal(input.conversion.conversion.kind, "rest-sequence");
        assert.deepEqual(input.conversion.targetCarrier, { kind: "array", element: {
          kind: "source-primitive", name: element === "number" ? "float64" : element,
        } });
      }
      source.ast.forEachChild(node, child => { visit(child); });
    };
    const file = program.sourceFiles.find(file => source.ast.getFileName(file).endsWith("index.ts"));
    assert.ok(file);
    visit(file);
    assert.equal(calls, 1);
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
      assert.equal(fact.abi.sourceArguments[0].form, "value");
      assert.deepEqual(fact.abi.sourceArguments[0].carrier, { kind: "source-primitive", name: "uint8" });
    }
    source.ast.forEachChild(node, child => { visit(child); });
  };
  const file = program.sourceFiles.find(file => source.ast.getFileName(file).endsWith("index.ts"));
  assert.ok(file);
  visit(file);
  assert.equal(calls, 1);
});
