import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { rustTargetOperationFactKey, rustFlowReadProjectionFactKey } from "../../../dist/analysis/facts/keys.js";
import { rustProjectTypeTestMatches } from "../../../dist/analysis/facts/operations/type-tests.js";
import { rustFlowReadProjectionMatches } from "../../../dist/analysis/facts/flow-read-projections.js";
import { rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";

for (const surfaces of [[], ["js"]]) {
  test(`closed nominal projections require exact source, target, route and flow evidence in ${surfaces[0] ?? "native"}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
class Payload { count = 3; }
export function read(value: object): number {
  if (value instanceof Payload) return value.count;
  return 0;
}
` } });
    const tests = [];
    const projections = [];
    const visit = node => {
      const operation = program.facts.getFact(node, rustTargetOperationFactKey);
      const projection = program.facts.getFact(node, rustFlowReadProjectionFactKey);
      if (operation?.kind === "project-type-test") tests.push(operation);
      if (projection?.kind === "closed-native") projections.push(projection);
      for (const child of program.source.ast.children(node)) visit(child);
    };
    for (const file of program.sourceFiles) visit(file);
    assert.equal(tests.length, 1, "one exact closed nominal test");
    assert.equal(projections.length, 1, "one exact narrowed nominal read");
    const operation = tests[0];
    const projection = projections[0];
    const bool = rustSourcePrimitiveTargetType("bool");
    assert.equal(rustProjectTypeTestMatches(operation, program.projectTypes), true);
    for (const [label, changed] of [
      ["source", { ...operation, sourceCarrier: bool }],
      ["dispatch", { ...operation, dispatchCarrier: bool }],
      ["target", { ...operation, targetCarrier: bool }],
      ["result", { ...operation, resultCarrier: operation.sourceCarrier }],
      ["route", { ...operation, lowering: { kind: "dispatch" } }],
      ["identity", { ...operation, operationId: "forged" }],
      ["extra route field", { ...operation, lowering: { ...operation.lowering, value: true } }],
      ["extra fact field", { ...operation, unchecked: true }],
    ]) assert.equal(rustProjectTypeTestMatches(changed, program.projectTypes), false, label);
    assert.equal(rustFlowReadProjectionMatches(projection, program.projectTypes, program.typeDefinitions), true);
    assert.equal(rustFlowReadProjectionMatches({ ...projection, selectedCarrier: bool },
      program.projectTypes, program.typeDefinitions), false, "forged flow selection");
    assert.equal(rustFlowReadProjectionMatches({ ...projection, sourceCarrier: bool },
      program.projectTypes, program.typeDefinitions), false, "forged flow source");
  });
}
