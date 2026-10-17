import { requireRustRecord } from "../../../program/records/required-records.js";
import type { RustOperationAnalysisContext } from "../../../program/operation-context.js";
import {
  rustCallableProtocol,
  isRustAbsenceCarrier,
  rustLifetimeGenericArgument,
  rustStrTargetType,
  rustStringTargetId,
  rustStringTargetType,
  rustTargetGenericBindingsForArguments,
  substituteRustTargetGenerics,
  rustTypeGenericArgument,
} from "../../../../target-model/types/index.js";
import { acceptRustPolicy } from "../../../../policy/operations/contracts.js";
import { selectedRustCallSignature } from "../../../program/records/selected-call.js";
import { asNode } from "../../../../policy/identities/selected-source.js";
import { selectProviderRecordArgument } from "./record-arguments.js";
import { materializeRustOmittedCallArguments } from "../../../../policy/types/callables/omitted-arguments.js";
import { isRustCVariadicArgumentCarrier } from "../../c-variadic.js";
import {
  KindCallExpression,
  KindNewExpression,
  sourceNodeIdentity,
  sourceConstructorParametersMatch,
} from "@tsonic/target-api/source";
import { normalizeSelectedArgumentCarrier, rejectSelectedOperation } from "../result.js";
import { selectRustValueCarrierReconciliation } from "../../../../policy/types/resolution/value-carrier-reconciliation.js";
import { recordRustValueCarrierReconciliation, rustEffectiveValueCarrier } from "../../../conversions/value-carrier-queries.js";
import { resolveRustTargetTypeRef } from "../../../../policy/types/resolution/index.js";

import { rustArgumentPassingMode } from "../../../callables/parameter-passing.js";
import { rustOptionElementCarrier, rustOptionValueCarrier } from "../../../../target-model/types/index.js";

import { rustTargetOperationText } from "../../../../target-model/operations/text.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { selectedCallArgumentNodes, selectedCallCalleeDeclaration, selectedCallCalleeSymbol, selectedSourceValueCarrier } from "../operators.js";
import { selectRustOptionalChain } from "../../../../policy/operations/optional-chains.js";
import { selectRustSourceValueConversion } from "../../../../policy/conversions/selection.js";
import { selectedCallSourceParameterCarriers, selectedRestSequenceIsClosed } from "./source-sequences.js";
import { resolveRustProviderGenericArgument } from "../../../../policy/types/resolution/source.js";
import {
  finalizeProviderOperationFact,
  instantiateProviderOperationTemplate,
} from "./template-instantiation.js";
import { selectReferenceReborrow, selectReceiverReferenceReborrow } from "./reference-reborrows.js";
import { selectRustProviderSourceReceiver } from "../source-qualifiers.js";
import type { InstantiatedProviderOperationTemplate } from "./template-instantiation.js";
import type { RustCheckedCallSelectionInput, RustCheckedCallSelectionResult, RustPolicySelection, RustTargetOperationSelection } from "../../../../policy/operations/contracts.js";
import type { RustProviderOperationForm, RustProviderOperationTemplate } from "../../../../target-model/operations/model.js";
import type { ProviderDeclarationIdentity } from "@tsonic/tsts";
import type { RustAppliedValueCarrierReconciliation } from "../../../../policy/types/resolution/value-carrier-reconciliation.js";
import type { RustOperationsProviderOptions } from "../model.js";
import type { RustOptionalCallGuard } from "./selection.js";
import type {
  RustTargetGenericArgument,
  RustTargetGenericParameter,
  RustTargetMember,
  TargetTypeRef,
} from "../../../../target-model/types/model.js";
import {
  rustCallScopedElisionLifetime,
  rustLifetimeKey,
} from "../../../../target-model/lifetimes/index.js";
import type { RustLifetimeRef } from "../../../../target-model/lifetimes/index.js";
import {
  rustBorrowedStringTypeParameterNames,
  rustProviderSourceArgumentMode,
} from "./provider-argument-shape.js";

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
    if (evidence === undefined || evidence.typeParameterName !== parameter.sourceName ||
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
    requireRustRecord(context.requiredRecords, "argumentPassing", argument, mode, "analysis/operations/provider/calls/instantiation.ts");
    context.records.argumentPassingPlans.pass(argument, mode);
  }
  if (optionalResult.fact !== undefined) {
    requireRustRecord(context.requiredRecords, "optionalChain", request.source.call, optionalResult.fact.operationKind, "analysis/operations/provider/calls/instantiation.ts");
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

type SelectedCallSourceCarriers =
  | {
      readonly kind: "resolved";
      readonly carriers: readonly TargetTypeRef[];
      readonly reconciliations: readonly {
        readonly sourceIndex: number;
        readonly reconciliation: RustAppliedValueCarrierReconciliation;
      }[];
    }
  | { readonly kind: "missing" }
  | {
      readonly kind: "incompatible";
      readonly sourceIndex: number;
      readonly actual?: TargetTypeRef;
      readonly expected?: TargetTypeRef;
    };

function selectedCallSourceCarriers(
  request: RustCheckedCallSelectionInput,
  fact: RustProviderOperationTemplate,
  declared: readonly (TargetTypeRef | undefined)[] | undefined,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): SelectedCallSourceCarriers {
  const declaredBySourceIndex = selectedCallSourceParameterCarriers(request, fact, declared, context, options);
  if (declaredBySourceIndex === undefined) return { kind: "missing" };
  let incompatibility: Extract<SelectedCallSourceCarriers, { readonly kind: "incompatible" }> | undefined;
  const reconciliations: {
    readonly sourceIndex: number;
    readonly reconciliation: RustAppliedValueCarrierReconciliation;
  }[] = [];
  const actual = request.source.sourceArguments.map((sourceArgument, index) => {
    const argument = sourceArgument.expression;
    const targetExpected = selectedCallArgumentTargetCarrier(fact.target, index);
    const expected = targetExpected ?? declaredBySourceIndex.get(index);
    const resolved = selectedSourceValueCarrier(sourceArgument, context, options);
    if (context.ast.is.IsSpreadElement(argument)) {
      if (!selectedRestSequenceIsClosed(request, index, resolved, fact.target)) {
        incompatibility ??= { kind: "incompatible", sourceIndex: index, actual: resolved, expected };
      }
      return resolved;
    }
    const normalized = normalizeSelectedArgumentCarrier(argument, resolved, expected, context, options);
    let effective = rustEffectiveValueCarrier(context.records, argument) ?? normalized;
    const optionElement = rustOptionElementCarrier(expected);
    if (optionElement !== undefined && effective !== undefined &&
      (isRustAbsenceCarrier(effective) || rustTargetTypeRefEquals(effective, optionElement))) {
      effective = expected;
    }
    if (effective !== undefined && expected !== undefined &&
      !rustTargetTypeRefEquals(effective, expected)) {
      const reborrow = selectReferenceReborrow(
        effective,
        expected,
        rustProviderSourceArgumentMode(fact.target, index),
      );
      if (reborrow !== undefined) {
        reconciliations.push({
          sourceIndex: index,
          reconciliation: {
            kind: "conversion",
            fact: {
              sourceCarrier: effective,
              targetCarrier: expected,
              conversion: reborrow,
            },
          },
        });
        effective = expected;
      }
    }
    if (effective !== undefined && expected !== undefined &&
      !rustTargetTypeRefEquals(effective, expected)) {
      let reconciliation = selectRustValueCarrierReconciliation(
        effective,
        expected,
        options.projectTypes, context.typeDefinitions,
      );
      if (reconciliation.kind === "incompatible" &&
        (rustProviderSourceArgumentMode(fact.target, index) ?? "value") === "value") {
        const bindings = request.source.sourceArgumentBindings.filter(binding =>
          binding.sourceArgumentIndex === index && binding.sourceForm === "value");
        const selected = bindings.length === 1 ? bindings[0] : undefined;
        const conversion = selected === undefined ? undefined : selectProviderRecordArgument(
          selected.selectedArgumentType, selected.selectedParameterType,
          effective, expected, context, options,
        );
        if (conversion !== undefined) reconciliation = { kind: "conversion", fact: {
          sourceCarrier: effective, targetCarrier: expected, conversion,
        } };
      }
      if (reconciliation.kind === "call-scoped-lifetime" ||
        reconciliation.kind === "conversion" || reconciliation.kind === "project-upcast") {
        if (reconciliation.kind === "call-scoped-lifetime" ||
          reconciliation.kind === "project-upcast" || targetExpected === undefined) {
          reconciliations.push({ sourceIndex: index, reconciliation });
          effective = expected;
        }
      } else if (reconciliation.kind === "incompatible") {
        incompatibility ??= { kind: "incompatible", sourceIndex: index, actual: effective, expected };
      }
    }
    return effective ?? expected;
  });
  if (incompatibility !== undefined) {
    return incompatibility;
  }
  if (actual.some((carrier) => carrier === undefined)) {
    return { kind: "missing" };
  }
  const resolved = {
    kind: "resolved" as const,
    carriers: actual as TargetTypeRef[],
    reconciliations,
  };
  if (fact.target.form === "call-str-slice" || fact.target.form === "free-call-str-slice") {
    const stringCarrier = rustStringTargetType();
    return actual.every((carrier) => carrier !== undefined && rustTargetTypeRefEquals(carrier, stringCarrier))
      ? resolved
      : { kind: "incompatible", sourceIndex: 0 };
  }
  if (fact.target.form === "call-value-slice" || fact.target.form === "call-value-array" ||
    fact.target.form === "receiver-value-array") {
    const form = fact.target;
    if (actual.length < form.leadingArguments.length) {
      return { kind: "incompatible", sourceIndex: actual.length };
    }
    return resolved;
  }
  if (fact.target.form === "receiver-tagged-array") {
    const form = fact.target;
    if (actual.length < form.leadingArguments.length) {
      return { kind: "incompatible", sourceIndex: actual.length };
    }
    const incompatible = actual.findIndex((carrier, sourceIndex) => {
      if (carrier === undefined) {
        return true;
      }
      if (sourceIndex < form.leadingArguments.length) {
        const target = form.leadingArguments[sourceIndex]!.carrier;
        return !rustTargetTypeRefEquals(carrier, target) &&
          selectRustSourceValueConversion(carrier, target, context.typeDefinitions) === undefined;
      }
      const exact = form.alternatives.filter((alternative) =>
        rustTargetTypeRefEquals(carrier, alternative.inputCarrier));
      const convertible = exact.length > 0
        ? []
        : form.alternatives.filter((alternative) =>
            selectRustSourceValueConversion(carrier, alternative.inputCarrier, context.typeDefinitions) !== undefined);
      return (exact.length > 0 ? exact : convertible).length !== 1;
    });
    return incompatible < 0
      ? resolved
      : { kind: "incompatible", sourceIndex: incompatible };
  }
  if (fact.target.form === "call-c-variadic") {
    const form = fact.target;
    if (actual.length < form.fixedArgumentModes.length) {
      return { kind: "incompatible", sourceIndex: actual.length };
    }
    const incompatible = actual.findIndex((carrier, sourceIndex) =>
      sourceIndex >= form.fixedArgumentModes.length &&
      !isRustCVariadicArgumentCarrier(carrier));
    return incompatible < 0
      ? resolved
      : { kind: "incompatible", sourceIndex: incompatible };
  }
  return resolved;
}

function selectedCallArgumentTargetCarrier(
  form: RustProviderOperationForm,
  sourceIndex: number,
): TargetTypeRef | undefined {
  if (form.form === "call-str-slice" || form.form === "free-call-str-slice") {
    return rustStringTargetType();
  }
  if (form.form === "call-value-slice" || form.form === "call-value-array" ||
    form.form === "receiver-value-array") {
    return sourceIndex < form.leadingArguments.length
      ? form.leadingArguments[sourceIndex]!.carrier
      : form.elementCarrier;
  }
  if (form.form === "receiver-tagged-array" && sourceIndex < form.leadingArguments.length) {
    return form.leadingArguments[sourceIndex]!.carrier;
  }
  return undefined;
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

type RustOptionalCallResult =
  | {
      readonly kind: "resolved";
      readonly resultCarrier: TargetTypeRef;
      readonly fact?: import("../../../../target-model/operations/model.js").RustOptionalChainFact;
    }
  | { readonly kind: "rejected"; readonly message: string };

export function selectRustOptionalCallResult(
  request: RustCheckedCallSelectionInput,
  innerResultCarrier: TargetTypeRef,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
  exactGuard?: RustOptionalCallGuard,
): RustOptionalCallResult {
  if (!request.source.optionalChain) {
    return { kind: "resolved", resultCarrier: innerResultCarrier };
  }
  const receiver = request.source.sourceReceiver;
  const guard = exactGuard?.guard ?? receiver?.expression ?? request.source.sourceCallee.expression;
  const receiverType = receiver === undefined ? undefined : context.currentSemantics.types.expressionType(receiver.expression);
  const sourceGuardCarrier = exactGuard?.sourceGuardCarrier ?? (receiver === undefined
    ? resolveRustTargetTypeRef(
        selectedCallCalleeDeclaration(request) ?? request.source.sourceCallee.expression,
        context,
        options,
      )
    : resolveRustTargetTypeRef(receiverType, context, options));
  const selectedGuardCarrier = exactGuard?.selectedGuardCarrier ?? (receiver === undefined
    ? resolveRustTargetTypeRef(
        request.sourceSelectedDeclaration,
        context,
        options,
      )
    : selectedCallReceiverValueCarrier(request, context, options));
  if (rustCallableProtocol(selectedGuardCarrier) === undefined &&
    selectedGuardCarrier?.kind !== "function-pointer" && receiver === undefined) {
    return {
      kind: "rejected",
      message: "Optional direct calls require exact callable selected-signature evidence.",
    };
  }
  const selection = selectRustOptionalChain({
    expression: request.source.call,
    guard,
    operationKind: "method",
    sourceGuardCarrier,
    selectedGuardCarrier,
    innerResultCarrier,
  });
  if (selection.kind === "rejected") {
    return selection;
  }
  return selection.kind === "direct"
    ? { kind: "resolved", resultCarrier: selection.resultCarrier }
    : {
        kind: "resolved",
        resultCarrier: selection.fact.resultCarrier,
        fact: selection.fact,
      };
}

export function providerFormRequiresSourceReceiver(form: RustProviderOperationForm): boolean {
  return form.form === "method" ||
    form.form === "field" ||
    form.form === "index" ||
    form.form === "free-call" ||
    form.form === "free-call-str-slice" ||
    form.form === "receiver-method" ||
    form.form === "receiver-value-array" ||
    form.form === "receiver-tagged-array" ||
    form.form === "arg-receiver-method" ||
    form.form === "arg-structural-method" ||
    (form.form === "trait-call" && form.receiverMode !== undefined);
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
