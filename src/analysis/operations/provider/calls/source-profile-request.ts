import { resolveSelectedSourceProfileMember } from "../../../../policy/evidence/selected-source.js";
import { resolveRustTargetTypeRef } from "../../../../policy/types/resolution.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { selectedCallArgumentCarriers, selectedCallArgumentNodes } from "../operators.js";
import { selectedArgumentMatchScore } from "../result.js";
import { selectedCallReceiverValueCarrier } from "./instantiation.js";
import { selectedRustRegExpReplacementCallbackEvidence } from "../regexp-replacement-callback.js";
import { canRequireSourceClone } from "../clone-requirements.js";
import { rustOperandSupportsSourceNumeric } from "../../generic-numeric.js";
import { rustEnclosingStorageContract } from "../../../../policy/ownership/suspended-storage.js";
import type { RustCheckedCallSelectionInput, RustOperationPolicyContext } from "../../../../policy/operations/contracts.js";
import type { RustOperationsProviderOptions } from "../model.js";
import type { JsOperationRequest } from "../../../../policy/operations/source-profiles/js/model.js";

export function createRustJsCallRequest(
  request: RustCheckedCallSelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): JsOperationRequest | undefined {
  const selectedSourceMember = resolveSelectedSourceProfileMember(context, request.sourceSelectedDeclaration, options.sourceProfiles);
  if (selectedSourceMember?.profile !== "js") return undefined;
  const receiverCarrier = selectedCallReceiverValueCarrier(
    request,
    context,
    options,
  );
  const argumentCarriers = selectedCallArgumentCarriers(request, context, options);
  const selectedMethodTypeArgumentCarriers =
    (request.source.sourceSelectedMethodTypeArguments ?? []).map((argument) =>
      resolveRustTargetTypeRef(
        argument.explicitTypeNode ?? argument.selectedType,
        context,
        options,
      ));
  const authoredMethodTypeArgumentCarriers =
    (request.source.sourceSelectedMethodTypeArguments ?? []).map((argument) =>
      argument.explicitTypeNode === undefined
        ? undefined
        : resolveRustTargetTypeRef(argument.explicitTypeNode, context, options));
  const sourceResultCarrier = request.source.sourceResultType === undefined
    ? undefined
    : resolveRustTargetTypeRef(request.source.sourceResultType, context, options);
  return {
    storageContract: rustEnclosingStorageContract(request.source.call, context.ast, context.sourceLifetimes),
    ownerName: selectedSourceMember.ownerName,
    memberName: selectedSourceMember.memberName,
    operationKind: "call",
    soleArgumentNumberKind: selectedSoleArgumentNumberKind(request, context),
    ...(receiverCarrier === undefined ? {} : { receiverCarrier }),
    ...(sourceResultCarrier === undefined ? {} : { sourceResultCarrier }),
    ...(argumentCarriers.length === 0 ? {} : { argumentCarriers }),
    spreadArgumentIndexes: request.source.sourceArguments.flatMap((argument, index) =>
      context.ast.is.IsSpreadElement(argument.expression) ? [index] : []),
    selectedMethodTypeArgumentCarriers,
    authoredMethodTypeArgumentCarriers,
    argumentMatchesSelectedTypeArgument: (argumentIndex, typeArgumentIndex) => {
      const argument = request.source.sourceArguments[argumentIndex];
      const typeArgument = request.source.sourceSelectedMethodTypeArguments?.[typeArgumentIndex];
      if (argument === undefined || typeArgument === undefined) return false;
      const types = context.semanticsFor(request.source.call).types;
      const value = argumentCarriers[argumentIndex];
      const parameter = selectedMethodTypeArgumentCarriers[typeArgumentIndex];
      return types.relationship(argument.type, typeArgument.selectedType) === "identical" ||
        value !== undefined && parameter !== undefined && rustTargetTypeRefEquals(value, parameter);
    },
    argumentMatchScore: selectedArgumentMatchScore(selectedCallArgumentNodes(request), context, options),
    resolveCallbackArgumentCarrier: (callback) => {
      const adapter = callback.argumentAdapter;
      return adapter?.kind === "regexp-replacement"
        ? selectedRustRegExpReplacementCallbackEvidence(
            request,
            callback.sourceArgumentIndex,
            adapter.lane,
            context,
            options,
          )?.sourceCarrier
        : undefined;
    },
    carrierSupportsProjectIdentity: options.projectCarrierSupportsObjectIdentity,
    canRequireClone: carrier => canRequireSourceClone(carrier, request.source.call, context, options.sourceTypes.typeFamilies),
    numericParameterArgument: (index, carrier, domain) => {
      const argument = selectedCallArgumentNodes(request)[index];
      return argument !== undefined && carrier.kind === "type-parameter" &&
        rustOperandSupportsSourceNumeric(argument, carrier, context, options, domain);
    },
    resultUse: context.source.navigation.expressionResultUse(request.source.call),
  };
}

export function selectedSoleArgumentNumberKind(
  request: RustCheckedCallSelectionInput,
  context: RustOperationPolicyContext,
): "number" | "non-number" | undefined {
  const argument = request.source.sourceArguments[0];
  if (request.source.sourceArguments.length !== 1 || argument === undefined) return undefined;
  const types = context.currentSemantics.types;
  const members = types.isUnion(argument.type)
    ? types.unionOrIntersectionTypes(argument.type)
    : [argument.type];
  if (members.length === 0 || members.some(member => member === undefined || types.isAny(member) || types.isUnknown(member))) {
    return undefined;
  }
  const numeric = members.map(member => types.isNumberLike(member!));
  return numeric.every(Boolean) ? "number" : numeric.every(value => !value) ? "non-number" : undefined;
}
