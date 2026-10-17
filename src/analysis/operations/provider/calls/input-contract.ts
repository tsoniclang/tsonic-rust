import type { RustOperationAnalysisContext } from "../../../program/operation-context.js";
import { isProjectSourceDeclaration, resolveSelectedSourceProfileMember } from "../../../../policy/identities/selected-source.js";
import { resolveRustTypeComponentEvidence } from "../../../../policy/types/resolution/source-evidence.js";
import { selectRustProviderOperation } from "../../../../policy/operations/provider-selection.js";
import { selectJsSurfaceCallInputContract, selectJsSurfaceConstructorBySourceOwner } from "../../../../policy/operations/source-profiles/js/index.js";
import { selectedCallProviderDeclaration } from "../../../../policy/identities/selected-source.js";
import { providerOperationFact } from "../result.js";
import { checkedCallIsConstruction, instantiateSelectedCallTemplate, mapSelectedProjectGenericArguments } from "./instantiation.js";
import { selectedCallSourceParameterCarriers } from "./source-sequences.js";
import { createRustJsCallRequest, selectedSoleArgumentNumberKind } from "./source-profile-request.js";
import { selectedCallArgumentCarriers } from "../operators.js";
import { resolveRustTargetTypeRef } from "../../../../policy/types/resolution/index.js";
import { bindRustSelectedCallTypeArguments } from "../../../../policy/types/resolution/generic-arguments.js";
import { createRustPropertyProjectionSelector } from "../../../conversions/property-projections.js";
import type { RustCheckedCallSelectionInput } from "../../../../policy/operations/contracts.js";
import type { RustOperationsProviderOptions } from "../model.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";

export function selectedRustCheckedCallInputCarrier(
  request: RustCheckedCallSelectionInput,
  argumentIndex: number,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): TargetTypeRef | undefined {
  const construction = checkedCallIsConstruction(request, context);
  if (isProjectSourceDeclaration(context, request.sourceSelectedDeclaration)) {
    const bindings = request.source.sourceArgumentBindings.filter(binding => binding.sourceArgumentIndex === argumentIndex);
    const first = bindings[0];
    if (first === undefined || first.sourceForm !== "value" ||
      bindings.some(binding => binding.sourceParameterIndex !== first.sourceParameterIndex || binding.sourceForm !== "value")) return undefined;
    const parameter = request.source.sourceSelectedSignatureParameters[first.sourceParameterIndex];
    if (parameter === undefined || parameter.parameterIndex !== first.sourceParameterIndex || parameter.rest) return undefined;
    const signatureContext = { ...context, callableRepresentation: "signature" as const, sourceStorageSubject: undefined };
    const arguments_ = mapSelectedProjectGenericArguments(request, request.sourceSelectedDeclaration, signatureContext, options);
    const boundContext = arguments_ === undefined ? undefined : bindRustSelectedCallTypeArguments(
      request.source.sourceSelectedMethodTypeArguments ?? [], arguments_, signatureContext,
    );
    return boundContext === undefined ? undefined : resolveRustTypeComponentEvidence({ selectedType: parameter.selectedType,
      ...(parameter.parameterDeclaration === undefined ? {} : { declaration: parameter.parameterDeclaration }),
      ...(parameter.authoredTypeNode === undefined ? {} : { authoredTypeNode: parameter.authoredTypeNode }) },
    boundContext, options, new Set());
  }
  const sourceMember = resolveSelectedSourceProfileMember(context, request.sourceSelectedDeclaration, options.sourceProfiles);
  if (sourceMember?.profile === "js") {
    const signatureContext = { ...context, callableRepresentation: "signature" as const, sourceStorageSubject: undefined };
    if (construction) {
      const argumentCarriers = selectedCallArgumentCarriers(request, signatureContext, options);
      const selection = selectJsSurfaceConstructorBySourceOwner({
        sourceOwnerName: sourceMember.ownerName,
        typeArgumentCarriers: (request.source.sourceSelectedMethodTypeArguments ?? []).map(argument =>
          resolveRustTargetTypeRef(argument.explicitTypeNode ?? argument.selectedType, signatureContext, options)),
        argumentCarriers,
        soleArgumentNumberKind: selectedSoleArgumentNumberKind(request, signatureContext),
        propertyProjection: createRustPropertyProjectionSelector(request, signatureContext, options, argumentCarriers),
        carrierSupportsProjectIdentity: options.projectCarrierSupportsObjectIdentity,
      }, context.typeDefinitions);
      return selection?.fact.kind !== "provider-operation" ? undefined
        : selectedCallSourceParameterCarriers(request, selection.fact, selection.parameterCarriers, context, options)?.get(argumentIndex);
    }
    const nativeRequest = createRustJsCallRequest(request, signatureContext, options);
    const selection = nativeRequest === undefined ? undefined
      : selectJsSurfaceCallInputContract(nativeRequest, argumentIndex, context.typeDefinitions);
    return selection?.fact.kind !== "provider-operation" ? undefined
      : selectedCallSourceParameterCarriers(request, selection.fact, selection.parameterCarriers, context, options)?.get(argumentIndex);
  }
  if (sourceMember !== undefined) return undefined;
  const provider = selectedCallProviderDeclaration(request, context);
  if (provider.kind !== "selected") return undefined;
  const selected = selectRustProviderOperation(options.providerRows, provider.identity, construction ? "constructor" : "method");
  if (selected.kind !== "selected") return undefined;
  const instantiated = instantiateSelectedCallTemplate(request, providerOperationFact(selected.row), context, options);
  return instantiated === undefined ? undefined : selectedCallSourceParameterCarriers(
    request, instantiated.template, instantiated.template.parameterCarriers, context, options,
  )?.get(argumentIndex);
}
