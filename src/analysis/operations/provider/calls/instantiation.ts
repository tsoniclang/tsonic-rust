import {
  rustCallableProtocol,
  rustStringTargetType,
  inferRustTargetTypeParameterBindings,
  rustTargetTypeContainsTypeParameter,
  substituteRustTargetTypeParameters,
} from "../../../../policy/types/target-types.js";
import { acceptRustPolicy } from "../../../../policy/operations/contracts.js";
import { asNode } from "../../../../policy/evidence/selected-source.js";
import { finalizeRustProviderOperationAbi } from "../../../facts/finalized-operation-abi.js";
import { isRustCVariadicArgumentCarrier } from "../../../facts/c-variadic.js";
import {
  KindCallExpression,
  KindNewExpression,
} from "@tsonic/target-api/source";
import { normalizeSelectedArgumentCarrier, rejectSelectedOperation } from "../result.js";
import { selectRustValueCarrierReconciliation } from "../../../../policy/types/value-carrier-reconciliation.js";
import { recordRustValueCarrierReconciliation, rustEffectiveValueCarrier } from "../../../facts/value-carrier-queries.js";
import { resolveRustTargetTypeRef } from "../../../../policy/types/resolution.js";
import { rustArgumentPassingKey, rustSelectedCallKey, rustSelectedOperationKey } from "../../../../policy/model/selections.js";
import { rustArgumentPassingMode } from "../../../facts/parameter-passing.js";
import { rustOptionElementCarrier } from "../../../../policy/types/target-types.js";
import { rustProviderGenericRequirementsAreSatisfied } from "../../../../policy/types/provider-generic-requirements.js";
import { rustTargetOperationFactKey, rustPreparedOperationResultFactKey, rustOptionalChainFactKey } from "../../../facts/keys.js";
import { rustTargetOperationText } from "../../../facts/target-operation.js";
import { rustTargetTypeRefEquals } from "../../../../policy/types/equality.js";
import { selectedCallArgumentNodes, selectedCallCalleeDeclaration, selectedCallCalleeSymbol, selectedSourceValueCarrier } from "../operators.js";
import { selectRustOptionalChain } from "../../../../policy/operations/optional-chains.js";
import { substituteRustValueConversion } from "../../../../policy/conversions/contracts.js";
import { selectRustSourceValueConversion } from "../../../../policy/conversions/selection.js";
import type {
  RustCheckedCallSelectionInput,
  RustCheckedCallSelectionResult,
  RustOperationPolicyContext,
  RustPolicySelection,
  RustTargetOperationSelection,
} from "../../../../policy/operations/contracts.js";
import type {
  RustProviderFactOperationKind,
  RustProviderOperationForm,
  RustProviderOperationTemplate,
  RustRuntimeSetOperationKind,
  RustTargetOperationFact,
} from "../../../facts/keys.js";
import type { ProviderDeclarationIdentity } from "@tsonic/tsts";
import type { RustAppliedValueCarrierReconciliation } from "../../../../policy/types/value-carrier-reconciliation.js";
import type { RustOperationsProviderOptions } from "../model.js";
import type { RustOptionalCallGuard } from "./selection.js";
import type { RustTargetMember, TargetTypeRef } from "../../../../policy/types/model.js";

export function instantiateExactSelectedConstructionCarrier(
  definition: import("../../../project-types/type-policy.js").RustProjectTypeDefinition,
  sourceTypeArguments: NonNullable<
    RustCheckedCallSelectionInput["source"]["sourceSelectedMethodTypeArguments"]
  >,
  targetTypeArguments: readonly TargetTypeRef[],
  options: RustOperationsProviderOptions,
): TargetTypeRef | undefined {
  if (sourceTypeArguments.length !== definition.typeParameterNames.length ||
    targetTypeArguments.length !== definition.typeParameterNames.length ||
    sourceTypeArguments.some((argument, index) =>
      argument.typeParameterName !== definition.typeParameterNames[index])) {
    return undefined;
  }
  return substituteRustTargetTypeParameters(
    options.projectTypes.openCarrier(definition),
    new Map(definition.typeParameterNames.map((name, index) =>
      [name, targetTypeArguments[index]!] as const)),
  );
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
  const selectedParameterCarriers = request.source.sourceSelectedSignatureParameters.map((parameter) =>
    resolveRustTargetTypeRef(parameter.selectedType, context, resolutionOptions));
  const selectedResultCarrier = request.source.sourceResultType === undefined
    ? undefined
    : resolveRustTargetTypeRef(request.source.sourceResultType, context, resolutionOptions);
  const directTypeArguments = new Map<string, TargetTypeRef>();
  for (const argument of request.source.sourceSelectedMethodTypeArguments ?? []) {
    const carrier = resolveRustTargetTypeRef(
      argument.explicitTypeNode ?? argument.selectedType,
      context,
      resolutionOptions,
    );
    if (carrier !== undefined) {
      directTypeArguments.set(argument.typeParameterName, carrier);
    }
  }
  return instantiateProviderOperationTemplate(template, {
    sourceReceiverCarrier: rawReceiverCarrier,
    sourceParameterCarriers: selectedParameterCarriers,
    sourceResultCarrier: selectedResultCarrier,
    directTypeArguments,
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
  const targetTypeArguments = request.source.sourceSelectedMethodTypeArguments?.map((argument) =>
    resolveRustTargetTypeRef(argument.explicitTypeNode ?? argument.selectedType, context, resolutionOptions));
  if (targetTypeArguments?.some((argument) => argument === undefined) === true) {
    return rejectSelectedOperation(request.source.call, context, "RUST_SELECTED_TYPE_ARGUMENT_CARRIER_MISSING", `Selected generic call '${callIdentity.sourceName}' has a source-selected type argument that cannot map to a closed Rust target type.`);
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
      ...(targetTypeArguments === undefined ? {} : { targetTypeArguments: targetTypeArguments as TargetTypeRef[] }),
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
      if (reconciliation.kind === "conversion" || reconciliation.kind === "project-upcast") {
        if (reconciliation.kind === "project-upcast" || targetExpected === undefined) {
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
    (form.form === "trait-call" && form.receiverMode !== undefined);
}

interface InstantiatedProviderOperationTemplate<
  OperationKind extends RustProviderFactOperationKind | RustRuntimeSetOperationKind = RustProviderFactOperationKind,
> {
  readonly template: RustProviderOperationTemplate<OperationKind>;
  readonly substitutions: ReadonlyMap<string, TargetTypeRef>;
}

export function instantiateProviderOperationTemplate<
  OperationKind extends RustProviderFactOperationKind | RustRuntimeSetOperationKind,
>(
  template: RustProviderOperationTemplate<OperationKind>,
  evidence: {
    readonly sourceReceiverCarrier?: TargetTypeRef;
    readonly sourceParameterCarriers?: readonly (TargetTypeRef | undefined)[];
    readonly sourceResultCarrier?: TargetTypeRef;
    readonly directTypeArguments?: ReadonlyMap<string, TargetTypeRef>;
  },
): InstantiatedProviderOperationTemplate<OperationKind> | undefined {
  const parameterNames = new Set(template.typeParameters ?? []);
  if (parameterNames.size === 0) {
    return { template, substitutions: new Map() };
  }
  const bindings = new Map<string, TargetTypeRef>();
  for (const [name, carrier] of evidence.directTypeArguments ?? []) {
    if (parameterNames.has(name) && !mergeTypeBinding(bindings, name, carrier)) {
      return undefined;
    }
  }
  if (!inferTemplateBindings(template.receiverCarrier, evidence.sourceReceiverCarrier, true) ||
    !inferTemplateBindings(template.resultCarrier, evidence.sourceResultCarrier, false)) {
    return undefined;
  }
  for (let index = 0; index < (template.parameterCarriers?.length ?? 0); index += 1) {
    if (!inferTemplateBindings(
      template.parameterCarriers?.[index],
      evidence.sourceParameterCarriers?.[index],
      false,
    )) {
      return undefined;
    }
  }
  if ([...parameterNames].some((name) => !bindings.has(name))) {
    return undefined;
  }
  if (!rustProviderGenericRequirementsAreSatisfied(template.typeRequirements, bindings)) {
    return undefined;
  }
  return {
    template: {
      ...template,
      target: substituteProviderOperationForm(template.target, bindings),
      resultCarrier: substituteRustTargetTypeParameters(template.resultCarrier, bindings),
      ...(template.sourceResultCarrier === undefined
        ? {}
        : {
            sourceResultCarrier: substituteRustTargetTypeParameters(
              template.sourceResultCarrier,
              bindings,
            ),
          }),
      ...(template.parameterCarriers === undefined
        ? {}
        : { parameterCarriers: template.parameterCarriers.map((carrier) =>
            carrier === undefined ? undefined : substituteRustTargetTypeParameters(carrier, bindings)) }),
      ...(template.receiverCarrier === undefined
        ? {}
        : { receiverCarrier: substituteRustTargetTypeParameters(template.receiverCarrier, bindings) }),
      ...(template.targetTypeArguments === undefined
        ? {}
        : {
            targetTypeArguments: template.targetTypeArguments.map((carrier) =>
              substituteRustTargetTypeParameters(carrier, bindings)),
          }),
      ...(template.resultConversion === undefined
        ? {}
        : {
            resultConversion: substituteRustValueConversion(
              template.resultConversion,
              bindings,
            ),
          }),
      typeParameters: [],
      typeRequirements: [],
    },
    substitutions: bindings,
  };

  function inferTemplateBindings(
    pattern: TargetTypeRef | undefined,
    actual: TargetTypeRef | undefined,
    reconcileKnownBindings: boolean,
  ): boolean {
    if (pattern === undefined || !rustTargetTypeContainsTypeParameter(pattern, parameterNames)) {
      return true;
    }
    const selectedNames = reconcileKnownBindings
      ? parameterNames
      : new Set([...parameterNames].filter((name) => !bindings.has(name)));
    if (!rustTargetTypeContainsTypeParameter(pattern, selectedNames)) {
      return true;
    }
    if (actual === undefined) {
      return false;
    }
    const inferred = inferRustTargetTypeParameterBindings(pattern, actual, selectedNames);
    if (inferred === undefined) {
      return false;
    }
    for (const [name, carrier] of inferred) {
      if (!mergeTypeBinding(bindings, name, carrier)) {
        return false;
      }
    }
    return true;
  }
}

function mergeTypeBinding(
  bindings: Map<string, TargetTypeRef>,
  name: string,
  carrier: TargetTypeRef,
): boolean {
  const existing = bindings.get(name);
  if (existing !== undefined) {
    return rustTargetTypeRefEquals(existing, carrier);
  }
  bindings.set(name, carrier);
  return true;
}

export function substituteProviderOperationForm(
  form: RustProviderOperationForm,
  substitutions: ReadonlyMap<string, TargetTypeRef>,
): RustProviderOperationForm {
  switch (form.form) {
    case "call-value-slice":
    case "call-value-array":
    case "receiver-value-array":
      return {
        ...form,
        leadingArguments: form.leadingArguments.map((argument) => ({
          ...argument,
          carrier: substituteRustTargetTypeParameters(argument.carrier, substitutions),
        })),
        elementCarrier: substituteRustTargetTypeParameters(form.elementCarrier, substitutions),
      };
    case "receiver-tagged-array":
      return {
        ...form,
        leadingArguments: form.leadingArguments.map((argument) => ({
          ...argument,
          carrier: substituteRustTargetTypeParameters(argument.carrier, substitutions),
        })),
        elementCarrier: substituteRustTargetTypeParameters(form.elementCarrier, substitutions),
        alternatives: form.alternatives.map((alternative) => ({
          ...alternative,
          inputCarrier: substituteRustTargetTypeParameters(alternative.inputCarrier, substitutions),
        })),
      };
    case "trait-call":
    case "trait-associated-value":
      return {
        ...form,
        owner: substituteRustTargetTypeParameters(form.owner, substitutions),
        traitTypeArguments: form.traitTypeArguments.map((argument) =>
          substituteRustTargetTypeParameters(argument, substitutions)),
      };
    default:
      return form;
  }
}

export function finalizeProviderOperationFact(
  template: RustProviderOperationTemplate,
  sourceArgumentCarriers: readonly TargetTypeRef[],
  sourceReceiverCarrier: TargetTypeRef | undefined,
): Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }> | undefined {
  const abi = finalizeRustProviderOperationAbi({
    operationKind: template.operationKind,
    form: template.target,
    ...(sourceReceiverCarrier === undefined ? {} : { sourceReceiverCarrier }),
    sourceArgumentCarriers,
    declaredSourceArgumentCarriers: template.parameterCarriers,
    ...(template.compileTimeSourceArgumentIndexes === undefined
      ? {}
      : { compileTimeSourceArgumentIndexes: template.compileTimeSourceArgumentIndexes }),
    resultCarrier: template.resultCarrier,
    ...(template.targetTypeArguments === undefined
      ? {}
      : { targetTypeArguments: template.targetTypeArguments }),
    ...(template.resultConversion === undefined ? {} : { resultConversion: template.resultConversion }),
    isAsync: template.isAsync,
    isFallible: template.isFallible,
    ...(template.errorBoundary === "none" ? {} : { errorBoundary: template.errorBoundary }),
    isUnsafe: template.isUnsafe,
  });
  if (abi === undefined) {
    return undefined;
  }
  return {
    kind: "provider-operation",
    operationId: template.operationId,
    resultCarrier: abi.result.kind === "async" ? abi.result.futureCarrier : abi.result.carrier,
    ...(template.sourceResultCarrier === undefined
      ? {}
      : { sourceResultCarrier: template.sourceResultCarrier }),
    ...(template.sourceAbsenceCarrier === undefined
      ? {}
      : { sourceAbsenceCarrier: template.sourceAbsenceCarrier }),
    abi,
  };
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
