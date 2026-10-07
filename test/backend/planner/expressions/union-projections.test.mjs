import { assertNoTargetDiagnostics } from "../../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { multipleArrayRefinementSource } from "../../../../../tsonic/test/fixtures/recursive-array-refinement.mjs";
import { nativeUnionProjectionMutations } from "../../../../../tsonic/test/fixtures/native-union-projection-mutations.mjs";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { rustTargetOperationFactKey } from "../../../../dist/analysis/facts/keys.js";
import { planRustNativeUnionProjection } from "../../../../dist/backend/planner/expressions/union-projections.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";
import { rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";

test("native union projection proves every carrier and selection without copying or repeated receiver evaluation", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": multipleArrayRefinementSource } });
  const { ast } = program.source;
  const operations = [];
  const visit = node => {
    const fact = program.facts.getFact(node, rustTargetOperationFactKey);
    if (fact?.kind === "union-property") operations.push({ node, fact });
    for (const child of ast.children(node)) visit(child);
  };
  for (const sourceFile of program.sourceFiles) visit(sourceFile);
  assert.equal(operations.length, 3);
  const { node, fact } = operations[0];
  assert.ok(Object.isFrozen(fact.variants) && fact.variants.every(Object.isFrozen));
  const receiver = { kind: "path", path: "value" };
  const context = () => ({ input: { program }, diagnostics: [], sourceFile: ast.getSourceFile(node), usedAliases: new Set(),
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
  for (const mutation of mutations) {
    const rejected = context();
    assert.equal(plan({ ...fact, ...mutation }, rejected), undefined, JSON.stringify(mutation));
    assert.equal(rejected.diagnostics.length, 1);
    assert.equal(rejected.diagnostics[0].code, "RUST_MISSING_TARGET_FACT");
  }
});
