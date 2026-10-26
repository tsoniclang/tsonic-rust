import { createRustRecordFixture } from "../../../helpers/records.mjs";
import { assertNoTargetDiagnostics } from "../../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";

import { planArrayLiteral } from "../../../../dist/backend/planner/expressions/array-literals/planning.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";
import { rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";
import { analyzeRustArrayLiterals } from "../../../../dist/analysis/operations/array-literals.js";
import { createRustArrayLiteralProducer } from "../../../../dist/analysis/program/records/array-literals.js";

for (const surfaces of [[], ["js"]]) {
  test(`array demand uses its selected formal instead of the constructor result on ${surfaces[0] ?? "native"}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
class Storage {
  readonly values: number[] | null;
  constructor(values: number[] | null) { this.values = values; }
}
export function make(): Storage { return new Storage([7]); }
export function returned(values: number[]): number[] { return [...values]; }
` } });
    const { ast } = program.source;
    const literals = [];
    const visit = node => {
      if (ast.is.IsArrayLiteralExpression(node)) literals.push(node);
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.forEach(visit);
    assert.equal(literals.length, 2, "both original constructor and return demand sites remain present");
    for (const node of literals) {
      assert.equal(program.records.targetOperation.get(node)?.kind, "array-literal",
        "the selected array demand publishes its exact admitted native array record");
    }
  });
}

test("array construction rejects stale contribution carriers, positions and destination storage", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
export function copy(values: int32[]): int32[] { return [...values]; }
` } });
  const { ast } = program.source;
  const operations = [];
  const visit = node => {
    const fact = program.records.targetOperation.get(node);
    if (fact?.kind === "array-literal") operations.push({ node, fact });
    for (const child of ast.children(node)) visit(child);
  };
  for (const sourceFile of program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile)) visit(sourceFile);
  assert.equal(operations.length, 1);
  const { node, fact } = operations[0];
  assert.ok(Object.isFrozen(fact.contributions));
  const context = selected => ({ input: { program: { ...program,
    records: createRustRecordFixture({
targetOperation: { get: (subject) => subject === node
    ? selected : program.records.targetOperation.get(subject) }}, program.records) } }, diagnostics: [],
    sourceFile: ast.getSourceFile(node), nativeHeaderPlacement: ast.getSourceFile(node), nativeHeaderParent: undefined, usedAliases: new Set(),
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
    let publications = 0;
    const producer = createRustArrayLiteralProducer(() => { publications += 1; });
    const issues = analyzeRustArrayLiterals(selected.input.program, [node], producer);
    assert.equal(issues.length, 1, `mutation ${index}: one admission rejection`);
    assert.equal(issues[0].code, "RUST_MISSING_TARGET_FACT", `mutation ${index}: exact diagnostic`);
    assert.equal(issues[0].sourceNode === node, true, `mutation ${index}: original source identity`);
    assert.equal(producer.records.borrowedSequenceEmission.get(input, fact.elementCarrier) === undefined, true,
      `mutation ${index}: invalid array input never reaches native rendering`);
    assert.equal(publications, 0, `mutation ${index}: no invalid or partial branch is published`);
  }
  assert.equal(accessorReads, 0);
});
