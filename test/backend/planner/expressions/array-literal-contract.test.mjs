import { assertNoTargetDiagnostics } from "../../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { rustTargetOperationFactKey } from "../../../../dist/analysis/facts/keys.js";
import { planArrayLiteral } from "../../../../dist/backend/planner/expressions/array-literals/planning.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";
import { rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";

test("array construction rejects stale contribution carriers, positions and destination storage", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
export function copy(values: int32[]): int32[] { return [...values]; }
` } });
  const { ast } = program.source;
  const operations = [];
  const visit = node => {
    const fact = program.facts.getFact(node, rustTargetOperationFactKey);
    if (fact?.kind === "array-literal") operations.push({ node, fact });
    for (const child of ast.children(node)) visit(child);
  };
  for (const sourceFile of program.sourceFiles) visit(sourceFile);
  assert.equal(operations.length, 1);
  const { node, fact } = operations[0];
  assert.ok(Object.isFrozen(fact.contributions));
  const context = selected => ({ input: { program: { ...program,
    facts: { ...program.facts, getFact: (subject, key) => subject === node && key === rustTargetOperationFactKey
      ? selected : program.facts.getFact(subject, key) } } }, diagnostics: [],
    sourceFile: ast.getSourceFile(node), usedAliases: new Set(),
    syntheticNames: createRustSyntheticNameState(ast, node, []),
    moduleName: "index", structuralShapesModuleName: "shapes",
    moduleNameByFileName: new Map(), externalCrateNameByFileName: new Map(),
    externalItemPathByIdentity: new Map(), externalStructuralShapeModuleByFileName: new Map(),
  });
  const valid = context(fact);
  assert.ok(planArrayLiteral(node, valid));
  assertNoTargetDiagnostics(valid.diagnostics);
  const input = fact.contributions[0].input;
  const sequence = input.inputs[0];
  const withInput = selected => ({ ...fact, contributions: [{ kind: "spread", input: selected }] });
  const withSequence = selected => withInput({ ...input, inputs: [selected] });
  let accessorReads = 0;
  const mutations = [
    { ...fact, contributions: undefined }, { ...fact, contributions: [] },
    { ...fact, contributions: new Array(1) },
    { ...fact, contributions: [{ ...fact.contributions[0], kind: "value" }] },
    { ...fact, contributions: [{ ...fact.contributions[0], carrier: rustSourcePrimitiveTargetType("int64") }] },
    { ...fact, contributions: [{ ...fact.contributions[0], conversion: undefined }] },
    { ...fact, contributions: [{ ...fact.contributions[0], conversion: { ...fact.contributions[0].conversion,
      elementTarget: rustSourcePrimitiveTargetType("int64") } }] },
    { ...fact, elementCarrier: rustSourcePrimitiveTargetType("int64") },
    { ...fact, lane: "native" }, { ...fact, length: 2 },
    { ...fact, contributions: [undefined] },
    { ...fact, contributions: [{ kind: "spread", input: undefined }] },
    { ...fact, contributions: [{ get kind() { accessorReads += 1; return "spread"; }, input }] },
    withInput({ ...input, expression: node }),
    withInput({ ...input, inputs: undefined }), withInput({ ...input, inputs: new Array(1) }),
    withInput({ ...input, inputs: [undefined] }), withInput({ ...input, controlNodes: [node] }),
    withSequence({ ...sequence, expression: node }),
    withSequence({ ...sequence, carrier: rustSourcePrimitiveTargetType("int64") }),
    withSequence({ ...sequence, presentCarrier: rustSourcePrimitiveTargetType("int64") }),
    withSequence({ ...sequence, optional: !sequence.optional }),
    withSequence({ ...sequence, conversion: undefined }),
    withSequence({ ...sequence, conversion: { ...sequence.conversion,
      elementTarget: rustSourcePrimitiveTargetType("int64") } }),
    withSequence({ ...sequence, get conversion() { accessorReads += 1; return sequence.conversion; } }),
  ];
  for (const [index, mutation] of mutations.entries()) {
    const selected = context(mutation);
    assert.equal(planArrayLiteral(node, selected) === undefined, true, `mutation ${index}`);
    assert.ok(selected.diagnostics.some(diagnostic => diagnostic.code === "RUST_MISSING_TARGET_FACT"));
  }
  assert.equal(accessorReads, 0);
});
