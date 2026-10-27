import { requireRustRecord } from "../../program/records/objects/required-records.js";
import type { RustOperationAnalysisContext } from "../../program/operation-context.js";
import type { RustCheckedOperatorSelectionInput, RustCheckedOperationSelectionResult, RustCheckedCallSelectionInput, RustCheckedCallSelectionResult, RustPolicySelection } from "../../../policy/model/contracts.js";
import { acceptRustPolicy } from "../../../policy/model/contracts.js";
import type { RustOperationsProviderOptions } from "./model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustSelectedTargetOperation } from "../../../target-model/records/operations/member-selections.js";
import { resolveRustInstanceType } from "../../source-evidence/types/resolution/instance-tests.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";
import { rustSourcePrimitiveTargetType } from "../../../target-model/types/index.js";
import { selectRustClosedTypeTestPlan } from "../../../policy/operations/operators/type-tests.js";
import { rejectSelectedOperation } from "./result.js";
import { acceptRustOperation } from "../../program/records/operations/selected-operation-values.js";
import { selectedValueCarrier } from "../selected-values.js";

import { selectedRustCallSignature } from "../../program/records/calls/selected-call.js";
import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";
import { selectRustArrayTypeGuard } from "../source-profiles/js/type-tests.js";

export function selectRustArrayTypeTest(
  request: RustCheckedCallSelectionInput,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> {
  const argument = request.source.sourceArguments[0];
  const sourceCarrier = argument === undefined ? undefined : selectedValueCarrier(argument.expression, argument.type, context, options);
  const guard = selectRustArrayTypeGuard(context, request.source, options.sourceProfiles);
  const test = sourceCarrier === undefined || guard === undefined ? undefined
    : selectRustClosedTypeTestPlan(sourceCarrier, guard.predicate, options.projectTypes, context.typeDefinitions);
  if (request.source.sourceArguments.length !== 1 || argument === undefined || context.ast.is.IsSpreadElement(argument.expression) ||
    sourceCarrier === undefined || test === undefined || guard === undefined) {
    return rejectSelectedOperation(request.source.call, context, "RUST_ARRAY_TYPE_TEST_NOT_CLOSED",
      "Array.isArray requires one exact closed native carrier and its payload test.");
  }
  const predicate = guard.predicate;
  const operationId = `tsonic.rust.closed-type-test.${closedMetadataKey(predicate)}`;
  const resultCarrier = rustSourcePrimitiveTargetType("bool");
  const evidence = [{ message: "Rust closed array predicate retains its source storage without conversion" }];
  const selectedSignature = selectedRustCallSignature(request, {
    id: operationId, sourceName: "isArray", targetName: "closed-type-test", kind: "method", static: true,
    parameters: [{ name: "value", type: sourceCarrier, passingMode: "borrow-shared" }], returnType: resultCarrier,
  });
  const targetFact: RustTargetOperationFact = {
    kind: "closed-type-test", operationId, sourceCarrier, predicate, resultCarrier, test,
  };
  const operation: RustSelectedTargetOperation = {
    operationId, operationKind: "method", targetOperation: "closed-type-test", resultType: resultCarrier,
    provenance: { sourceExpression: request.source.call, sourceReceiver: argument.expression,
      sourceCallee: request.source.sourceCallee.expression, sourceSelectedSignature: request.source.selectedSignature,
      sourceSelectedDeclaration: request.sourceSelectedDeclaration },
  };
  requireRustRecord(context.requiredRecords, "argumentPassing", argument.expression, "borrow-shared", "analysis/operations/members/type-tests.ts");
  context.records.argumentPassingPlans.pass(argument.expression, "borrow-shared");
  return acceptRustPolicy({ selectedSignature, targetFact, operation }, evidence);
}

export function selectRustClosedTypeTest(
  request: RustCheckedOperatorSelectionInput,
  sourceCarrier: TargetTypeRef,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> | undefined {
  const targetCarrier = request.right === undefined ? undefined : resolveRustInstanceType(
    request.sourceRightDeclaration, request.right, context, options);
  if (targetCarrier === undefined) return undefined;
  const predicate = Object.freeze({ kind: "nominal" as const, targetCarrier });
  const test = selectRustClosedTypeTestPlan(sourceCarrier, predicate, options.projectTypes, context.typeDefinitions);
  if (test === undefined) return undefined;
  const resultCarrier = rustSourcePrimitiveTargetType("bool");
  return acceptRustOperation({
    kind: "closed-type-test", operationId: `tsonic.rust.closed-type-test.${closedMetadataKey(predicate)}`,
    sourceCarrier, predicate, resultCarrier, test,
  }, { sourceExpression: request.expression, sourceReceiver: request.left,
    sourceSelectedDeclaration: request.sourceRightDeclaration }, resultCarrier);
}
