import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustObjectLiteralEmission } from "../../../dist/analysis/objects/object-literal-emission.js";

test("object literal admission never requests property syntax from a non-object source node", () => {
  const file = {};
  const parameter = {};
  let propertyReads = 0;
  const program = {
    source: { ast: { is: { IsObjectLiteralExpression: () => false }, properties() { propertyReads++; throw new Error("non-object property read"); } } },
    records: { targetOperation: { get: () => undefined } },
    sourceFiles: [],
  };
  const issues = analyzeRustObjectLiteralEmission(program, [file, parameter], {}, () => undefined, () => undefined, program.source);
  assert.equal(issues.length, 0, "unrelated admitted source nodes are not object literals");
  assert.equal(propertyReads, 0, "the checked syntax predicate precedes every property lookup");
});
