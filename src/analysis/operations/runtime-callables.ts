import { requireRustRecord } from "../program/records/objects/required-records.js";
import type { RustOperationAnalysisContext } from "../program/operation-context.js";
import { selectedRustCallSignature } from "../program/records/calls/selected-call.js";
import { rustSelectedCallTypeParameters } from "../source-evidence/types/resolution/generic-arguments.js";

import { rustStructuralMethodCallableCarrier, rustStructuralObjectCarrierValue, rustTargetGenericBindingsForArguments, substituteRustTargetGenerics } from "../../target-model/types/index.js";

import { checkedPropertySelectionInput } from "./member-access.js";
import { selectRustCheckedPropertyAccess } from "./selected-members.js";
import { acceptRustPolicy } from "../../policy/model/contracts.js";
import { checkedCallIsConstruction, selectedCallReceiverValueCarrier } from "./members/calls/instantiation.js";
import { selectRustOptionalCallResult } from "./members/calls/optional-results.js";

import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";

import { rejectSelectedOperation } from "./members/result.js";

import { resolveRustTargetTypeRef } from "../source-evidence/types/resolution/source.js";

import { rustOptionElementCarrier } from "../../target-model/types/index.js";

import { selectedValueCarrier } from "./selected-values.js";

import { selectRustRuntimeCallableGenerics } from "../../policy/types/callables/runtime-callable-generics.js";
import { rustLifetimeKey } from "../../target-model/lifetimes/index.js";

import { rustGenericCallableProtocol, rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";

import type { RustCheckedCallSelectionInput, RustCheckedCallSelectionResult, RustPolicySelection } from "../../policy/model/contracts.js";
import type { Node } from "@tsonic/tsts";
import type { RustOperationsProviderOptions } from "./members/model.js";
import type { RustTargetMember, TargetTypeRef } from "../../target-model/types/model.js";
import type { RustSelectedTargetSignature } from "../../target-model/records/operations/member-selections.js";

import { runtimeCallableProtocol } from "../../policy/types/callables/runtime-protocols.js";
import type { RustOptionalCallGuard } from "../../target-model/records/calls/optional-calls.js";
export function acceptRuntimeCallableCall(
  request: RustCheckedCallSelectionInput,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> | undefined {
  if (checkedCallIsConstruction(request, context)) {
    return undefined;
  }
  const callee = request.source.sourceCallee.expression;
  if (context.ast.kindName(callee) === "KindPropertyAccessExpression") {
    const property = context.currentSemantics.operations.propertyAccess(callee);
    if (property === undefined) return undefined;
    const selection = selectRustCheckedPropertyAccess(
      checkedPropertySelectionInput(context, callee, property),
      context,
      options,
    );
    if (selection.kind === "reject") return selection;
  }
  const optionalInvocation = context.ast.as.AsCallExpression(request.source.call)?.QuestionDotToken !== undefined;
  const selectedCarrier = selectedValueCarrier(
    request.source.sourceCallee.expression,
    request.source.sourceCallee.type,
    context,
    options,
  );
  const calleeCarrier = optionalInvocation
    ? rustOptionElementCarrier(selectedCarrier) ?? selectedCarrier : selectedCarrier;
  return acceptRuntimeCallableCarrierCall(
    request,
    calleeCarrier,
    context,
    options,
  );
}

export function acceptStructuralRuntimeMethodCall(
  request: RustCheckedCallSelectionInput,
  selectedDeclaration: Node,
  context: RustOperationAnalysisContext,
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
  if (callableCarrier === undefined) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_STRUCTURAL_METHOD_CONTRACT_INVALID",
      "The selected structural method does not have one exact public callable contract.",
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
        sourceGuardCarrier: projection.field.resultCarrier,
        selectedGuardCarrier: callableCarrier,
      }
    : undefined;
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

export function acceptRuntimeCallableCarrierCall(
  request: RustCheckedCallSelectionInput,
  calleeCarrier: TargetTypeRef | undefined,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
  sourceSelectedReceiverCarrier?: TargetTypeRef,
  sourceStructuralMethod?: RustSelectedTargetSignature["sourceStructuralMethod"],
  sourceDeclaration?: Node,
  optionalGuard?: RustOptionalCallGuard,
  sourceConstructorCarrier?: TargetTypeRef,
): RustPolicySelection<RustCheckedCallSelectionResult> | undefined {
  const generic = rustGenericCallableValue(calleeCarrier);
  const selectedGenerics = request.source.sourceSelectedMethodTypeArguments ?? [];
  const sourceParameters = rustSelectedCallTypeParameters(selectedGenerics, context);
  if (sourceParameters === undefined) return undefined;
  const protocol = generic === undefined ? runtimeCallableProtocol(calleeCarrier)
    : rustGenericCallableProtocol(calleeCarrier, sourceParameters);
  if (calleeCarrier === undefined || protocol === undefined) {
    return undefined;
  }
  const genericTypes = generic === undefined ? undefined : selectedGenerics.map(argument =>
    resolveRustTargetTypeRef(argument.explicitTypeNode ?? argument.selectedType, context, options));
  const targetGenericArguments = genericTypes === undefined ? selectRustRuntimeCallableGenerics(request, calleeCarrier, context)
    : genericTypes.some(type => type === undefined) ? undefined
      : genericTypes.map(type => ({ kind: "type" as const, type: type! }));
  if (targetGenericArguments === undefined) {
    return rejectSelectedOperation(request.source.call, context,
      "RUST_RUNTIME_CALLABLE_GENERIC_CONTRACT_CONFLICT",
      "Runtime callable generic arguments require the exact selected lifetime binder; runtime type generics are not erased.");
  }
  const genericParameters = generic !== undefined
    ? sourceParameters.map(parameter => ({ kind: "type" as const, targetIdentity: parameter.identity, sourceName: parameter.name }))
    : calleeCarrier.kind !== "closure" && calleeCarrier.kind !== "function-pointer" || calleeCarrier.lifetimeBinder === undefined ? []
    : calleeCarrier.lifetimeBinder.parameters.map((parameter, index) => ({
        kind: "lifetime" as const,
        sourceName: request.source.sourceSelectedMethodTypeArguments![index]!.typeParameterName,
        targetIdentity: rustLifetimeKey(parameter.lifetime),
      }));
  const substitutions = rustTargetGenericBindingsForArguments(genericParameters, targetGenericArguments);
  if (substitutions === undefined) return undefined;
  const instantiate = (carrier: TargetTypeRef): TargetTypeRef => substituteRustTargetGenerics(
    carrier, substitutions.types, substitutions.lifetimes, substitutions.consts,
  );
  const resultCarrier = instantiate(protocol.result);
  const parameterPlan = runtimeCallableTargetParameters(
    request,
    generic === undefined ? protocol.parameters.map(instantiate) : protocol.parameters,
    context,
  );
  if (parameterPlan === undefined) {
    return undefined;
  }
  const optionalResult = sourceStructuralMethod === undefined && sourceConstructorCarrier === undefined
    ? { kind: "resolved" as const, resultCarrier }
    : selectRustOptionalCallResult(
    request,
    resultCarrier,
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
    returnType: generic === undefined ? resultCarrier : protocol.result,
    ...(genericParameters.length === 0 ? {} : { genericParameters }),
  };
  const selectedSignature = selectedRustCallSignature(request, member, {
    sourceCallableCarrier: calleeCarrier,
    ...(sourceConstructorCarrier === undefined ? {} : { sourceConstructorCarrier }),
    ...(targetGenericArguments.length === 0 ? {} : { targetGenericArguments }),
    sourceCallableParameterIndexes: parameterPlan.sourceParameterIndexes,
    ...(sourceSelectedReceiverCarrier === undefined
      ? {}
      : { sourceSelectedReceiverCarrier }),
    ...(sourceStructuralMethod === undefined
      ? {}
      : { sourceStructuralMethod }),
    ...((sourceDeclaration ?? request.sourceSelectedDeclaration) === undefined ? {}
      : { sourceDeclaration: sourceDeclaration ?? request.sourceSelectedDeclaration }),
  });
  if (optionalResult.fact !== undefined) {
    requireRustRecord(context.requiredRecords, "optionalChain", request.source.call, optionalResult.fact.operationKind, "analysis/operations/members/calls/selection.ts");
    context.records.optionalChains.guard(request.source.call, optionalResult.fact.guard,
      optionalResult.fact.operationKind, optionalResult.fact);
  }
  return acceptRustPolicy({ selectedSignature,
    ...(optionalGuard === undefined ? {} : { sourceGuard: optionalGuard }) }, [{
    message: "rust selected exact runtime-callable invocation",
  }]);
}

function runtimeCallableTargetParameters(
  request: RustCheckedCallSelectionInput,
  targetParameters: readonly TargetTypeRef[],
  context: RustOperationAnalysisContext,
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
