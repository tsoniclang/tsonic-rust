import assert from "node:assert/strict";
import test from "node:test";
import { createCompilerSessionFromFiles } from "@tsonic/tsts";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { closedNativeAbsenceGuardPolicySource } from "../../../../tsonic/test/fixtures/closed-native-absence-guards.mjs";
import { selectRustNativeGuardResult } from "../../../dist/policy/types/resolution/native-flow-refinement.js";
import { rustAbsenceTargetType, rustTsValueTargetType, rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/carriers/native.js";
import { rustJsValueTargetType } from "../../../dist/target-model/types/carriers/js.js";
import { rustOptionTargetType } from "../../../dist/target-model/types/carriers/optional.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";

test("absence folding requires native absence admission, not an object runtime category", () => {
  const checked = createCompilerSessionFromFiles({ currentDirectory: "/src", files: {
    "/src/index.ts": closedNativeAbsenceGuardPolicySource,
  }, compilerOptions: { strict: true, module: "esnext" } }).checkSource();
  assert.equal(checked.diagnostics.length, 0);
  const source = createTargetSourceProgram(checked);
  const context = { ast: source.ast, navigation: source.navigation, sourceFacts: source.sourceFacts,
    semanticsFor: node => source.semantics.forNode(node) };
  const expressions = [];
  const visit = node => {
    if (source.ast.is.IsIfStatement(node)) expressions.push(source.ast.as.AsIfStatement(node).Expression);
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  visit(checked.getSourceFile("/src/index.ts"));
  assert.equal(expressions.length, 4);
  const select = carrier => expressions.map(expression => selectRustNativeGuardResult(context, expression, () => carrier,
    { definitionForCarrier: () => undefined }, emptyRustTypeDefinitions));
  for (const carrier of [rustTsValueTargetType(), rustJsValueTargetType(),
    rustOptionTargetType(rustSourcePrimitiveTargetType("int64"))]) {
    assert.deepEqual(select(carrier), [undefined, undefined, undefined, undefined]);
  }
  assert.deepEqual(select(rustAbsenceTargetType()), [true, false, true, false]);
  assert.deepEqual(select(rustSourcePrimitiveTargetType("int64")), [false, true, false, true]);
});
