import { jsRegExpSourceProfileIdentity } from "@tsonic/js-source-profile";
import {
  rustCallableProtocol,
  rustJsErrorTargetType,
  rustOptionElementCarrier,
  rustSourceMemberKeysEqual,
  rustStructuralMethodCallableCarrier,
  rustStructuralObjectCarrierValue,
  rustWellKnownSymbolSourceMemberKey,
} from "../../../target-model/types/index.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { resolveRustTargetTypeRef } from "../../../policy/types/resolution.js";
import {
  acceptSelectedCall,
  selectedCallReceiverValueCarrier,
  selectRustOptionalCallResult,
} from "./calls/instantiation.js";
import {
  selectedCallArgumentCarriers,
  selectedSourceValueCarrier,
} from "./operators.js";
import { rejectSelectedOperation } from "./result.js";
import type {
  RustCheckedCallSelectionInput,
  RustCheckedCallSelectionResult,
  RustOperationPolicyContext,
  RustPolicySelection,
} from "../../../policy/operations/contracts.js";
import type { RustOperationsProviderOptions } from "./model.js";
import type {
  RustArgumentMode,
  RustProviderConstantArgument,
  RustValueConversion,
} from "../../../target-model/operations/model.js";
import type { TargetTypeRef } from "../../../target-model/types/index.js";

type RegExpProtocolSymbol = "match" | "match-all" | "replace" | "search" | "split";

interface RegExpProtocolSelection {
  readonly operation: "match" | "matchAll" | "replace" | "replaceAll" | "search" | "split";
  readonly symbol: RegExpProtocolSymbol;
}

interface ProtocolArgumentPlan {
  readonly sourceCarrier: TargetTypeRef;
  readonly mode: RustArgumentMode;
  readonly conversion?: RustValueConversion;
}

export function mapSelectedStringRegExpProtocolCall(
  request: RustCheckedCallSelectionInput,
  ownerName: string,
  memberName: string,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> | undefined {
  const selection = selectedRegExpProtocol(ownerName, memberName);
  if (selection === undefined) {
    return undefined;
  }
  const sourceKey = rustWellKnownSymbolSourceMemberKey(selection.symbol);
  const sourceArguments = request.source.sourceArguments;
  const protocolArgument = sourceArguments[0];
  const protocolCarrier = protocolArgument === undefined
    ? undefined
    : selectedSourceValueCarrier(protocolArgument, context, options);
  const protocolShape = protocolArgument === undefined || protocolCarrier === undefined
    ? undefined
    : options.sourceTypes.structuralObjectForType(protocolArgument.type, protocolCarrier);
  const protocolFieldMatches = protocolShape?.fields.filter((field) =>
    field.method === true &&
    field.presence === "required" &&
    rustSourceMemberKeysEqual(field.sourceKey, sourceKey)) ?? [];
  const protocolField = protocolFieldMatches.length === 1 ? protocolFieldMatches[0] : undefined;
  if (protocolField === undefined) {
    return undefined;
  }
  const actualCallableCarrier = protocolField === undefined
    ? undefined
    : rustStructuralMethodCallableCarrier(
        protocolField.resultCarrier,
        protocolField.presence,
      );
  const actualCallable = rustCallableProtocol(actualCallableCarrier);
  if (protocolCarrier === undefined || protocolShape === undefined ||
    rustStructuralObjectCarrierValue(protocolCarrier) === undefined ||
    !rustTargetTypeRefEquals(protocolShape.carrier, protocolCarrier) ||
    actualCallableCarrier === undefined ||
    actualCallable === undefined) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_REGEXP_PROTOCOL_ARGUMENT_NOT_CLOSED",
      "The checker-selected String RegExp protocol argument does not resolve to one exact symbol-keyed generated object method.",
    );
  }
  if (request.source.sourceSelectedSignatureParameters[0] === undefined) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_REGEXP_PROTOCOL_SELECTION_INVALID",
      "The checker-selected String RegExp protocol overload has no exact selected protocol parameter evidence.",
    );
  }
  const receiverCarrier = selectedCallReceiverValueCarrier(request, context, options);
  const selectedOuterParameters = request.source.sourceSelectedSignatureParameters.slice(1).map((parameter) =>
    resolveRustTargetTypeRef(parameter.selectedType, context, options));
  if (receiverCarrier === undefined || actualCallable.parameters[0] === undefined ||
    !rustTargetTypeRefEquals(receiverCarrier, actualCallable.parameters[0]) ||
    selectedOuterParameters.some((carrier) => carrier === undefined) ||
    selectedOuterParameters.length !== actualCallable.parameters.length - 1 ||
    selectedOuterParameters.some((carrier, index) =>
      !rustTargetTypeRefEquals(carrier, actualCallable.parameters[index + 1]))) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_REGEXP_PROTOCOL_SIGNATURE_CONFLICT",
      "The selected String overload, source receiver, and custom RegExp protocol method do not share one exact target callable signature.",
    );
  }
  const sourceResultCarrier = resolveRustTargetTypeRef(
    request.source.sourceResultType,
    context,
    options,
  );
  const optionalResult = selectRustOptionalCallResult(
    request,
    actualCallable.result,
    context,
    options,
  );
  if (optionalResult.kind === "rejected" || sourceResultCarrier === undefined ||
    !rustTargetTypeRefEquals(optionalResult.resultCarrier, sourceResultCarrier)) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_REGEXP_PROTOCOL_RESULT_CONFLICT",
      optionalResult.kind === "rejected"
        ? optionalResult.message
        : "The custom RegExp protocol result conflicts with the exact checker-selected String call result.",
    );
  }
  const argumentCarriers = selectedCallArgumentCarriers(request, context, options);
  if (argumentCarriers.length !== sourceArguments.length ||
    argumentCarriers.some((carrier) => carrier === undefined) ||
    argumentCarriers[0] === undefined ||
    !rustTargetTypeRefEquals(argumentCarriers[0], protocolCarrier)) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_REGEXP_PROTOCOL_ARGUMENT_CARRIER_MISSING",
      "The selected String RegExp protocol call has a source argument without one exact Rust carrier.",
    );
  }
  const sourceReceiverPlan = selectProtocolArgument(receiverCarrier, actualCallable.parameters[0]);
  const forwardedPlans = sourceArguments.slice(1).map((_argument, index) => {
    const sourceCarrier = argumentCarriers[index + 1];
    const targetCarrier = actualCallable.parameters[index + 1];
    return sourceCarrier === undefined || targetCarrier === undefined
      ? undefined
      : selectProtocolArgument(sourceCarrier, targetCarrier);
  });
  if (sourceReceiverPlan === undefined || sourceReceiverPlan.conversion !== undefined ||
    forwardedPlans.some((plan) => plan === undefined)) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_REGEXP_PROTOCOL_ARGUMENT_CONVERSION_UNSUPPORTED",
      "The selected String RegExp protocol arguments cannot be passed to the exact generated method contract.",
    );
  }
  const suppliedCallableParameterCount = 1 + forwardedPlans.length;
  const missingCallableParameters = actualCallable.parameters.slice(suppliedCallableParameterCount);
  const trailingArguments: RustProviderConstantArgument[] = [];
  for (let index = 0; index < missingCallableParameters.length; index += 1) {
    const outerParameter = request.source.sourceSelectedSignatureParameters[suppliedCallableParameterCount + index];
    if (outerParameter?.acceptsOmission !== true ||
      rustOptionElementCarrier(missingCallableParameters[index]) === undefined) {
      return rejectSelectedOperation(
        request.source.call,
        context,
        "RUST_REGEXP_PROTOCOL_OMISSION_UNSUPPORTED",
        "The selected String RegExp protocol call omits a parameter that has no exact optional target contract.",
      );
    }
    trailingArguments.push({ kind: "none" });
  }
  const closedForwardedPlans = forwardedPlans as readonly ProtocolArgumentPlan[];
  return acceptSelectedCall(request, {
    kind: "provider-operation",
    operationId: `tsonic.rust.js.regexp-protocol.${selection.operation}:${closedMetadataKey(protocolCarrier)}:${protocolField.storageIndex}`,
    operationKind: "method",
    target: {
      form: "arg-structural-method",
      storageIndex: protocolField.storageIndex,
      argModes: [sourceReceiverPlan.mode, ...closedForwardedPlans.map((plan) => plan.mode)],
      argConversions: [undefined, ...closedForwardedPlans.map((plan) => plan.conversion)],
      ...(trailingArguments.length === 0 ? {} : { trailingArguments }),
    },
    parameterCarriers: [
      protocolCarrier,
      ...closedForwardedPlans.map((plan) => plan.sourceCarrier),
    ],
    resultCarrier: actualCallable.result,
    isAsync: false,
    isFallible: true,
    errorBoundary: "provider-native",
    errorCarrier: rustJsErrorTargetType(),
  }, [
    protocolCarrier,
    ...closedForwardedPlans.map((plan) => plan.sourceCarrier),
  ], context, options, {
    sourceName: memberName,
  });
}

function selectedRegExpProtocol(
  ownerName: string,
  memberName: string,
): RegExpProtocolSelection | undefined {
  if (ownerName !== jsRegExpSourceProfileIdentity.owners.string) {
    return undefined;
  }
  switch (memberName) {
    case "match": return { operation: "match", symbol: "match" };
    case "matchAll": return { operation: "matchAll", symbol: "match-all" };
    case "replace": return { operation: "replace", symbol: "replace" };
    case "replaceAll": return { operation: "replaceAll", symbol: "replace" };
    case "search": return { operation: "search", symbol: "search" };
    case "split": return { operation: "split", symbol: "split" };
    default: return undefined;
  }
}

function selectProtocolArgument(
  sourceCarrier: TargetTypeRef,
  targetCarrier: TargetTypeRef,
): ProtocolArgumentPlan | undefined {
  if (rustTargetTypeRefEquals(sourceCarrier, targetCarrier)) {
    return { sourceCarrier, mode: "value" };
  }
  if (targetCarrier.kind === "reference" &&
    rustTargetTypeRefEquals(sourceCarrier, targetCarrier.referent)) {
    return {
      sourceCarrier,
      mode: targetCarrier.mutable ? "mut-ref" : "ref",
    };
  }
  const optionalElement = rustOptionElementCarrier(targetCarrier);
  return optionalElement !== undefined && rustTargetTypeRefEquals(sourceCarrier, optionalElement)
    ? {
        sourceCarrier,
        mode: "value",
        conversion: { kind: "option-some", element: sourceCarrier },
      }
    : undefined;
}
