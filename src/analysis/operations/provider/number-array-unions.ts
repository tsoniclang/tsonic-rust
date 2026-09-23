import type {
  RustCheckedElementSelectionInput,
  RustCheckedPropertySelectionInput,
  RustCheckedOperationSelectionResult,
  RustOperationPolicyContext,
  RustPolicySelection,
} from "../../../policy/operations/contracts.js";
import type { RustOperationsProviderOptions } from "./model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { isRustNumberArrayUnion } from "../../../target-model/types/carriers/array-unions.js";
import { resolveSelectedJsSourceMember, resolveSelectedSourceProfilePropertyMembers } from "../../../policy/evidence/selected-source.js";
import { selectRustNumberArrayUnionOperation } from "../../../policy/operations/js-surface/number-array-unions.js";
import { selectedValueCarrier } from "../selected-values.js";
import { finalizeProviderOperationFromSubjects } from "./conversions.js";
import { acceptRustMemberOperation, elementProvenance, rejectSelectedOperation } from "./result.js";

export function selectRustNumberArrayUnionMember(
  request: RustCheckedPropertySelectionInput | RustCheckedElementSelectionInput,
  receiverCarrier: TargetTypeRef | undefined,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> | undefined {
  if (!isRustNumberArrayUnion(receiverCarrier, context.typeDefinitions)) return undefined;
  const indexed = "argument" in request;
  const reject = (message: string): RustPolicySelection<RustCheckedOperationSelectionResult> => rejectSelectedOperation(request.expression, context,
    "RUST_NUMBER_ARRAY_UNION_MEMBER_NOT_CLOSED", message);
  if (!options.jsEnabled || request.accessMode !== "read") {
    return reject("Numeric-array union access requires the JavaScript source profile and an exact read operation.");
  }
  const semantics = context.semanticsFor(request.expression);
  const members = indexed ? (() => {
    if (request.sourceReceiverType === undefined || !semantics.types.isNumberLike(request.sourceArgumentType)) return undefined;
    const indexes = semantics.types.indexInfos(request.sourceReceiverType);
    const selected = indexes.length === 1 ? indexes[0] : undefined;
    if (selected?.keyType === undefined || selected.valueType === undefined ||
      !semantics.types.isNumberLike(selected.keyType) || !semantics.types.isNumberLike(selected.valueType)) return undefined;
    const declarations = selected.declaration === undefined ? selected.components : [selected.declaration];
    return declarations.map(declaration => resolveSelectedJsSourceMember(context, declaration, options.sourceProfiles));
  })() : resolveSelectedSourceProfilePropertyMembers(context, request.expression,
    request.sourceSelectedSymbol, request.sourceSelectedDeclaration, options.sourceProfiles)?.members;
  const first = members?.[0];
  const name = indexed ? "index" : "length";
  if (first === undefined || !members?.every(member => member?.profile === "js" &&
    ["Array", "ReadonlyArray", "TypedArray"].includes(member.ownerName) && member.memberName === name)) {
    return reject("Numeric-array union access has no exact common source-profile member identity.");
  }
  const argumentCarrier = indexed ? selectedValueCarrier(request.argument, request.sourceArgumentType, context, options) : undefined;
  const selection = selectRustNumberArrayUnionOperation({ ownerName: first.ownerName, memberName: name,
    operationKind: indexed ? "indexer" : "property", receiverCarrier,
    ...(indexed ? { argumentCarriers: [argumentCarrier] } : {}),
  }, context.typeDefinitions);
  if (selection?.fact.kind !== "provider-operation") return reject("Numeric-array union read has no closed runtime operation.");
  const arguments_ = indexed ? [request.argument] : [];
  const operation = finalizeProviderOperationFromSubjects(selection.fact, request.receiver, arguments_, context, options,
    receiverCarrier, indexed ? [argumentCarrier] : []);
  if (operation === undefined) return reject("Numeric-array union read cannot finalize one exact runtime ABI.");
  return acceptRustMemberOperation(request, indexed ? "indexer" : "property", operation, context, options,
    indexed ? elementProvenance(request) : { sourceExpression: request.expression, sourceReceiver: request.receiver,
      sourceSelectedSymbol: request.sourceSelectedSymbol, sourceSelectedDeclaration: request.sourceSelectedDeclaration });
}
