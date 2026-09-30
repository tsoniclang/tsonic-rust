import type { RustCheckedOperatorSelectionInput, RustCheckedOperationSelectionResult,
  RustOperationPolicyContext, RustPolicySelection } from "../../../policy/operations/contracts.js";
import type { RustOperationsProviderOptions } from "./model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { resolveSelectedJsSourceExportName, resolveSelectedProviderDeclaration } from "../../../policy/evidence/selected-source.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";
import { rustSourcePrimitiveTargetType } from "../../../target-model/types/index.js";
import { getRustTypeofRuntimeKind } from "../../../target-model/types/runtime-kind.js";
import { selectRustClosedTypeTestPlan } from "../../../policy/operations/operators/type-tests.js";
import { acceptRustOperation } from "./result.js";

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
  const test = selectRustClosedTypeTestPlan(sourceCarrier, targetCarrier, options.projectTypes, context.typeDefinitions);
  if (test === undefined) return undefined;
  const resultCarrier = rustSourcePrimitiveTargetType("bool");
  return acceptRustOperation(request.expression, {
    kind: "closed-type-test", operationId: `tsonic.rust.closed-type-test.${closedMetadataKey(targetCarrier)}`,
    sourceCarrier, targetCarrier, resultCarrier, test,
  }, context, { sourceExpression: request.expression, sourceReceiver: request.left,
    sourceSelectedDeclaration: request.sourceRightDeclaration }, resultCarrier);
}
