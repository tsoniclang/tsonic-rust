import assert from "node:assert/strict";
import test from "node:test";
import { createRustSession } from "../../../helpers/rust-session.mjs";
import { rustSourceCallableReturnFactKey } from "../../../../dist/analysis/facts/keys.js";
import { planRustNativeControl } from "../../../../dist/backend/planner/expressions/native-controls.js";
import { rustNamedTargetType } from "../../../../dist/target-model/types/index.js";
import { emptyRustTypeDefinitions } from "../../../../dist/target-model/types/source-union-definitions.js";

test("native propagation validates sealed operand, result and authored callable boundary", () => {
  const harness = createRustSession({ files: { "index.ts": `
declare function selected(value: number): number;
export function forward(value: number): number { return selected(value); }
` } });
  const source = harness.session.checkSource();
  const calls = [];
  const visit = node => {
    if (source.ast.is.IsCallExpression(node)) calls.push(node);
    for (const child of source.ast.children(node)) visit(child);
  };
  for (const file of source.sourceFiles) if (file !== undefined && !file.IsDeclarationFile) visit(file);
  assert.equal(calls.length, 1);
  const node = calls[0];
  let callableDeclaration = source.ast.parent(node);
  while (!source.ast.is.IsFunctionDeclaration(callableDeclaration)) callableDeclaration = source.ast.parent(callableDeclaration);
  const operandExpression = source.ast.arguments(node)[0];
  const scalar = { kind: "source-primitive", name: "int32" };
  const result = rustNamedTargetType("fixture.Result", "core::result::Result",
    [{ kind: "type", type: scalar }, { kind: "type", type: scalar }]);
  const fact = Object.freeze({ kind: "native-propagation", operationId: "tsonic.rust.propagate",
    callableDeclaration, callableReturnCarrier: result, operandExpression,
    operandCarrier: result, operandErrorCarrier: scalar, resultErrorCarrier: scalar, resultCarrier: scalar });
  const program = Object.freeze({ source, typeDefinitions: emptyRustTypeDefinitions,
    facts: Object.freeze({
      getRuntimeCarrierFact: selected => selected === operandExpression ? { carrier: result } : undefined,
      getFact: (selected, key) => selected === callableDeclaration && key === rustSourceCallableReturnFactKey
        ? { returnCarrier: result } : undefined,
    }) });
  harness.targetSession.close();
  const context = () => ({ input: { program }, diagnostics: [],
    sourceFile: program.source.ast.getSourceFile(node), callableDeclaration: fact.callableDeclaration,
    moduleName: "index", usedAliases: new Set(), moduleNameByFileName: new Map(),
    externalCrateNameByFileName: new Map(), externalItemPathByIdentity: new Map(),
    externalStructuralShapeModuleByFileName: new Map(), structuralShapesModuleName: "shapes" });
  const planned = planRustNativeControl(node, fact, context(), () => ({ kind: "path", path: "value" }));
  assert.equal(planned.kind, "try");
  assert.equal(planned.nativeReturn, true);
  for (const mutation of [
    { operandExpression: node },
    { callableDeclaration: node },
    { callableReturnCarrier: fact.resultCarrier },
    { operandErrorCarrier: fact.operandCarrier },
    { resultErrorCarrier: fact.callableReturnCarrier },
    { resultCarrier: fact.operandCarrier },
  ]) {
    const selected = context();
    assert.equal(planRustNativeControl(node, { ...fact, ...mutation }, selected,
      () => ({ kind: "path", path: "value" })), undefined);
    assert.equal(selected.diagnostics.length, 1);
    assert.equal(selected.diagnostics[0].code, "RUST_MISSING_TARGET_FACT");
  }
});
