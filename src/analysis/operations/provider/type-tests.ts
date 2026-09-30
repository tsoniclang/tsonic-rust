import type { RustCheckedOperatorSelectionInput, RustCheckedOperationSelectionResult,
  RustCheckedCallSelectionInput, RustCheckedCallSelectionResult,
  RustOperationPolicyContext, RustPolicySelection } from "../../../policy/operations/contracts.js";
import { acceptRustPolicy } from "../../../policy/operations/contracts.js";
import type { RustOperationsProviderOptions } from "./model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { resolveSelectedJsSourceExportName, resolveSelectedProviderDeclaration } from "../../../policy/evidence/selected-source.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";
import { rustSourcePrimitiveTargetType } from "../../../target-model/types/index.js";
import { getRustTypeofRuntimeKind } from "../../../target-model/types/runtime-kind.js";
import { selectRustClosedTypeTestPlan } from "../../../policy/operations/operators/type-tests.js";
import { acceptRustOperation, rejectSelectedOperation } from "./result.js";
import { selectedValueCarrier } from "../selected-values.js";
import { rustArgumentPassingKey, rustSelectedCallKey, rustSelectedOperationKey } from "../../../target-model/facts/selections.js";
import { rustTargetOperationFactKey } from "../../facts/keys.js";
import { selectedRustCallSignature } from "./calls/signatures.js";

export function selectRustArrayTypeTest(
  request: RustCheckedCallSelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> {
  const argument = request.source.sourceArguments[0];
  const sourceCarrier = argument === undefined ? undefined : selectedValueCarrier(argument.expression, argument.type, context, options);
  const predicate = Object.freeze({ kind: "array" as const });
  const test = sourceCarrier === undefined ? undefined
    : selectRustClosedTypeTestPlan(sourceCarrier, predicate, options.projectTypes, context.typeDefinitions);
  if (request.source.sourceArguments.length !== 1 || argument === undefined || context.ast.is.IsSpreadElement(argument.expression) ||
    sourceCarrier === undefined || test === undefined) {
    return rejectSelectedOperation(request.source.call, context, "RUST_ARRAY_TYPE_TEST_NOT_CLOSED",
      "Array.isArray requires one exact closed native carrier and its payload test.");
  }
  const operationId = `tsonic.rust.closed-type-test.${closedMetadataKey(predicate)}`;
  const resultCarrier = rustSourcePrimitiveTargetType("bool");
  const evidence = [{ message: "Rust closed array predicate retains its source storage without conversion" }];
  const selectedSignature = selectedRustCallSignature(request, {
    id: operationId, sourceName: "isArray", targetName: "closed-type-test", kind: "method", static: true,
    parameters: [{ name: "value", type: sourceCarrier, passingMode: "borrow-shared" }], returnType: resultCarrier,
  });
  context.facts.set(request.source.call, rustTargetOperationFactKey, {
    kind: "closed-type-test", operationId, sourceCarrier, predicate, resultCarrier, test,
  }, evidence);
  context.facts.set(request.source.call, rustSelectedOperationKey, {
    operationId, operationKind: "method", targetOperation: "closed-type-test", resultType: resultCarrier,
    provenance: { sourceExpression: request.source.call, sourceReceiver: argument.expression,
      sourceCallee: request.source.sourceCallee.expression, sourceSelectedSignature: request.source.selectedSignature,
      sourceSelectedDeclaration: request.sourceSelectedDeclaration },
  }, evidence);
  context.facts.set(argument.expression, rustArgumentPassingKey, { mode: "borrow-shared", storageExpression: argument.expression }, evidence);
  context.facts.set(request.source.call, rustSelectedCallKey, selectedSignature, evidence);
  return acceptRustPolicy({ selectedSignature }, evidence);
}

export function selectRustClosedTypeTest(
  request: RustCheckedOperatorSelectionInput,
  sourceCarrier: TargetTypeRef,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> | undefined {
  const targetDefinition = options.projectTypes.definitionForDeclaration(request.sourceRightDeclaration);
  let targetCarrier: TargetTypeRef | undefined;
  if (targetDefinition?.kind === "class" && targetDefinition.genericParameters.length === 0) {
    targetCarrier = options.projectTypes.openCarrier(targetDefinition);
  } else {
    const profile = resolveSelectedJsSourceExportName(context, request.sourceRightDeclaration, options.sourceProfiles);
    const provider = resolveSelectedProviderDeclaration(context, request.sourceRightDeclaration);
    if (profile === undefined && provider.kind !== "selected" || request.right === undefined) return undefined;
    targetCarrier = request.sourceConstructorInstance;
    if (targetCarrier === undefined || getRustTypeofRuntimeKind(targetCarrier, context.typeDefinitions) !== "object") return undefined;
  }
  const predicate = Object.freeze({ kind: "nominal" as const, targetCarrier });
  const test = selectRustClosedTypeTestPlan(sourceCarrier, predicate, options.projectTypes, context.typeDefinitions);
  if (test === undefined) return undefined;
  const resultCarrier = rustSourcePrimitiveTargetType("bool");
  return acceptRustOperation(request.expression, {
    kind: "closed-type-test", operationId: `tsonic.rust.closed-type-test.${closedMetadataKey(predicate)}`,
    sourceCarrier, predicate, resultCarrier, test,
  }, context, { sourceExpression: request.expression, sourceReceiver: request.left,
    sourceSelectedDeclaration: request.sourceRightDeclaration }, resultCarrier);
}
