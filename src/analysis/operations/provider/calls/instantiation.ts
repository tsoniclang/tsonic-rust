import {
  rustCallableProtocol,
  rustLifetimeGenericArgument,
  rustStringTargetType,
  rustTargetGenericBindingsForArguments,
  substituteRustTargetGenerics,
  rustTypeGenericArgument,
} from "../../../../target-model/types/index.js";
import { acceptRustPolicy } from "../../../../policy/operations/contracts.js";
import { asNode } from "../../../../policy/evidence/selected-source.js";
import { isRustCVariadicArgumentCarrier } from "../../../facts/c-variadic.js";
import {
  KindCallExpression,
  KindNewExpression,
  sourceNodeIdentity,
} from "@tsonic/target-api/source";
import { normalizeSelectedArgumentCarrier, rejectSelectedOperation } from "../result.js";
import { selectRustValueCarrierReconciliation } from "../../../../policy/types/value-carrier-reconciliation.js";
import { recordRustValueCarrierReconciliation, rustEffectiveValueCarrier } from "../../../facts/value-carrier-queries.js";
import { resolveRustTargetTypeRef } from "../../../../policy/types/resolution.js";
import { rustArgumentPassingKey, rustSelectedCallKey, rustSelectedOperationKey } from "../../../../target-model/facts/selections.js";
import { rustArgumentPassingMode } from "../../../facts/parameter-passing.js";
import { rustOptionElementCarrier } from "../../../../target-model/types/index.js";
import { rustTargetOperationFactKey, rustPreparedOperationResultFactKey, rustOptionalChainFactKey } from "../../../facts/keys.js";
import { rustTargetOperationText } from "../../../facts/target-operation.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { selectedCallArgumentNodes, selectedCallCalleeDeclaration, selectedCallCalleeSymbol, selectedSourceValueCarrier } from "../operators.js";
import { selectRustOptionalChain } from "../../../../policy/operations/optional-chains.js";
import { selectRustSourceValueConversion } from "../../../../policy/conversions/selection.js";
import { resolveRustProviderGenericArgument } from "../../../../policy/types/resolution/source.js";
import {
  finalizeProviderOperationFact,
  instantiateProviderOperationTemplate,
} from "./template-instantiation.js";
import type { InstantiatedProviderOperationTemplate } from "./template-instantiation.js";
import type {
  RustCheckedCallSelectionInput,
  RustCheckedCallSelectionResult,
  RustOperationPolicyContext,
  RustPolicySelection,
  RustTargetOperationSelection,
} from "../../../../policy/operations/contracts.js";
import type { RustProviderOperationForm, RustProviderOperationTemplate } from "../../../facts/keys.js";
import type { ProviderDeclarationIdentity } from "@tsonic/tsts";
import type { RustAppliedValueCarrierReconciliation } from "../../../../policy/types/value-carrier-reconciliation.js";
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

export function instantiateExactSelectedConstructionCarrier(
  definition: import("../../../project-types/type-policy.js").RustProjectTypeDefinition,
  targetGenericArguments: readonly RustTargetGenericArgument[],
  options: RustOperationsProviderOptions,
): TargetTypeRef | undefined {
  const parameters = definition.genericParameters.map((parameter): RustTargetGenericParameter =>
    parameter.kind === "type"
      ? { kind: "type", sourceName: parameter.sourceName }
      : {
          kind: "lifetime",
          sourceName: parameter.sourceName,
          targetIdentity: rustLifetimeKey(parameter.lifetime),
        });
  const substitutions = rustTargetGenericBindingsForArguments(
    parameters,
    targetGenericArguments,
  );
  if (substitutions === undefined) return undefined;
  return substituteRustTargetGenerics(
    options.projectTypes.openCarrier(definition),
    substitutions.types,
    substitutions.lifetimes,
    substitutions.consts,
  );
}

export function mapSelectedProjectGenericArguments(
  request: RustCheckedCallSelectionInput,
  genericOwner: import("@tsonic/tsts").Node,
  context: RustOperationPolicyContext,
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
  definition: import("../../../project-types/type-policy.js").RustProjectTypeDefinition,
  request: RustCheckedCallSelectionInput,
  options: RustOperationsProviderOptions,
): import("../../../project-types/type-policy.js").RustProjectConstructorSignature | undefined {
  const exact = options.projectTypes.constructorForSignature(
    definition,
    request.source.selectedSignature,
  );
  if (exact !== undefined) {
    return exact;
  }
  const candidates = options.projectTypes.constructorsForDefinition(definition).filter((candidate) =>
    candidate.parameters.length === request.source.sourceSelectedSignatureParameters.length &&
    candidate.parameters.every((parameter, index) => {
      const selected = request.source.sourceSelectedSignatureParameters[index];
      return selected !== undefined &&
        parameter.parameterDeclaration === selected.parameterDeclaration &&
        parameter.acceptsOmission === selected.acceptsOmission &&
        parameter.rest === selected.rest;
    }));
  return candidates.length === 1 ? candidates[0] : undefined;
}

export function mapSelectedTargetTypeArguments(
  request: RustCheckedCallSelectionInput,
  context: RustOperationPolicyContext,
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
  context: RustOperationPolicyContext,
  inferred: RustLifetimeRef | undefined,
): RustLifetimeRef | undefined {
  return evidence.explicitTypeNode === undefined
    ? inferred
    : context.sourceLifetimes.resolve(evidence.explicitTypeNode);
}

export function instantiateSelectedCallTemplate(
  request: RustCheckedCallSelectionInput,
  template: RustProviderOperationTemplate,
  context: RustOperationPolicyContext,
  resolutionOptions: RustOperationsProviderOptions,
): InstantiatedProviderOperationTemplate | undefined {
  const rawReceiverCarrier = selectedCallReceiverValueCarrier(
    request,
    context,
    resolutionOptions,
  );
  const selectedParameterCarriers = selectedCallParameterInferenceCarriers(
    request,
    context,
    resolutionOptions,
  );
  const selectedResultCarrier = request.source.sourceResultType === undefined
    ? undefined
    : resolveRustTargetTypeRef(request.source.sourceResultType, context, resolutionOptions);
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
            : Object.freeze({ kind: "type" as const, type });
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
      directGenericArguments.set(parameter.sourceName, resolved);
    }
  }
  return instantiateProviderOperationTemplate(template, {
    sourceReceiverCarrier: rawReceiverCarrier,
    sourceParameterCarriers: selectedParameterCarriers,
    sourceResultCarrier: selectedResultCarrier,
    directGenericArguments,
    ...(callScopedElisionBindings === undefined
      ? {}
      : { callScopedElisionBindings }),
  });
}

function selectedCallParameterInferenceCarriers(
  request: RustCheckedCallSelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): readonly (TargetTypeRef | undefined)[] {
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
      return argument === undefined || sourceBindings.some((binding) =>
        binding.sourceParameterIndex !== parameterIndex || binding.sourceForm !== "value")
        ? undefined
        : selectedSourceValueCarrier(argument, context, options);
    });
    const first = carriers[0];
    return first === undefined || carriers.some((carrier) =>
      carrier === undefined || !rustTargetTypeRefEquals(carrier, first))
      ? undefined
      : first;
  });
}

export function acceptSelectedCall(
  request: RustCheckedCallSelectionInput,
  template: RustProviderOperationTemplate,
  parameterCarriers: readonly (TargetTypeRef | undefined)[] | undefined,
  context: RustOperationPolicyContext,
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
  const instantiatedTemplate = instantiation.template;
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
    instantiatedTemplate.target,
    context,
    resolutionOptions,
  );
  if (providerFormRequiresSourceReceiver(instantiatedTemplate.target) && selectedReceiverCarrier === undefined) {
    return rejectSelectedOperation(request.source.call, context, "RUST_SELECTED_RECEIVER_CARRIER_MISSING", `Selected call '${callIdentity.sourceName}' has no closed Rust receiver carrier.`);
  }
  const fact = finalizeProviderOperationFact(instantiatedTemplate, sourceArguments.carriers, selectedReceiverCarrier);
  if (fact === undefined) {
    return rejectSelectedOperation(request.source.call, context, "RUST_SELECTED_OPERATION_ABI_INCOMPLETE", `Selected call '${callIdentity.sourceName}' cannot finalize one total Rust operation ABI.`);
  }
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
  const preparedResult = context.facts.resolve(
    request.source.call,
    rustPreparedOperationResultFactKey,
  );
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
    recordRustValueCarrierReconciliation(context.facts, argument, pending.reconciliation);
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
    context.facts.set(argument, rustArgumentPassingKey, {
      mode,
      ...(mode === "borrow-shared" || mode === "borrow-mut"
        ? { storageExpression: argument }
        : {}),
    }, [{ message: `rust selected argument ${sourceArgument.sourceIndex} passes as ${mode}` }]);
  }
  context.facts.set(request.source.call, rustTargetOperationFactKey, {
    ...fact,
  }, evidence);
  if (optionalResult.fact !== undefined) {
    context.facts.set(
      request.source.call,
      rustOptionalChainFactKey,
      optionalResult.fact,
      [{ message: `rust optional call ${optionalResult.fact.lowering}` }],
    );
  }
  context.facts.set(request.source.call, rustSelectedOperationKey, operation, evidence);
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
  const selectedSignature = {
      member,
      ...(request.source.selectedSignature === undefined ? {} : { sourceSignature: request.source.selectedSignature }),
      ...(request.sourceSelectedDeclaration === undefined ? {} : { sourceDeclaration: request.sourceSelectedDeclaration }),
      ...(selectedCallCalleeSymbol(request) === undefined ? {} : { sourceCalleeSymbol: selectedCallCalleeSymbol(request) }),
      ...(selectedCallCalleeDeclaration(request) === undefined ? {} : { sourceCalleeDeclaration: selectedCallCalleeDeclaration(request) }),
      ...(request.source.sourceResultType === undefined ? {} : { sourceReturnType: request.source.sourceResultType }),
      sourceArgumentBindings: request.source.sourceArgumentBindings,
      sourceSelectedSignatureParameters: request.source.sourceSelectedSignatureParameters,
      ...(request.source.sourceSelectedMethodTypeArguments === undefined ? {} : { sourceSelectedMethodTypeArguments: request.source.sourceSelectedMethodTypeArguments }),
      ...(callIdentity.providerDeclaration === undefined ? {} : { providerDeclaration: callIdentity.providerDeclaration }),
    };
  context.facts.set(request.source.call, rustSelectedCallKey, selectedSignature, evidence);
  return acceptRustPolicy({ selectedSignature }, evidence);
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
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): SelectedCallSourceCarriers {
  const compileTimeIndexes = new Set(fact.compileTimeSourceArgumentIndexes ?? []);
  const runtimeIndexes = selectedCallArgumentNodes(request)
    .map((_argument, index) => index)
    .filter((index) => !compileTimeIndexes.has(index));
  const declaredBySourceIndex = new Map<number, TargetTypeRef | undefined>();
  for (const sourceIndex of runtimeIndexes) {
    const bindings = request.source.sourceArgumentBindings.filter((binding) =>
      binding.sourceArgumentIndex === sourceIndex);
    const first = bindings[0];
    if (first === undefined || bindings.some((binding) =>
      binding.sourceParameterIndex !== first.sourceParameterIndex ||
      binding.sourceForm !== first.sourceForm) ||
      request.source.sourceSelectedSignatureParameters[first.sourceParameterIndex] === undefined) {
      return { kind: "missing" };
    }
    declaredBySourceIndex.set(sourceIndex, declared?.[first.sourceParameterIndex]);
  }
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
    const normalized = normalizeSelectedArgumentCarrier(argument, resolved, expected, context, options);
    let effective = rustEffectiveValueCarrier(context.facts, argument) ?? normalized;
    if (effective !== undefined && expected !== undefined &&
      !rustTargetTypeRefEquals(effective, expected)) {
      const reconciliation = selectRustValueCarrierReconciliation(
        effective,
        expected,
        options.projectTypes,
      );
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
  if (fact.target.form === "call-str-slice" || fact.target.form === "free-call-str-slice") {
    const stringCarrier = rustStringTargetType();
    return actual.every((carrier) => carrier !== undefined && rustTargetTypeRefEquals(carrier, stringCarrier))
      ? { kind: "resolved", carriers: actual as TargetTypeRef[], reconciliations }
      : { kind: "incompatible", sourceIndex: 0 };
  }
  if (fact.target.form === "call-value-slice" || fact.target.form === "call-value-array" ||
    fact.target.form === "receiver-value-array") {
    const form = fact.target;
    if (actual.length < form.leadingArguments.length) {
      return { kind: "incompatible", sourceIndex: actual.length };
    }
    return { kind: "resolved", carriers: actual as TargetTypeRef[], reconciliations };
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
          selectRustSourceValueConversion(carrier, target) === undefined;
      }
      const exact = form.alternatives.filter((alternative) =>
        rustTargetTypeRefEquals(carrier, alternative.inputCarrier));
      const convertible = exact.length > 0
        ? []
        : form.alternatives.filter((alternative) =>
            selectRustSourceValueConversion(carrier, alternative.inputCarrier) !== undefined);
      return (exact.length > 0 ? exact : convertible).length !== 1;
    });
    return incompatible < 0
      ? { kind: "resolved", carriers: actual as TargetTypeRef[], reconciliations }
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
      ? { kind: "resolved", carriers: actual as TargetTypeRef[], reconciliations }
      : { kind: "incompatible", sourceIndex: incompatible };
  }
  return { kind: "resolved", carriers: actual as TargetTypeRef[], reconciliations };
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
  form: RustProviderOperationForm,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): TargetTypeRef | undefined {
  if (!providerFormRequiresSourceReceiver(form)) {
    return undefined;
  }
  return selectedCallReceiverValueCarrier(request, context, options);
}

export function selectedCallReceiverValueCarrier(
  request: RustCheckedCallSelectionInput,
  context: RustOperationPolicyContext,
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
  if (storedCarrier !== undefined && selectedCarrier !== undefined &&
    rustTargetTypeRefEquals(storedCarrier, selectedCarrier)) {
    return selectedCarrier;
  }
  const optionElement = rustOptionElementCarrier(storedCarrier);
  return optionElement !== undefined &&
      (selectedCarrier === undefined || rustTargetTypeRefEquals(optionElement, selectedCarrier))
    ? selectedCarrier ?? optionElement
    : undefined;
}

type RustOptionalCallResult =
  | {
      readonly kind: "resolved";
      readonly resultCarrier: TargetTypeRef;
      readonly fact?: import("../../../facts/keys.js").RustOptionalChainFact;
    }
  | { readonly kind: "rejected"; readonly message: string };

export function selectRustOptionalCallResult(
  request: RustCheckedCallSelectionInput,
  innerResultCarrier: TargetTypeRef,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
  exactGuard?: RustOptionalCallGuard,
): RustOptionalCallResult {
  if (!request.source.optionalChain) {
    return { kind: "resolved", resultCarrier: innerResultCarrier };
  }
  const receiver = request.source.sourceReceiver;
  const guard = exactGuard?.guard ?? receiver?.expression ?? request.source.sourceCallee.expression;
  const sourceGuardCarrier = exactGuard?.sourceGuardCarrier ?? (receiver === undefined
    ? resolveRustTargetTypeRef(
        selectedCallCalleeDeclaration(request) ?? request.source.sourceCallee.expression,
        context,
        options,
      )
    : resolveRustTargetTypeRef(
        receiver.expression,
        context,
        options,
      ));
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
  context: RustOperationPolicyContext,
): boolean {
  const call = asNode(request.source.call, context);
  const callee = asNode(request.source.sourceCallee.expression, context);
  return call !== undefined && (
    context.ast.kindName(call) === KindNewExpression ||
    (context.ast.kindName(call) === KindCallExpression &&
      callee !== undefined && context.ast.kindName(callee) === "KindSuperKeyword")
  );
}
