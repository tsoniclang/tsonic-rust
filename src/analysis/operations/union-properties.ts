import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustCheckedPropertySelectionInput, RustOperationPolicyContext, RustCheckedOperationSelectionResult,
  RustPolicySelection } from "../../policy/operations/contracts.js";
import type { RustOperationsProviderOptions } from "./provider/model.js";
import type { RustTargetOperationFact } from "../facts/keys.js";
import { selectRustGuardedValueMembers } from "./native-flow-refinement.js";
import { resolveSelectedSourceProfilePropertyMembers } from "../../policy/evidence/selected-source.js";
import { selectJsSurfaceOperation } from "../../policy/operations/source-profiles/js/index.js";
import { finalizeProviderOperationFromSubjects } from "./provider/conversions.js";
import { acceptRustMemberOperation, rejectSelectedOperation } from "./provider/result.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { closedMetadataEquals } from "../../target-model/metadata/closed-data.js";

export function selectRustUnionProperty(
  request: RustCheckedPropertySelectionInput,
  receiverCarrier: TargetTypeRef | undefined,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> | undefined {
  const union = receiverCarrier === undefined ? undefined : options.sourceTypes.sourceUnionForCarrier(receiverCarrier);
  if (union === undefined || request.accessMode !== "read" || request.optionalChain === true || !options.jsEnabled) return undefined;
  const identities = resolveSelectedSourceProfilePropertyMembers(context, request.expression,
    request.sourceSelectedSymbol, request.sourceSelectedDeclaration, options.sourceProfiles)?.members;
  if (identities === undefined || identities.length === 0 || identities.some(identity => identity.profile !== "js")) return undefined;
  const guarded = selectRustGuardedValueMembers(request.receiver, union.carrier, context, options);
  const indexes = union.variants.flatMap((variant, index) => guarded === undefined || guarded.some(member =>
    member.variant.kind === "payload" && member.variant.name === variant.name &&
    rustTargetTypeRefEquals(member.carrier, variant.carrier)) ? [index] : []);
  if (indexes.length === 0) return undefined;
  const operations = new Map<number, Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }>>();
  for (const index of indexes) {
    const variant = union.variants[index]!;
    let selected: Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }> | undefined;
    for (const identity of identities) {
      const row = selectJsSurfaceOperation({ ownerName: identity.ownerName, memberName: identity.memberName,
        operationKind: "property", receiverCarrier: variant.carrier }, context.typeDefinitions);
      const operation = row?.fact.kind !== "provider-operation" ? undefined
        : finalizeProviderOperationFromSubjects(row.fact, request.receiver, [], context, options, variant.carrier);
      if (operation === undefined || operation.abi.operationKind !== "property") return undefined;
      if (selected !== undefined && (!closedMetadataEquals(selected.abi, operation.abi) ||
        !closedMetadataEquals(selected.carrierRequirements, operation.carrierRequirements) ||
        !rustTargetTypeRefEquals(selected.resultCarrier, operation.resultCarrier))) {
        return rejectSelectedOperation(request.expression, context, "RUST_UNION_PROPERTY_CONTRACT_CONFLICT",
          "Checked native union property declarations select conflicting operation contracts.");
      }
      selected = operation;
    }
    if (selected === undefined) return undefined;
    operations.set(index, selected);
  }
  const resultCarrier = operations.get(indexes[0]!)!.resultCarrier;
  if ([...operations.values()].some(operation => !rustTargetTypeRefEquals(operation.resultCarrier, resultCarrier))) {
    return rejectSelectedOperation(request.expression, context, "RUST_UNION_PROPERTY_RESULT_CONFLICT",
      "Every selected native union property must retain one exact result carrier.");
  }
  return acceptRustMemberOperation(request, "property", Object.freeze({
    kind: "union-property", operationId: `rust.union-property:${[...operations.values()].map(operation => operation.operationId).join("+")}`,
    unionCarrier: union.carrier, selectedVariantIndexes: Object.freeze(indexes), resultCarrier,
    variants: Object.freeze(union.variants.map((variant, index) => Object.freeze({ name: variant.name, carrier: variant.carrier,
      ...(operations.has(index) ? { operation: Object.freeze(operations.get(index)!) } : {}) }))),
  }), context, options, { sourceExpression: request.expression, sourceReceiver: request.receiver,
    sourceSelectedSymbol: request.sourceSelectedSymbol, sourceSelectedDeclaration: request.sourceSelectedDeclaration,
    sourceResultType: request.sourceResultType });
}
