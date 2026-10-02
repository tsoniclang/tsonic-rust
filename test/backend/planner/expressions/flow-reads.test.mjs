import assert from "node:assert/strict";
import test from "node:test";
import { planRustFlowReadProjection, planRustValueProjection } from "../../../../dist/backend/planner/expressions/flow-reads.js";
import { rustJsValueTargetType, rustOptionTargetType, rustStringTargetType, rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";
import { emptyRustTypeDefinitions } from "../../../../dist/target-model/types/source-union-definitions.js";
import { selectRustSourceCallResult } from "../../../../dist/policy/types/resolution/call-results.js";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";

test("optional native associated values move or borrow without inventing Clone, and reject an unproved owned copy", () => {
  const selectedCarrier = { kind: "associated-type", owner: { kind: "type-parameter", identity: "Owner", name: "Owner" },
    trait: { kind: "trait-ref", id: "native::Family", path: "native::Family", genericArguments: [], associatedConstraints: [] },
    name: "Output",
  };
  const sourceCarrier = rustOptionTargetType(selectedCarrier);
  const fact = { kind: "option-value", sourceCarrier, selectedCarrier };
  const node = {};
  for (const [canMove, borrowedResult, succeeds] of [[true, false, true], [false, true, true], [false, false, false]]) {
    const diagnostics = [];
    const result = planRustFlowReadProjection(node, { kind: "path", path: "value" }, fact, {
      input: { program: {
        facts: { getRuntimeCarrierFact: () => ({ carrier: sourceCarrier }) },
        valueLifetimes: { canMove: () => canMove }, typeDefinitions: emptyRustTypeDefinitions,
        source: { ast: { getFileName: () => "", getSourceText: () => "", pos: () => -1, end: () => -1, kindName: () => "KindIdentifier" } },
      } }, diagnostics, syntheticNames: { reserved: new Set(), nextSuffixByBase: new Map() },
    }, borrowedResult);
    if (succeeds) {
      assert.equal(result.kind, "match");
      assert.equal(result.arms[0].expression.kind, "path");
      assert.deepEqual(diagnostics, []);
    } else {
      assert.equal(result, undefined);
      assert.equal(diagnostics.length, 1);
      assert.match(diagnostics[0].message, /proven non-consuming clone contract/u);
    }
  }
});

test("source-call and flow-read projections share one native payload planner with exact ownership", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": "export function value(): unknown { return 1; }" } });
  const sourceFile = program.sourceFiles[0];
  const node = program.source.ast.statements(sourceFile)[0];
  const context = () => ({ input: { program }, sourceFile, diagnostics: [], usedAliases: new Set(),
    syntheticNames: createRustSyntheticNameState(program.source.ast, node, []),
    moduleNameByFileName: new Map(), externalCrateNameByFileName: new Map(), externalItemPathByIdentity: new Map(),
    externalStructuralShapeModuleByFileName: new Map() });
  for (const selectedCarrier of [rustStringTargetType(), rustSourcePrimitiveTargetType("uint64")]) {
    const fact = selectRustSourceCallResult(program.projectTypes, rustJsValueTargetType(), () => selectedCarrier).projection;
    const expression = { kind: "call", path: "produce", args: [] };
    const owned = context();
    const result = planRustValueProjection(node, expression, fact, owned, "move");
    assert.deepEqual(owned.diagnostics, []);
    assert.equal(result.kind, "match");
    assert.equal(result.expression, expression);
    assert.equal(result.arms[0].expression.kind, "path");
    assert.doesNotMatch(JSON.stringify(result), /clone|Box::|Rc::|from_closed/u);
    const borrowed = context();
    const borrow = planRustValueProjection(node, expression, fact, borrowed, "borrow");
    assert.deepEqual(borrowed.diagnostics, []);
    assert.equal(borrow.expression.kind, "reference");
    assert.equal(borrow.expression.expr, expression);
    assert.equal(borrow.arms[0].expression.kind, "path");
    const copied = context();
    const copy = planRustValueProjection(node, expression, fact, copied, "clone");
    assert.deepEqual(copied.diagnostics, []);
    assert.equal(copy.arms[0].expression.kind, selectedCarrier.kind === "source-primitive"
      ? "dereference" : "method-call");
    if (selectedCarrier.kind !== "source-primitive") assert.equal(copy.arms[0].expression.method, "clone");
    for (const mutation of [{ variant: "Other" }, { sourceCarrier: selectedCarrier }, { extra: true }]) {
      const rejected = context();
      assert.equal(planRustValueProjection(node, expression, { ...fact, ...mutation }, rejected, "move"), undefined);
      assert.equal(rejected.diagnostics.length, 1);
    }
  }
});
