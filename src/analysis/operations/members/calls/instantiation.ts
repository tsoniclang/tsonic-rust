import { selectedCallSourceCarriers } from "./source-carriers.js";
import { providerFormRequiresSourceReceiver } from "../../../../policy/operations/members/call-inputs.js";
import { selectRustOptionalCallResult } from "./optional-results.js";
import { requireRustRecord } from "../../../program/records/objects/required-records.js";
import type { RustOperationAnalysisContext } from "../../../program/operation-context.js";
import { rustLifetimeGenericArgument, rustStrTargetType, rustStringTargetId, rustTargetGenericBindingsForArguments, substituteRustTargetGenerics, rustTypeGenericArgument } from "../../../../target-model/types/index.js";
import { acceptRustPolicy } from "../../../../policy/model/contracts.js";
import { selectedRustCallSignature } from "../../../program/records/calls/selected-call.js";
import { asNode } from "../../../../policy/identities/selected-source.js";

import { materializeRustOmittedCallArguments } from "../../../../policy/types/callables/omitted-arguments.js";

import { KindCallExpression, KindNewExpression, sourceNodeIdentity, sourceConstructorParametersMatch } from "@tsonic/target-api/source";
import { rejectSelectedOperation } from "../result.js";

import { recordRustValueCarrierReconciliation } from "../../../program/records/types/value-carrier-admission.js";
import { resolveRustTargetTypeRef } from "../../../source-evidence/types/resolution/source.js";

import { rustArgumentPassingMode } from "../../../../policy/ownership/argument-passing.js";
import { rustOptionElementCarrier, rustOptionValueCarrier } from "../../../../target-model/types/index.js";

import { rustTargetOperationText } from "../../../../target-model/operations/text.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { selectedCallArgumentNodes, selectedCallCalleeSymbol, selectedSourceValueCarrier } from "../operators.js";

import { resolveRustProviderGenericArgument } from "../../../source-evidence/types/resolution/provider-arguments.js";
import { instantiateProviderOperationTemplate } from "../../../../policy/types/callables/provider-templates.js";
import { finalizeProviderOperationFact } from "../../../program/records/native/provider-operations.js";
import { selectReceiverReferenceReborrow } from "./reference-reborrows.js";

import { selectRustProviderSourceReceiver } from "../source-qualifiers.js";
import type { InstantiatedProviderOperationTemplate } from "../../../../policy/types/callables/provider-templates.js";
import type { RustCheckedCallSelectionInput, RustCheckedCallSelectionResult, RustPolicySelection, RustTargetOperationSelection } from "../../../../policy/model/contracts.js";
import type { RustProviderOperationTemplate } from "../../../../target-model/operations/model.js";
import type { ProviderDeclarationIdentity } from "@tsonic/tsts";

import type { RustOperationsProviderOptions } from "../model.js";

import type { RustTargetGenericArgument, RustTargetGenericParameter, RustTargetMember, TargetTypeRef } from "../../../../target-model/types/model.js";
import { rustCallScopedElisionLifetime, rustLifetimeKey } from "../../../../target-model/lifetimes/index.js";
import type { RustLifetimeRef } from "../../../../target-model/lifetimes/index.js";
import { rustBorrowedStringTypeParameterNames } from "../../../../policy/types/callables/provider-argument-shape.js";

export function instantiateExactSelectedConstructionCarrier(
  definition: import("../../../../target-model/types/project-types.js").RustProjectTypeDefinition,
  targetGenericArguments: readonly RustTargetGenericArgument[],
  options: RustOperationsProviderOptions,
): TargetTypeRef | undefined {
  const parameters = definition.genericParameters.map((parameter): RustTargetGenericParameter =>
    parameter.kind === "type"
      ? { kind: "type", targetIdentity: parameter.identity, sourceName: parameter.sourceName }
      : {
          kind: "lifetime",
          sourceName: parameter.sourceName,
          targetIdentity: rustLifetimeKey(parameter.lifetime),
        });
  const substitutions = rustTargetGenericBindingsForArguments(parameters, targetGenericArguments);
  if (substitutions === undefined) return undefined;
  return substituteRustTargetGenerics(options.projectTypes.openCarrier(definition),
    substitutions.types, substitutions.lifetimes, substitutions.consts);
}

export function mapSelectedProjectGenericArguments(
  request: RustCheckedCallSelectionInput,
  genericOwner: import("@tsonic/tsts").Node,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): readonly RustTargetGenericArgument[] | undefined {
  const selected = request.source.sourceSelectedMethodTypeArguments ?? [];
  const sourceParameters = context.ast.typeParameters(genericOwner);
  if (sourceParameters.some((parameter) => parameter === undefined)) return undefined;
  if (sourceParameters.length === 0) {
    return selected.length === 0 ? Object.freeze([]) : undefined;
  }
  const contract = context.sourceLifetimes.contractFor(genericOwner);
  if (contract === undefined || selected.length !== contract.parameters.length) {
    return undefined;
  }
  const call = asNode(request.source.call, context);
  const callIdentity = call === undefined ? undefined : sourceNodeIdentity(context.ast, call);
  const arguments_ = contract.parameters.map((parameter, index) => {
    const evidence = selected[index];
    if (evidence === undefined ||
      !context.currentSemantics.facts.typeSubjects(evidence.typeParameter).some((subject) =>
        asNode(subject, context) === parameter.declaration)) {
      return undefined;
    }
    if (parameter.kind === "type") {
      const type = resolveRustTargetTypeRef(
        evidence.explicitTypeNode ?? evidence.selectedType,
        context,
        options,
      );
      return type === undefined ? undefined : rustTypeGenericArgument(type);
    }
    const lifetime = resolveSelectedLifetimeArgument(
      evidence,
      context,
      callIdentity === undefined
        ? undefined
        : rustCallScopedElisionLifetime(
            callIdentity,
            rustLifetimeKey(parameter.lifetime),
          ),
    );
    return lifetime === undefined ? undefined : rustLifetimeGenericArgument(lifetime);
  });
  return arguments_.some((argument) => argument === undefined)
    ? undefined
    : Object.freeze(arguments_ as RustTargetGenericArgument[]);
}

export function selectedProjectConstructor(
  definition: import("../../../../target-model/types/project-types.js").RustProjectTypeDefinition,
  request: RustCheckedCallSelectionInput,
  options: RustOperationsProviderOptions,
): import("../../../../target-model/types/project-types.js").RustProjectConstructorSignature | undefined {
  const exact = options.projectTypes.constructorForSignature(
    definition,
    request.source.selectedSignature,
  );
  if (exact !== undefined) {
    return exact;
  }
  const candidates = options.projectTypes.constructorsForDefinition(definition).filter(candidate =>
    sourceConstructorParametersMatch(candidate.parameters, request.source.sourceSelectedSignatureParameters));
  return candidates.length === 1 ? candidates[0] : undefined;
}

export function mapSelectedTargetTypeArguments(
  request: RustCheckedCallSelectionInput,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): readonly TargetTypeRef[] | undefined {
  const sourceArguments = request.source.sourceSelectedMethodTypeArguments;
  if (sourceArguments === undefined || sourceArguments.length === 0) {
    return undefined;
  }
  const mapped = sourceArguments.map((argument) =>
    resolveRustTargetTypeRef(argument.explicitTypeNode ?? argument.selectedType, context, options));
  return mapped.every((argument) => argument !== undefined)
    ? mapped as TargetTypeRef[]
    : undefined;
}

function resolveSelectedLifetimeArgument(
  evidence: NonNullable<
    RustCheckedCallSelectionInput["source"]["sourceSelectedMethodTypeArguments"]
  >[number],
  context: RustOperationAnalysisContext,
  inferred: RustLifetimeRef | undefined,
): RustLifetimeRef | undefined {
  return evidence.explicitTypeNode === undefined
    ? inferred
    : context.sourceLifetimes.resolve(evidence.explicitTypeNode);
}

export function instantiateSelectedCallTemplate(
  request: RustCheckedCallSelectionInput,
  template: RustProviderOperationTemplate,
  context: RustOperationAnalysisContext,
  resolutionOptions: RustOperationsProviderOptions,
): InstantiatedProviderOperationTemplate | undefined {
  const rawReceiverCarrier = selectedCallReceiverValueCarrier(
    request,
    context,
    resolutionOptions,
  );
  const selectedParameterCarriers = selectedCallParameterInferenceCarriers(
    request,
    template,
    context,
    resolutionOptions,
  );
  const selectedResultCarrier = request.source.sourceResultType === undefined
    ? undefined
    : resolveRustTargetTypeRef(request.source.sourceResultType, context, resolutionOptions);
  const generic = selectedProviderCallGenericArguments(request, template, context, resolutionOptions);
  if (generic === undefined) return undefined;
  return instantiateProviderOperationTemplate(template, {
    sourceReceiverCarrier: rawReceiverCarrier,
    sourceParameterCarriers: selectedParameterCarriers,
    sourceResultCarrier: selectedResultCarrier,
    ...generic,
  }, context.typeDefinitions);
}

export function selectedProviderCallGenericArguments(
  request: RustCheckedCallSelectionInput,
  template: RustProviderOperationTemplate,
  context: RustOperationAnalysisContext,
  resolutionOptions: RustOperationsProviderOptions,
): {
  readonly directGenericArguments: ReadonlyMap<string, RustTargetGenericArgument>;
  readonly callScopedElisionBindings?: ReadonlyMap<string, RustLifetimeRef>;
} | undefined {
  const borrowedStringTypeParameters = rustBorrowedStringTypeParameterNames(template);
  const directGenericArguments = new Map<string, RustTargetGenericArgument>();
  const call = asNode(request.source.call, context);
  const callIdentity = call === undefined ? undefined : sourceNodeIdentity(context.ast, call);
  const callScopedElisionBindings = callIdentity === undefined
    ? undefined
    : new Map((template.genericParameters ?? []).flatMap((parameter) =>
        parameter.kind !== "lifetime"
          ? []
          : [[
              parameter.targetIdentity,
              rustCallScopedElisionLifetime(callIdentity, parameter.targetIdentity),
            ] as const]));
  for (const parameter of template.genericParameters ?? []) {
    const selected = (request.source.sourceSelectedMethodTypeArguments ?? []).filter((argument) =>
      argument.typeParameterName === parameter.sourceName);
    if (selected.length > 1) return undefined;
    const argument = selected[0];
    if (argument?.explicitTypeNode === undefined) continue;
    const resolved = parameter.kind === "type"
      ? (() => {
          const type = resolveRustTargetTypeRef(
            argument.explicitTypeNode,
            context,
            resolutionOptions,
          );
          return type === undefined
            ? undefined
            : Object.freeze({
                kind: "type" as const,
                type: borrowedStringTypeParameters.has(parameter.targetIdentity) &&
                    isOwnedRustString(type)
                  ? rustStrTargetType()
                  : type,
              });
        })()
      : parameter.kind === "lifetime"
        ? (() => {
            const lifetime = resolveSelectedLifetimeArgument(
              argument,
              context,
              callScopedElisionBindings?.get(parameter.targetIdentity),
            );
            return lifetime === undefined
              ? undefined
              : rustLifetimeGenericArgument(lifetime);
          })()
        : resolveRustProviderGenericArgument(
            argument.explicitTypeNode,
            parameter,
            context,
            resolutionOptions,
          );
    if (resolved !== undefined) {
      directGenericArguments.set(parameter.targetIdentity, resolved);
    }
  }
  return {
    directGenericArguments,
    ...(callScopedElisionBindings === undefined
      ? {}
      : { callScopedElisionBindings }),
  };
}

function selectedCallParameterInferenceCarriers(
  request: RustCheckedCallSelectionInput,
  template: RustProviderOperationTemplate,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): readonly (TargetTypeRef | undefined)[] {
  const borrowedStringTypeParameters = rustBorrowedStringTypeParameterNames(template);
  return request.source.sourceSelectedSignatureParameters.map((_parameter, parameterIndex) => {
    const bindings = request.source.sourceArgumentBindings.filter((binding) =>
      binding.sourceParameterIndex === parameterIndex);
    if (bindings.length === 0 || bindings.some((binding) => binding.sourceForm !== "value")) {
      return undefined;
    }
    const sourceIndexes = [...new Set(bindings.map((binding) => binding.sourceArgumentIndex))];
    const carriers = sourceIndexes.map((sourceIndex) => {
      const sourceBindings = request.source.sourceArgumentBindings.filter((binding) =>
        binding.sourceArgumentIndex === sourceIndex);
      const argument = request.source.sourceArguments[sourceIndex];
      const selected = argument === undefined || sourceBindings.some((binding) =>
        binding.sourceParameterIndex !== parameterIndex || binding.sourceForm !== "value")
        ? undefined
        : selectedSourceValueCarrier(argument, context, options);
      const pattern = template.parameterCarriers?.[parameterIndex];
      return selected !== undefined && isOwnedRustString(selected) &&
          pattern?.kind === "type-parameter" &&
          borrowedStringTypeParameters.has(pattern.identity)
        ? rustStrTargetType()
        : selected;
    });
    const first = carriers[0];
    return first === undefined || carriers.some((carrier) =>
      carrier === undefined || !rustTargetTypeRefEquals(carrier, first))
      ? undefined
      : first;
  });
}

function isOwnedRustString(carrier: TargetTypeRef): boolean {
  return carrier.kind === "target-named" && carrier.id === rustStringTargetId;
}

export function acceptSelectedCall(
  request: RustCheckedCallSelectionInput,
  template: RustProviderOperationTemplate,
  parameterCarriers: readonly (TargetTypeRef | undefined)[] | undefined,
  context: RustOperationAnalysisContext,
  resolutionOptions: RustOperationsProviderOptions,
  callIdentity: {
    readonly sourceName: string;
    readonly providerDeclaration?: ProviderDeclarationIdentity;
  },
): RustPolicySelection<RustCheckedCallSelectionResult> {
  const instantiation = instantiateSelectedCallTemplate(
    request,
    template,
    context,
    resolutionOptions,
  );
  if (instantiation === undefined) {
    return rejectSelectedOperation(request.source.call, context, "RUST_PROVIDER_TYPE_INSTANTIATION_NOT_PROVEN", `Selected call '${callIdentity.sourceName}' does not prove one closed instantiation of its Rust provider type parameters.`);
  }
  const instantiatedTemplate = materializeRustOmittedCallArguments(request, instantiation.template, context);
  if (instantiatedTemplate === undefined) {
    return rejectSelectedOperation(request.source.call, context, "RUST_SELECTED_OPERATION_ABI_INCOMPLETE",
      `Selected call '${callIdentity.sourceName}' has no exact native contract for omitted arguments.`);
  }
  const sourceArguments = selectedCallSourceCarriers(
    request,
    instantiatedTemplate,
    instantiatedTemplate.parameterCarriers ?? parameterCarriers,
    context,
    resolutionOptions,
  );
  if (sourceArguments.kind === "missing") {
    return rejectSelectedOperation(request.source.call, context, "RUST_SELECTED_PARAMETER_CARRIER_MISSING", `Selected call '${callIdentity.sourceName}' has no closed Rust carrier for every target parameter.`);
  }
  if (sourceArguments.kind === "incompatible") {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_CALL_ARGUMENT_CONVERSION_UNSUPPORTED",
      "The TSTS-selected call argument cannot be represented by the selected Rust target parameter carrier.",
      [{
        message: `sourceArgumentIndex=${sourceArguments.sourceIndex}; actual=${JSON.stringify(sourceArguments.actual)}; expected=${JSON.stringify(sourceArguments.expected)}`,
      }],
    );
  }
  const selectedReceiverCarrier = selectedCallReceiverCarrier(
    request,
    context,
    resolutionOptions,
  );
  if (providerFormRequiresSourceReceiver(instantiatedTemplate.target) && selectedReceiverCarrier === undefined) {
    return rejectSelectedOperation(request.source.call, context, "RUST_SELECTED_RECEIVER_CARRIER_MISSING", `Selected call '${callIdentity.sourceName}' has no closed Rust receiver carrier.`);
  }
  const spreadIndexes = request.source.sourceArguments.flatMap((argument, index) =>
    context.ast.is.IsSpreadElement(argument.expression) ? [index] : []);
  const sourceReceiver = request.source.sourceReceiver;
  const receiver = sourceReceiver === undefined ? undefined
    : selectRustProviderSourceReceiver(sourceReceiver.expression, selectedReceiverCarrier, context, resolutionOptions);
  if (sourceReceiver !== undefined && receiver === undefined) {
    return rejectSelectedOperation(request.source.call, context, "RUST_SELECTED_RECEIVER_CARRIER_MISSING", `Selected call '${callIdentity.sourceName}' has no closed Rust receiver evaluation.`);
  }
  const fact = finalizeProviderOperationFact(instantiatedTemplate, sourceArguments.carriers, receiver,
    context.typeDefinitions, spreadIndexes.length === 0 ? undefined : spreadIndexes, resolutionOptions.dispatchContextInputFor);
  if (fact === undefined) {
    return rejectSelectedOperation(request.source.call, context, "RUST_SELECTED_OPERATION_ABI_INCOMPLETE", `Selected call '${callIdentity.sourceName}' cannot finalize one total Rust operation ABI.`);
  }
  const receiverReconciliation = selectReceiverReferenceReborrow(
    request,
    fact.abi,
    context,
    resolutionOptions,
  );
  const optionalResult = selectRustOptionalCallResult(
    request,
    fact.resultCarrier,
    context,
    resolutionOptions,
  );
  if (optionalResult.kind === "rejected") {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_OPTIONAL_CALL_CONTRACT_INVALID",
      optionalResult.message,
    );
  }
  const resultCarrier = optionalResult.resultCarrier;
  const preparedResult = context.records.preparedOperationResult.get(request.source.call);
  if (preparedResult !== undefined && (
    preparedResult.operationId !== fact.operationId ||
    preparedResult.operationKind !== fact.abi.operationKind ||
    !rustTargetTypeRefEquals(preparedResult.resultCarrier, resultCarrier)
  )) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_PREPARED_OPERATION_RESULT_CONFLICT",
      `Finalized call '${callIdentity.sourceName}' conflicts with its exact prepared Rust operation result.`,
      [{
        message: `prepared=${JSON.stringify(preparedResult)}; finalized=${JSON.stringify({ operationId: fact.operationId, operationKind: fact.abi.operationKind, resultCarrier })}`,
      }],
    );
  }
  const operation: RustTargetOperationSelection = {
    operationId: fact.operationId,
    operationKind: fact.abi.operationKind,
    targetOperation: rustTargetOperationText(fact),
    resultType: resultCarrier,
    provenance: {
      sourceExpression: request.source.call,
      sourceCallee: request.source.sourceCallee.expression,
      ...(sourceReceiver === undefined ? {} : { sourceReceiver: sourceReceiver.expression }),
      sourceSelectedSignature: request.source.selectedSignature,
      sourceSelectedDeclaration: request.sourceSelectedDeclaration,
      sourceSelectedSymbol: selectedCallCalleeSymbol(request),
      sourceResultType: request.source.sourceResultType,
      ...(callIdentity.providerDeclaration === undefined ? {} : { providerDeclaration: callIdentity.providerDeclaration }),
    },
  };
  const evidence = [{ message: `rust selected call ${fact.operationId}` }];
  for (const pending of sourceArguments.reconciliations) {
    const argument = selectedCallArgumentNodes(request)[pending.sourceIndex];
    if (argument === undefined) {
      return rejectSelectedOperation(
        request.source.call,
        context,
        "RUST_SELECTED_ARGUMENT_BINDING_MISSING",
        `Selected call '${callIdentity.sourceName}' has no exact source argument ${pending.sourceIndex}.`,
      );
    }
    recordRustValueCarrierReconciliation(context.records, context.requiredRecords, argument, pending.reconciliation);
  }
  if (receiverReconciliation !== undefined && request.source.sourceReceiver !== undefined) {
    recordRustValueCarrierReconciliation(
      context.records, context.requiredRecords,
      request.source.sourceReceiver.expression,
      receiverReconciliation,
    );
  }
  for (const sourceArgument of fact.abi.sourceArguments) {
    if (sourceArgument.disposition !== "runtime") {
      continue;
    }
    const argument = selectedCallArgumentNodes(request)[sourceArgument.sourceIndex];
    if (argument === undefined) {
      return rejectSelectedOperation(
        request.source.call,
        context,
        "RUST_SELECTED_ARGUMENT_BINDING_MISSING",
        `Selected call '${callIdentity.sourceName}' has no exact source argument ${sourceArgument.sourceIndex}.`,
      );
    }
    const mode = rustArgumentPassingMode(sourceArgument.mode);
    requireRustRecord(context.requiredRecords, "argumentPassing", argument, mode, "analysis/operations/members/calls/instantiation.ts");
    context.records.argumentPassingPlans.pass(argument, mode);
  }
  if (optionalResult.fact !== undefined) {
    requireRustRecord(context.requiredRecords, "optionalChain", request.source.call, optionalResult.fact.operationKind, "analysis/operations/members/calls/instantiation.ts");
    context.records.optionalChains.guard(request.source.call, optionalResult.fact.guard,
      optionalResult.fact.operationKind, optionalResult.fact);
  }
  const member: RustTargetMember = {
    id: fact.operationId,
    sourceName: callIdentity.sourceName,
    targetName: operation.targetOperation,
    kind: fact.abi.operationKind === "constructor" ? "constructor" : "method",
    parameters: fact.abi.sourceArguments.map((argument, index) => ({
      name: `arg${index}`,
      type: argument.carrier,
      passingMode: rustArgumentPassingMode(argument.mode),
    })),
    returnType: fact.resultCarrier,
    ...(callIdentity.providerDeclaration === undefined ? {} : { providerDeclaration: callIdentity.providerDeclaration }),
  };
  const selectedSignature = selectedRustCallSignature(request, member);
  return acceptRustPolicy({ selectedSignature, targetFact: fact, operation }, evidence);
}

function selectedCallReceiverCarrier(
  request: RustCheckedCallSelectionInput,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): TargetTypeRef | undefined {
  return selectedCallReceiverValueCarrier(request, context, options);
}

export function selectedCallReceiverValueCarrier(
  request: RustCheckedCallSelectionInput,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): TargetTypeRef | undefined {
  const receiver = request.source.sourceReceiver;
  if (receiver === undefined) {
    return undefined;
  }
  const storedCarrier = resolveRustTargetTypeRef(receiver.expression, context, options);
  const selectedCarrier = selectedSourceValueCarrier(receiver, context, options);
  if (!request.source.optionalChain) {
    return selectedCarrier ?? storedCarrier;
  }
  const optionElement = rustOptionElementCarrier(storedCarrier);
  if (optionElement !== undefined) {
    const presentCarrier = rustOptionValueCarrier(storedCarrier);
    return presentCarrier !== undefined && (selectedCarrier === undefined ||
        rustTargetTypeRefEquals(presentCarrier, rustOptionValueCarrier(selectedCarrier)))
      ? presentCarrier
      : undefined;
  }
  return storedCarrier !== undefined && selectedCarrier !== undefined &&
      rustTargetTypeRefEquals(storedCarrier, selectedCarrier)
    ? selectedCarrier
    : undefined;
}

export function checkedCallIsConstruction(
  request: RustCheckedCallSelectionInput,
  context: RustOperationAnalysisContext,
): boolean {
  const call = asNode(request.source.call, context);
  const callee = asNode(request.source.sourceCallee.expression, context);
  return call !== undefined && (
    context.ast.kindName(call) === KindNewExpression ||
    (context.ast.kindName(call) === KindCallExpression &&
      callee !== undefined && context.ast.kindName(callee) === "KindSuperKeyword")
  );
}
