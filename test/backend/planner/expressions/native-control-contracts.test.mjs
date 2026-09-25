import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { rustTargetOperationFactKey } from "../../../../dist/analysis/facts/keys.js";
import { planRustNativeControl } from "../../../../dist/backend/planner/expressions/native-controls.js";

test("native propagation retains its exact operand, result and authored callable boundary", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { propagate } from "@tsonic/rust/lang.js";
import { Result } from "@tsonic/rust/core/result.js";
export function forward(value: Result<int32, int32>): Result<int32, int32> {
  return Result.Ok<int32, int32>(propagate(value));
}
` } });
  const occurrences = [];
  const visit = node => {
    const fact = program.facts.getFact(node, rustTargetOperationFactKey);
    if (fact?.kind === "native-propagation") occurrences.push({ node, fact });
    for (const child of program.source.ast.children(node)) visit(child);
  };
  for (const file of program.sourceFiles) visit(file);
  assert.equal(occurrences.length, 1);
  const { node, fact } = occurrences[0];
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
