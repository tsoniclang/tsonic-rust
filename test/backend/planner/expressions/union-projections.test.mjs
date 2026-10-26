import { assertNoTargetDiagnostics } from "../../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { multipleArrayRefinementSource } from "../../../../../tsonic/test/fixtures/recursive-array-refinement.mjs";
import { nativeUnionProjectionMutations } from "../../../../../tsonic/test/fixtures/native-union-projection-mutations.mjs";
import { analyzeRust } from "../../../helpers/rust-session.mjs";

import { planRustNativeUnionProjection } from "../../../../dist/backend/planner/expressions/union-projections.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";
import { rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../../dist/target-model/types/equality.js";
import { admitRustUnionProjections } from "../../../../dist/analysis/operations/union-projections.js";

test("native union projection proves every carrier and selection without copying or repeated receiver evaluation", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": multipleArrayRefinementSource } });
  const { ast } = program.source;
  const operations = [];
  const visit = node => {
    const fact = program.records.targetOperation.get(node);
    if (fact?.kind === "union-property") operations.push({ node, fact });
    for (const child of ast.children(node)) visit(child);
  };
  for (const sourceFile of program.sourceFiles) visit(sourceFile);
  assert.equal(operations.length, 3);
  const { node, fact } = operations[0];
  assert.ok(Object.isFrozen(fact.variants) && fact.variants.every(Object.isFrozen));
  const occurrences = program.physicalEmissionContexts.sourceOccurrences.filter(occurrence => occurrence.node === node);
  assert.equal(occurrences.length, fact.selectedVariantIndexes.length, "each selected arm retains its original provider occurrence");
  for (const index of fact.selectedVariantIndexes) {
    const variant = fact.variants[index];
    const occurrence = occurrences.find(value => value.operation === variant.operation);
    assert.equal(occurrence?.receiverProjection.kind, "union-payload");
    assert.equal(occurrence.receiverProjection.union === fact, true, "the selected union identity is retained");
    assert.equal(occurrence.receiverProjection.variant === variant, true, "the selected payload identity is retained");
    const inputs = program.physicalEmissionContexts.operands.filter(operand =>
      operand.origin.kind === "call-input" && operand.origin.operation === variant.operation);
    assert.equal(inputs.length > 0, true, "the original selected arm has its physical receiver input");
    for (const input of inputs) assert.equal(rustTargetTypeRefEquals(input.carrier, variant.carrier), true,
      "physical input uses the selected arm, not the whole narrowed union");
  }
  const receiver = { kind: "path", path: "value" };
  const context = () => ({ input: { program }, diagnostics: [], sourceFile: ast.getSourceFile(node), nativeHeaderPlacement: ast.getSourceFile(node), nativeHeaderParent: undefined, usedAliases: new Set(),
    syntheticNames: createRustSyntheticNameState(ast, node, []), moduleName: "index", structuralShapesModuleName: "shapes",
    moduleNameByFileName: new Map([["/src/index.ts", "index"]]), externalCrateNameByFileName: new Map(),
    externalItemPathByIdentity: new Map(), externalStructuralShapeModuleByFileName: new Map() });
  const plan = (selected, selectedContext) => planRustNativeUnionProjection(node, receiver, selected, selectedContext,
    variant => variant.operation, payload => payload);
  const valid = context();
  const result = plan(fact, valid);
  assertNoTargetDiagnostics(valid.diagnostics);
  assert.equal(result.kind, "match");
  assert.equal(result.expression.kind, "reference");
  assert.equal(result.expression.expr, receiver);
  assert.equal(result.arms.length, fact.variants.length);
  assert.doesNotMatch(JSON.stringify(result), /clone|to_vec|collect|box/u);
  const mutations = [...nativeUnionProjectionMutations(fact, rustSourcePrimitiveTargetType("uint64")),
    { variants: fact.variants.map((variant, index) => index === fact.selectedVariantIndexes[0] ? { ...variant, name: "Wrong" } : variant) }];
  const admit = selected => admitRustUnionProjections({ ...program, records: { ...program.records,
    targetOperation: { get: subject => subject === node ? selected : program.records.targetOperation.get(subject) } } }, [node]);
  assert.doesNotThrow(() => admit(fact), "the actual canonical union contract is admitted");
  const typeContractOnly = new Set([1, 3, 4]);
  for (const [index, mutation] of mutations.entries()) {
    assert.throws(() => admit({ ...fact, ...mutation }), error => typeContractOnly.has(index)
      ? error instanceof TypeError : error.diagnostic?.code === "TSONIC_INTERNAL_ANALYSIS_INVARIANT",
    `forged union vector ${index} is rejected at admission, before renderer use`);
  }
});
