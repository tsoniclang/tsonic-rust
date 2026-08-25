import {
  asNode,
  isProjectSourceDeclaration,
  resolveSelectedProviderDeclaration,
  resolveSelectedSourceProfileMember,
} from "../../../../policy/evidence/selected-source.js";
import {
  rustJsErrorTargetType,
  rustCallableSignature,
  rustStructuralMethodCallableCarrier,
  rustStructuralMethodStorageCarrier,
  rustStructuralObjectCarrierValue,
  rustStringTargetType,
} from "../../../../target-model/types/index.js";
import { acceptProjectSourceCall, mapSelectedJsSpecialCall } from "../object-shapes.js";
import { acceptRustPolicy } from "../../../../policy/operations/contracts.js";
import { acceptSelectedCall, checkedCallIsConstruction, instantiateSelectedCallTemplate, selectedCallReceiverValueCarrier, selectRustOptionalCallResult, substituteProviderOperationForm } from "./instantiation.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";
import { mapRustSourceMarkerCall } from "./deferred.js";
import { providerIdentityText, providerOperationFact, rejectSelectedOperation, selectedArgumentMatchScore } from "../result.js";
import { resolveRustTargetTypeRef } from "../../../../policy/types/resolution.js";
import { rustOptionalChainFactKey } from "../../../facts/keys.js";
import { rustOptionElementCarrier } from "../../../../target-model/types/index.js";
import { rustRuntimeCarrierKey, rustSelectedCallKey } from "../../../../target-model/facts/selections.js";
import { selectedCallArgumentCarriers, selectedCallArgumentNodes, selectedCallCalleeDeclaration, selectedCallCalleeSymbol, selectedValueCarrier } from "../operators.js";
import { selectJsSurfaceConstructorBySourceOwner, selectJsSurfaceOperation } from "../../../../policy/operations/js-surface.js";
import { selectRustGeneratorSourceCall } from "../../../../policy/types/generator-source-profile.js";
import { selectRustProviderOperation } from "../../../../policy/operations/provider-selection.js";
import { sourceCallMarkerByIdentity } from "../model.js";
import { mapSelectedStringRegExpProtocolCall } from "../regexp-protocols.js";
import { selectedRustRegExpReplacementCallbackEvidence } from "../regexp-replacement-callback.js";
import type {
  RustCheckedCallSelectionInput,
  RustCheckedCallSelectionResult,
  RustOperationPolicyContext,
  RustPolicySelection,
} from "../../../../policy/operations/contracts.js";
import type { Node } from "@tsonic/tsts";
import type { RustOperationsProviderOptions } from "../model.js";
import type { RustSelectedTargetSignature, RustTargetMember, TargetTypeRef } from "../../../../target-model/types/model.js";
import { emptyRustGenerics } from "../../../../target-model/semantics/index.js";

export function selectRustCheckedCall(
  request: RustCheckedCallSelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> {
  const providerEvidence = resolveSelectedProviderDeclaration(
    context,
    request.sourceSelectedDeclaration,
    [
      { subject: request.source.selectedSignature, precision: "exact" },
      { subject: selectedCallCalleeDeclaration(request), precision: "declaration" },
      { subject: selectedCallCalleeSymbol(request), precision: "declaration" },
    ],
  );
  if (providerEvidence.kind === "conflict") {
    return rejectSelectedOperation(request.source.call, context, "RUST_SELECTED_PROVIDER_EVIDENCE_CONFLICT", "Checked call carries conflicting selected provider declaration identities.");
  }
  const selectedSourceMember = resolveSelectedSourceProfileMember(
    context,
    request.sourceSelectedDeclaration,
    options.sourceProfiles,
  );
  const calleeSourceMember = resolveSelectedSourceProfileMember(
    context,
    selectedCallCalleeDeclaration(request),
    options.sourceProfiles,
  );
  if (selectedSourceMember === undefined && calleeSourceMember !== undefined) {
    return rejectSelectedOperation(request.source.call, context, "RUST_SELECTED_SOURCE_DECLARATION_MISSING", "Checked source-profile call has callee evidence but no exact selected declaration evidence.");
  }
  if (selectedSourceMember !== undefined && calleeSourceMember !== undefined &&
    (selectedSourceMember.profile !== calleeSourceMember.profile ||
      selectedSourceMember.ownerName !== calleeSourceMember.ownerName ||
      selectedSourceMember.memberName !== calleeSourceMember.memberName)) {
    return rejectSelectedOperation(request.source.call, context, "RUST_SELECTED_SOURCE_EVIDENCE_CONFLICT", "Checked source-profile call carries conflicting selected and callee declaration identities.");
  }
  if (providerEvidence.kind === "selected" && selectedSourceMember === undefined) {
    const provider = providerEvidence.identity;
    const sourceMarker = provider.exportId === undefined
      ? undefined
      : sourceCallMarkerByIdentity.get(`${provider.moduleSpecifier}::${provider.exportId}`);
    if (sourceMarker !== undefined) {
      return mapRustSourceMarkerCall(request, provider, sourceMarker, context, options);
    }
    const operationKind = checkedCallIsConstruction(request, context) ? "constructor" : "method";
    const selection = selectRustProviderOperation(options.providerRows, provider, operationKind);
    if (selection.kind === "missing") {
      return rejectSelectedOperation(request.source.call, context, "RUST_PROVIDER_OPERATION_NOT_MAPPED", `No Rust operation row matches selected provider declaration '${providerIdentityText(provider)}' as ${operationKind}.`);
    }
    if (selection.kind === "ambiguous") {
      return rejectSelectedOperation(request.source.call, context, "RUST_PROVIDER_OPERATION_AMBIGUOUS", `Selected provider declaration '${providerIdentityText(provider)}' matches ${selection.rows.length} Rust operation rows.`);
    }
    const instantiation = instantiateSelectedCallTemplate(
      request,
      providerOperationFact(selection.row),
      context,
      options,
    );
    if (instantiation === undefined) {
      return rejectSelectedOperation(request.source.call, context, "RUST_PROVIDER_TYPE_INSTANTIATION_NOT_PROVEN", `Selected call '${provider.memberName ?? provider.exportName ?? provider.exportId ?? provider.moduleSpecifier}' does not prove one closed instantiation of its Rust provider type parameters.`);
    }
    if (selection.row.immediateCallback !== undefined) {
      return acceptRustPolicy({
        kind: "deferred-callback",
        callback: {
          shape: "direct",
          sourceArgumentIndex: selection.row.immediateCallback.sourceArgumentIndex,
          fallibleTarget: substituteProviderOperationForm(
            selection.row.immediateCallback.fallibleTarget,
            instantiation.substitutions,
          ),
        },
        sourceName: provider.memberName ?? provider.exportName ?? provider.exportId ?? provider.moduleSpecifier,
        providerDeclaration: provider,
        template: instantiation.template,
        parameterCarriers: instantiation.template.parameterCarriers ?? [],
      });
    }
    return acceptSelectedCall(request, instantiation.template, instantiation.template.parameterCarriers, context, options, {
      sourceName: provider.memberName ?? provider.exportName ?? provider.exportId ?? provider.moduleSpecifier,
      providerDeclaration: provider,
    });
  }

  if (selectedSourceMember?.ownerName === "ErrorConstructor" &&
    selectedSourceMember.memberName === "constructor" && checkedCallIsConstruction(request, context)) {
    if (selectedCallArgumentNodes(request).length !== 1) {
      return rejectSelectedOperation(
        request.source.call,
        context,
        "RUST_ERROR_MESSAGE_REQUIRED",
        "Rust Error construction currently requires one checked string message argument.",
      );
    }
    const resultCarrier = rustJsErrorTargetType();
    return acceptSelectedCall(request, {
      kind: "provider-operation",
      operationId: "tsonic.rust.error.constructor",
      operationKind: "constructor",
      target: { form: "call", path: "rt::JsError::error", argModes: ["ref"] },
      parameterCarriers: [rustStringTargetType()],
      resultCarrier,
      isAsync: false,
      isFallible: false,
      errorBoundary: "none",
    }, [rustStringTargetType()], context, options, {
      sourceName: "Error",
    });
  }
  if (selectedSourceMember !== undefined) {
    const receiverCarrier = selectedCallReceiverValueCarrier(
      request,
      context,
      options,
    );
    const generator = selectRustGeneratorSourceCall({
      ownerName: selectedSourceMember.ownerName,
      memberName: selectedSourceMember.memberName,
      ...(receiverCarrier === undefined ? {} : { receiverCarrier }),
      selectedParameterCount: request.source.sourceSelectedSignatureParameters.length,
      argumentCarriers: selectedCallArgumentCarriers(request, context, options),
    });
    if (generator.kind === "rejected") {
      return rejectSelectedOperation(
        request.source.call,
        context,
        "RUST_GENERATOR_SOURCE_CALL_NOT_CLOSED",
        generator.message,
      );
    }
    if (generator.kind === "resolved") {
      return acceptSelectedCall(
        request,
        generator.template,
        generator.parameterCarriers,
        context,
        options,
        { sourceName: selectedSourceMember.memberName },
      );
    }
  }
  if (selectedSourceMember?.profile === "js") {
    if (!options.jsEnabled) {
      return rejectSelectedOperation(request.source.call, context, "RUST_JS_SURFACE_REQUIRED", "The selected call belongs to the explicit JavaScript source profile, which is not active.");
    }
    if (checkedCallIsConstruction(request, context)) {
      const typeArgumentCarriers = (request.source.sourceSelectedMethodTypeArguments ?? []).map((argument) =>
        resolveRustTargetTypeRef(argument.explicitTypeNode ?? argument.selectedType, context, options));
      const argumentCarriers = selectedCallArgumentCarriers(request, context, options);
      const selection = selectJsSurfaceConstructorBySourceOwner({
        sourceOwnerName: selectedSourceMember.ownerName,
        typeArgumentCarriers,
        argumentCarriers,
      });
      if (selection === undefined || selection.fact.kind !== "provider-operation" || selection.resultCarrier === undefined) {
        return rejectSelectedOperation(
          request.source.call,
          context,
          "RUST_SELECTED_OPERATION_UNSUPPORTED",
          `The selected JavaScript constructor '${selectedSourceMember.ownerName}' has no closed Rust operation row for the selected argument carriers.`,
          [{
            message: `arguments=${JSON.stringify(argumentCarriers)}; selectedTypeArguments=${JSON.stringify(typeArgumentCarriers)}`,
          }],
        );
      }
      return acceptSelectedCall(request, selection.fact, selection.parameterCarriers ?? [], context, options, {
        sourceName: selectedSourceMember.ownerName,
      });
    }
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
    const regexpProtocol = mapSelectedStringRegExpProtocolCall(
      request,
      selectedSourceMember.ownerName,
      selectedSourceMember.memberName,
      context,
      options,
    );
    if (regexpProtocol !== undefined) {
      return regexpProtocol;
    }
    const special = mapSelectedJsSpecialCall(
      request,
      selectedSourceMember.ownerName,
      selectedSourceMember.memberName,
      context,
      options,
    );
    if (special !== undefined) {
      return special;
    }
    const selection = selectJsSurfaceOperation({
      ownerName: selectedSourceMember.ownerName,
      memberName: selectedSourceMember.memberName,
      operationKind: "call",
      ...(receiverCarrier === undefined ? {} : { receiverCarrier }),
      ...(argumentCarriers.length === 0 ? {} : { argumentCarriers }),
      selectedMethodTypeArgumentCarriers,
      authoredMethodTypeArgumentCarriers,
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
      carrierSupportsProjectIdentity: (carrier) =>
        options.projectTypes.definitionForCarrier(carrier) !== undefined,
      resultUse: context.source.navigation.expressionResultUse(request.source.call),
    });
    if (selection === undefined || selection.fact.kind !== "provider-operation" || selection.resultCarrier === undefined) {
      return rejectSelectedOperation(
        request.source.call,
        context,
        "RUST_SELECTED_OPERATION_UNSUPPORTED",
        `The selected JavaScript call '${selectedSourceMember.ownerName}.${selectedSourceMember.memberName}' has no closed Rust operation row for the selected receiver and argument carriers.`,
        [{
          message: `receiver=${JSON.stringify(receiverCarrier)}; arguments=${JSON.stringify(argumentCarriers)}; selectedTypeArguments=${JSON.stringify(selectedMethodTypeArgumentCarriers)}; authoredTypeArguments=${JSON.stringify(authoredMethodTypeArgumentCarriers)}`,
        }],
      );
    }
    if (selection.callback !== undefined) {
      return selection.fact.kind !== "provider-operation"
        ? rejectSelectedOperation(request.source.call, context, "RUST_SELECTED_CALLBACK_CARRIER_MISSING", `Selected JavaScript call '${selectedSourceMember.ownerName}.${selectedSourceMember.memberName}' has no provider operation template.`)
        : acceptRustPolicy({
            kind: "deferred-callback",
            callback: selection.callback,
            sourceName: selectedSourceMember.memberName,
            template: selection.fact,
            parameterCarriers: selection.parameterCarriers ?? [],
          });
    }
    return acceptSelectedCall(request, selection.fact, selection.parameterCarriers, context, options, {
      sourceName: selectedSourceMember.memberName,
    });
  }

  const sourceDeclaration = isProjectSourceDeclaration(context, request.sourceSelectedDeclaration)
    ? asNode(request.sourceSelectedDeclaration, context)
    : undefined;
  const calleeDeclaration = isProjectSourceDeclaration(context, selectedCallCalleeDeclaration(request))
    ? asNode(selectedCallCalleeDeclaration(request), context)
    : undefined;
  const implicitConstructorClass = sourceDeclaration === undefined &&
      calleeDeclaration !== undefined &&
      checkedCallIsConstruction(request, context) &&
      context.ast.kindName(calleeDeclaration) === "KindClassDeclaration"
    ? calleeDeclaration
    : sourceDeclaration === undefined
      ? selectedImplicitSuperConstructorClass(request, context, options)
      : undefined;
  if (implicitConstructorClass !== undefined) {
    return acceptProjectSourceCall(request, implicitConstructorClass, context, options);
  }
  if (sourceDeclaration === undefined && calleeDeclaration !== undefined) {
    const runtimeCallable = acceptRuntimeCallableCall(
      request,
      context,
      options,
    );
    if (runtimeCallable !== undefined) {
      return runtimeCallable;
    }
    return rejectSelectedOperation(request.source.call, context, "RUST_SELECTED_PROJECT_DECLARATION_MISSING", "Checked project-source call has callee evidence but no exact selected callable declaration evidence.");
  }
  if (sourceDeclaration !== undefined) {
    const structuralMethod = acceptStructuralRuntimeMethodCall(
      request,
      sourceDeclaration,
      context,
      options,
    );
    if (structuralMethod !== undefined) {
      return structuralMethod;
    }
    return acceptProjectSourceCall(request, sourceDeclaration, context, options);
  }

  return rejectSelectedOperation(
    request.source.call,
    context,
    "RUST_SELECTED_CALL_EVIDENCE_MISSING",
    "Checked call has no exact provider, source-profile, or project-source selection that Rust can lower.",
  );
}

function acceptRuntimeCallableCall(
  request: RustCheckedCallSelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> | undefined {
  if (checkedCallIsConstruction(request, context)) {
    return undefined;
  }
  const calleeCarrier = selectedValueCarrier(
    request.source.sourceCallee.expression,
    request.source.sourceCallee.type,
    context,
    options,
  );
  return acceptRuntimeCallableCarrierCall(
    request,
    calleeCarrier,
    context,
    options,
  );
}

function acceptStructuralRuntimeMethodCall(
  request: RustCheckedCallSelectionInput,
  selectedDeclaration: Node,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> | undefined {
  if (checkedCallIsConstruction(request, context)) {
    return undefined;
  }
  const receiverCarrier = selectedCallReceiverValueCarrier(
    request,
    context,
    options,
  );
  if (receiverCarrier === undefined ||
    rustStructuralObjectCarrierValue(receiverCarrier) === undefined) {
    return undefined;
  }
  const projection = options.sourceTypes.structuralFieldProjectionForDeclaration(
    selectedDeclaration,
    receiverCarrier,
  );
  if (projection === undefined) {
    return undefined;
  }
  if (projection.field.method !== true) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_STRUCTURAL_METHOD_CONTRACT_INVALID",
      "The selected structural call declaration resolves to a non-method storage field.",
    );
  }
  const callableCarrier = rustStructuralMethodCallableCarrier(
    projection.field.resultCarrier,
    projection.field.presence,
  );
  const storageCarrier = rustStructuralMethodStorageCarrier(
    receiverCarrier,
    projection.field.resultCarrier,
    projection.field.presence,
  );
  const selectedStorageCarrier = projection.field.presence === "optional"
    ? rustOptionElementCarrier(storageCarrier)
    : undefined;
  if (callableCarrier === undefined || storageCarrier === undefined ||
    (projection.field.presence === "optional" && selectedStorageCarrier === undefined)) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_STRUCTURAL_METHOD_CONTRACT_INVALID",
      "The selected structural method does not have one exact public callable and receiver-bound storage contract.",
    );
  }
  if (projection.field.presence === "optional" && !request.source.optionalChain) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_OPTIONAL_STRUCTURAL_METHOD_CALL_NOT_PROVEN",
      "An optional structural method call requires exact optional-call evidence for its callable field.",
    );
  }
  const optionalGuard = projection.field.presence === "optional"
    ? {
        guard: request.source.sourceCallee.expression,
        sourceGuardCarrier: storageCarrier,
        selectedGuardCarrier: selectedStorageCarrier!,
      }
    : undefined;
  if (optionalGuard !== undefined) {
    context.facts.set(
      optionalGuard.guard,
      rustRuntimeCarrierKey,
      { carrier: optionalGuard.sourceGuardCarrier },
      [{ message: "rust exact optional structural-method storage carrier" }],
    );
  }
  return acceptRuntimeCallableCarrierCall(
    request,
    callableCarrier,
    context,
    options,
    receiverCarrier,
    {
      receiverCarrier,
      storageIndex: projection.field.storageIndex,
    },
    selectedDeclaration,
    optionalGuard,
  );
}

export interface RustOptionalCallGuard {
  readonly guard: Node;
  readonly sourceGuardCarrier: TargetTypeRef;
  readonly selectedGuardCarrier: TargetTypeRef;
}

function acceptRuntimeCallableCarrierCall(
  request: RustCheckedCallSelectionInput,
  calleeCarrier: TargetTypeRef | undefined,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
  sourceSelectedReceiverCarrier?: TargetTypeRef,
  sourceStructuralMethod?: RustSelectedTargetSignature["sourceStructuralMethod"],
  sourceDeclaration?: Node,
  optionalGuard?: RustOptionalCallGuard,
): RustPolicySelection<RustCheckedCallSelectionResult> | undefined {
  const protocol = rustCallableSignature(calleeCarrier);
  if (calleeCarrier === undefined || protocol === undefined) {
    return undefined;
  }
  const parameterPlan = runtimeCallableTargetParameters(
    request,
    protocol.parameters,
    context,
  );
  if (parameterPlan === undefined) {
    return undefined;
  }
  const optionalResult = selectRustOptionalCallResult(
    request,
    protocol.result,
    context,
    options,
    optionalGuard,
  );
  if (optionalResult.kind === "rejected") {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_OPTIONAL_CALL_CONTRACT_INVALID",
      optionalResult.message,
    );
  }
  const member: RustTargetMember = {
    id: `tsonic.rust.runtime-callable:${closedMetadataKey(calleeCarrier)}`,
    sourceName: "call",
    targetName: "call",
    kind: "method",
    parameters: parameterPlan.parameters,
    generics: emptyRustGenerics,
    returnType: protocol.result,
  };
  const selectedSignature = {
    member,
    sourceCallableCarrier: calleeCarrier,
    sourceCallableParameterIndexes: parameterPlan.sourceParameterIndexes,
    ...(sourceSelectedReceiverCarrier === undefined
      ? {}
      : { sourceSelectedReceiverCarrier }),
    ...(sourceStructuralMethod === undefined
      ? {}
      : { sourceStructuralMethod }),
    ...(sourceDeclaration === undefined ? {} : { sourceDeclaration }),
    ...(request.source.selectedSignature === undefined
      ? {}
      : { sourceSignature: request.source.selectedSignature }),
    ...(selectedCallCalleeSymbol(request) === undefined
      ? {}
      : { sourceCalleeSymbol: selectedCallCalleeSymbol(request) }),
    ...(selectedCallCalleeDeclaration(request) === undefined
      ? {}
      : { sourceCalleeDeclaration: selectedCallCalleeDeclaration(request) }),
    ...(request.source.sourceResultType === undefined
      ? {}
      : { sourceReturnType: request.source.sourceResultType }),
    sourceArgumentBindings: request.source.sourceArgumentBindings,
    sourceSelectedSignatureParameters:
      request.source.sourceSelectedSignatureParameters,
    ...(request.source.sourceSelectedMethodTypeArguments === undefined
      ? {}
      : {
          sourceSelectedMethodTypeArguments:
            request.source.sourceSelectedMethodTypeArguments,
        }),
  };
  if (optionalResult.fact !== undefined) {
    context.facts.set(
      request.source.call,
      rustOptionalChainFactKey,
      optionalResult.fact,
      [{ message: `rust optional call ${optionalResult.fact.lowering}` }],
    );
  }
  context.facts.set(request.source.call, rustSelectedCallKey, selectedSignature);
  return acceptRustPolicy({ selectedSignature }, [{
    message: "rust selected exact runtime-callable invocation",
  }]);
}

function runtimeCallableTargetParameters(
  request: RustCheckedCallSelectionInput,
  targetParameters: readonly TargetTypeRef[],
  context: RustOperationPolicyContext,
): {
  readonly parameters: readonly NonNullable<RustTargetMember["parameters"]>[number][];
  readonly sourceParameterIndexes: readonly number[];
} | undefined {
  const expanded = context.currentSemantics.operations.callParameterSlots(request.source);
  if (expanded === undefined) {
    return undefined;
  }
  if (expanded.length !== targetParameters.length) {
    return undefined;
  }
  const parameters = expanded.map((parameter, index) => {
    const type = targetParameters[index];
    return type === undefined
      ? undefined
      : {
          name: parameter.sourceParameterName || `arg${index}`,
          type,
          passingMode: "by-value" as const,
          ...(parameter.form === "optional" ? { optional: true as const } : {}),
          ...(parameter.form === "rest" ? { paramsArray: true as const } : {}),
        };
  });
  if (parameters.some((parameter) => parameter === undefined)) {
    return undefined;
  }
  return {
    parameters: parameters as readonly NonNullable<typeof parameters[number]>[],
    sourceParameterIndexes: expanded.map((parameter) => parameter.sourceParameterIndex),
  };
}


function selectedImplicitSuperConstructorClass(
  request: RustCheckedCallSelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): Node | undefined {
  if (context.ast.kindName(request.source.sourceCallee.expression) !== "KindSuperKeyword") {
    return undefined;
  }
  const containing = options.projectTypes.definitionContainingDeclaration(
    request.source.call,
  );
  if (containing?.kind !== "class") {
    return undefined;
  }
  const matches = options.projectTypes.heritageForDefinition(containing).filter((edge) =>
    edge.kind === "extends" &&
    edge.target.kind === "class" &&
    options.projectTypes.constructorForSignature(
      edge.target,
      request.source.selectedSignature,
    ) !== undefined);
  return matches.length === 1 ? matches[0]!.target.declaration : undefined;
}
