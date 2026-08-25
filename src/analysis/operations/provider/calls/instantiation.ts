import {
  rustCallableProtocol,
  rustStringTargetType,
  emptyRustGenericSubstitutions,
  inferRustTargetGenericSubstitutions,
  rustGenericParameterIdentity,
  rustGenericSubstitutionsForArguments,
  rustTargetTypeAssociatedProjectionKeys,
  rustTargetTypeOpenGenericIdentityKeys,
  substituteRustGenericArgument,
  substituteRustTargetGenerics,
  substituteRustTraitRef,
} from "../../../../target-model/types/index.js";
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
import {
  resolveRustConstExpression,
  resolveRustLifetime,
  resolveRustSourceGenericArgument,
} from "../../../../policy/types/resolution/rust-semantics.js";
import { rustArgumentPassingKey, rustSelectedCallKey, rustSelectedOperationKey } from "../../../../target-model/facts/selections.js";
import { rustArgumentPassingMode } from "../../../facts/parameter-passing.js";
import { rustOptionElementCarrier } from "../../../../target-model/types/index.js";
import { resolveRustProviderGenericRequirements } from "../../../../policy/types/provider-generic-requirements.js";
import { rustTargetOperationFactKey, rustPreparedOperationResultFactKey, rustOptionalChainFactKey } from "../../../facts/keys.js";
import { rustTargetOperationText } from "../../../facts/target-operation.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { selectedCallArgumentNodes, selectedCallCalleeDeclaration, selectedCallCalleeSymbol, selectedSourceValueCarrier } from "../operators.js";
import { selectRustOptionalChain } from "../../../../policy/operations/optional-chains.js";
import { substituteRustValueConversionGenerics } from "../../../../target-model/conversions/contracts.js";
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
  RustResolvedProviderTypeParameterRequirement,
  RustRuntimeSetOperationKind,
  RustTargetOperationFact,
} from "../../../facts/keys.js";
import type { Node, ProviderDeclarationIdentity } from "@tsonic/tsts";
import type { RustAppliedValueCarrierReconciliation } from "../../../../policy/types/value-carrier-reconciliation.js";
import type { RustOperationsProviderOptions } from "../model.js";
import type { RustOptionalCallGuard } from "./selection.js";
import type { RustTargetMember, TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustGenericArgument, RustGenerics } from "../../../../target-model/semantics/index.js";
import {
  emptyRustGenerics,
  rustConstSemanticKey,
  rustLifetimeSemanticKey,
  rustSemanticIdentityKey,
  rustTypeSemanticKey,
} from "../../../../target-model/semantics/index.js";
import type { RustGenericSubstitutions } from "../../../../target-model/types/index.js";

export function selectedCallSingleTypeGenerics(
  request: RustCheckedCallSelectionInput,
  context: RustOperationPolicyContext,
): RustGenerics | undefined {
  const selected = request.source.sourceSelectedMethodTypeArguments;
  const declaration = selected?.length === 1
    ? asNode(selected[0]?.typeParameter, context)
    : undefined;
  const parameter = context.sourceGenerics.parameterFor(declaration)?.parameter;
  return parameter?.kind !== "type"
    ? undefined
    : Object.freeze({
        parameters: Object.freeze([parameter]),
        wherePredicates: Object.freeze([]),
      });
}

export function instantiateExactSelectedConstructionCarrier(
  definition: import("../../../project-types/type-policy.js").RustProjectTypeDefinition,
  targetGenericArguments: readonly RustGenericArgument[],
  options: RustOperationsProviderOptions,
): TargetTypeRef | undefined {
  const generics = options.projectTypes.genericsForDefinition(definition);
  const substitutions = generics === undefined
    ? undefined
    : rustGenericSubstitutionsForArguments(generics, targetGenericArguments);
  return substitutions === undefined
    ? undefined
    : substituteRustTargetGenerics(options.projectTypes.openCarrier(definition), substitutions);
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

export function mapSelectedProjectGenericArguments(
  request: RustCheckedCallSelectionInput,
  genericOwner: Node,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): readonly RustGenericArgument[] | undefined {
  const contract = options.sourceGenerics.contractFor(genericOwner);
  const sourceArguments = request.source.sourceSelectedMethodTypeArguments ?? [];
  if (contract === undefined || contract.parameters.length !== sourceArguments.length) {
    return undefined;
  }
  const callNode = asNode(request.source.call, context);
  if (callNode === undefined) return undefined;
  const sourceFile = context.ast.getSourceFile(callNode);
  const callIdentity = `${context.ast.getPath(sourceFile)}:${context.ast.pos(callNode)}:${context.ast.end(callNode)}`;
  const mapped = contract.parameters.map((parameter): RustGenericArgument | undefined => {
    const parameterSemantics = context.semanticsFor(parameter.declaration);
    const selected = sourceArguments.filter((argument) => {
      const symbol = parameterSemantics.declarations.typeSymbol(argument.typeParameter);
      return symbol !== undefined &&
        parameterSemantics.declarations.symbolDeclarations(symbol).some((declaration) =>
          declaration === parameter.declaration);
    });
    const argument = selected.length === 1 ? selected[0] : undefined;
    if (argument === undefined) {
      return undefined;
    }
    if (parameter.parameter.kind === "type") {
      const value = resolveRustTargetTypeRef(
        argument.explicitTypeNode ?? argument.selectedType,
        context,
        options,
      );
      return value === undefined ? undefined : Object.freeze({ kind: "type", value });
    }
    if (parameter.parameter.kind === "lifetime") {
      if (parameter.parameter.identity.kind !== "parameter") return undefined;
      const value = argument.explicitTypeNode === undefined
        ? Object.freeze({
            kind: "inferred-region" as const,
            regionId: `${callIdentity}:${rustSemanticIdentityKey(parameter.parameter.identity.identity)}`,
          })
        : resolveRustLifetime(argument.explicitTypeNode, context);
      return value === undefined ? undefined : Object.freeze({ kind: "lifetime", value });
    }
    const value = argument.explicitTypeNode === undefined
      ? undefined
      : resolveRustConstExpression(argument.explicitTypeNode, context);
    return value === undefined ? undefined : Object.freeze({ kind: "const", value });
  });
  return mapped.some((argument) => argument === undefined)
    ? undefined
    : Object.freeze(mapped as RustGenericArgument[]);
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
  const genericBindingBySourceName = new Map(
    (template.sourceGenericBindings ?? []).map((binding) =>
      [binding.sourceName, binding] as const),
  );
  const directGenericSubstitutions: RustGenericSubstitutions = {
    lifetimes: new Map(),
    types: new Map(),
    consts: new Map(),
    associatedTypes: new Map(),
  };
  const directAssociatedTypes: {
    readonly projection: Extract<TargetTypeRef, { readonly kind: "associated-type" }>;
    readonly value: TargetTypeRef;
  }[] = [];
  for (const argument of request.source.sourceSelectedMethodTypeArguments ?? []) {
    const binding = genericBindingBySourceName.get(argument.typeParameterName);
    if (binding === undefined) return undefined;
    if (binding.target.kind === "associated-type") {
      const value = argument.explicitTypeNode === undefined
        ? resolveRustTargetTypeRef(argument.selectedType, context, resolutionOptions)
        : resolveRustTargetTypeRef(argument.explicitTypeNode, context, resolutionOptions);
      if (value === undefined) return undefined;
      directAssociatedTypes.push({ projection: binding.target.projection, value });
      continue;
    }
    if (binding.target.kind === "semantic-parameter") return undefined;
    const parameterIdentity = rustGenericParameterIdentity(binding.target.parameter);
    if (parameterIdentity === undefined) return undefined;
    const resolved = argument.explicitTypeNode === undefined
      ? binding.target.parameter.kind === "type"
        ? (() => {
            const value = resolveRustTargetTypeRef(
              argument.selectedType,
              context,
              resolutionOptions,
            );
            return value === undefined ? undefined : { kind: "type" as const, value };
          })()
        : undefined
      : resolveRustSourceGenericArgument(
          argument.explicitTypeNode,
          binding.target.parameter,
          context,
          (node) => resolveRustTargetTypeRef(node, context, resolutionOptions),
        );
    if (resolved === undefined || resolved.kind !== parameterIdentity.kind) return undefined;
    if (!mergeDirectGenericBinding(
      directGenericSubstitutions,
      parameterIdentity.identityKey,
      resolved,
    )) return undefined;
  }
  for (const direct of directAssociatedTypes) {
    const projection = substituteRustTargetGenerics(
      direct.projection,
      directGenericSubstitutions,
    );
    if (projection.kind !== "associated-type") return undefined;
    const key = rustTypeSemanticKey(projection);
    const existing = directGenericSubstitutions.associatedTypes.get(key);
    if (existing !== undefined && !rustTargetTypeRefEquals(existing, direct.value)) {
      return undefined;
    }
    (directGenericSubstitutions.associatedTypes as Map<string, TargetTypeRef>)
      .set(key, direct.value);
  }
  return instantiateProviderOperationTemplate(template, {
    sourceReceiverCarrier: rawReceiverCarrier,
    sourceParameterCarriers: selectedParameterCarriers,
    directGenericSubstitutions,
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
  return acceptInstantiatedSelectedCall(
    request,
    instantiation,
    parameterCarriers,
    context,
    resolutionOptions,
    callIdentity,
  );
}

export function acceptClosedSelectedCall(
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
  if ((template.sourceGenericBindings?.length ?? 0) !== 0 ||
    (template.targetInferenceParameters?.length ?? 0) !== 0) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_CLOSED_OPERATION_TEMPLATE_OPEN",
      `Selected call '${callIdentity.sourceName}' produced an open Rust operation where a source policy must produce one closed operation.`,
    );
  }
  const instantiation = instantiateProviderOperationTemplate(template, {});
  if (instantiation === undefined) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_CLOSED_OPERATION_REQUIREMENTS_NOT_PROVEN",
      `Selected call '${callIdentity.sourceName}' produced a closed Rust operation whose exact type requirements are not proven.`,
    );
  }
  return acceptInstantiatedSelectedCall(
    request,
    instantiation,
    parameterCarriers,
    context,
    resolutionOptions,
    callIdentity,
  );
}

export function acceptInstantiatedSelectedCall(
  request: RustCheckedCallSelectionInput,
  instantiation: InstantiatedProviderOperationTemplate,
  parameterCarriers: readonly (TargetTypeRef | undefined)[] | undefined,
  context: RustOperationPolicyContext,
  resolutionOptions: RustOperationsProviderOptions,
  callIdentity: {
    readonly sourceName: string;
    readonly providerDeclaration?: ProviderDeclarationIdentity;
  },
): RustPolicySelection<RustCheckedCallSelectionResult> {
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
  const fact = finalizeProviderOperationFact(
    instantiatedTemplate,
    sourceArguments.carriers,
    selectedReceiverCarrier,
    instantiation.typeRequirements,
  );
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
    generics: instantiatedTemplate.targetCallableGenerics ?? emptyRustGenerics,
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
      ...(fact.abi.targetGenericArguments.length === 0
        ? {}
        : { targetGenericArguments: fact.abi.targetGenericArguments }),
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
        options.sourceGenerics,
      );
      if (reconciliation.kind === "identity" || reconciliation.kind === "conversion" ||
        reconciliation.kind === "project-upcast") {
        if (reconciliation.kind === "identity" || reconciliation.kind === "project-upcast" ||
          targetExpected === undefined) {
          if (reconciliation.kind !== "identity") {
            reconciliations.push({ sourceIndex: index, reconciliation });
          }
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
    form.form === "tuple-field" ||
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

export interface InstantiatedProviderOperationTemplate<
  OperationKind extends RustProviderFactOperationKind | RustRuntimeSetOperationKind = RustProviderFactOperationKind,
> {
  readonly template: RustProviderOperationTemplate<OperationKind>;
  readonly substitutions: RustGenericSubstitutions;
  readonly typeRequirements: readonly RustResolvedProviderTypeParameterRequirement[];
}

export function instantiateProviderOperationTemplate<
  OperationKind extends RustProviderFactOperationKind | RustRuntimeSetOperationKind,
>(
  template: RustProviderOperationTemplate<OperationKind>,
  evidence: {
    readonly sourceReceiverCarrier?: TargetTypeRef;
    readonly sourceParameterCarriers?: readonly (TargetTypeRef | undefined)[];
    readonly sourceResultCarrier?: TargetTypeRef;
    readonly directGenericSubstitutions?: RustGenericSubstitutions;
  },
): InstantiatedProviderOperationTemplate<OperationKind> | undefined {
  const sourceBindings = template.sourceGenericBindings ?? [];
  const targetInferenceParameters = template.targetInferenceParameters ?? [];
  const requirementSourceInputs = providerRequirementSourceInputs(template);
  if (sourceBindings.length === 0 && targetInferenceParameters.length === 0) {
    const typeRequirements = resolveRustProviderGenericRequirements(
      template.typeRequirements,
      new Map(),
      emptyRustGenericSubstitutions,
      requirementSourceInputs,
    );
    return typeRequirements === undefined
      ? undefined
      : { template, substitutions: emptyRustGenericSubstitutions, typeRequirements };
  }
  const identitySets = {
    lifetimes: new Set<string>(),
    types: new Set<string>(),
    consts: new Set<string>(),
    associatedTypes: new Set<string>(),
  };
  const bindingByIdentity = new Map<string, typeof sourceBindings[number]>();
  for (const binding of sourceBindings) {
    if (binding.target.kind === "semantic-parameter") return undefined;
    if (binding.target.kind === "associated-type") {
      const key = rustTypeSemanticKey(binding.target.projection);
      if (identitySets.associatedTypes.has(key)) return undefined;
      identitySets.associatedTypes.add(key);
      continue;
    }
    const identity = rustGenericParameterIdentity(binding.target.parameter);
    if (identity === undefined || bindingByIdentity.has(identity.identityKey)) return undefined;
    identitySets[identity.kind === "lifetime" ? "lifetimes" : identity.kind === "type" ? "types" : "consts"]
      .add(identity.identityKey);
    bindingByIdentity.set(identity.identityKey, binding);
  }
  for (const parameter of targetInferenceParameters) {
    const identity = rustGenericParameterIdentity(parameter);
    if (identity === undefined) return undefined;
    const selected = identity.kind === "lifetime"
      ? identitySets.lifetimes
      : identity.kind === "type"
        ? identitySets.types
        : identitySets.consts;
    if (selected.has(identity.identityKey)) return undefined;
    selected.add(identity.identityKey);
  }
  let bindings: RustGenericSubstitutions = {
    lifetimes: new Map(evidence.directGenericSubstitutions?.lifetimes),
    types: new Map(evidence.directGenericSubstitutions?.types),
    consts: new Map(evidence.directGenericSubstitutions?.consts),
    associatedTypes: new Map(evidence.directGenericSubstitutions?.associatedTypes),
  };
  for (const identityKey of bindings.lifetimes.keys()) {
    if (!identitySets.lifetimes.has(identityKey)) return undefined;
  }
  for (const identityKey of bindings.types.keys()) {
    if (!identitySets.types.has(identityKey)) return undefined;
  }
  for (const identityKey of bindings.consts.keys()) {
    if (!identitySets.consts.has(identityKey)) return undefined;
  }
  if (!inferTemplateBindings(template.receiverCarrier, evidence.sourceReceiverCarrier) ||
    !inferTemplateBindings(template.resultCarrier, evidence.sourceResultCarrier)) {
    return undefined;
  }
  for (let index = 0; index < (template.parameterCarriers?.length ?? 0); index += 1) {
    if (!inferTemplateBindings(
      template.parameterCarriers?.[index],
      evidence.sourceParameterCarriers?.[index],
    )) {
      return undefined;
    }
  }
  if ([...identitySets.lifetimes].some((key) => !bindings.lifetimes.has(key)) ||
    [...identitySets.types].some((key) => !bindings.types.has(key)) ||
    [...identitySets.consts].some((key) => !bindings.consts.has(key)) ||
    sourceBindings.some((binding) => {
      if (binding.target.kind !== "associated-type") return false;
      const projection = substituteRustTargetGenerics(binding.target.projection, bindings);
      return projection.kind !== "associated-type" ||
        !bindings.associatedTypes.has(rustTypeSemanticKey(projection));
    })) {
    return undefined;
  }
  const requirementBindings = new Map<string, TargetTypeRef>();
  for (const binding of sourceBindings) {
    if (binding.target.kind === "semantic-parameter") return undefined;
    if (binding.target.kind === "associated-type") {
      const projection = substituteRustTargetGenerics(binding.target.projection, bindings);
      const value = projection.kind === "associated-type"
        ? bindings.associatedTypes.get(rustTypeSemanticKey(projection))
        : undefined;
      if (value !== undefined) requirementBindings.set(binding.sourceName, value);
      continue;
    }
    const identity = rustGenericParameterIdentity(binding.target.parameter);
    const value = identity?.kind === "type" ? bindings.types.get(identity.identityKey) : undefined;
    if (value !== undefined) requirementBindings.set(binding.sourceName, value);
  }
  const typeRequirements = resolveRustProviderGenericRequirements(
    template.typeRequirements,
    requirementBindings,
    bindings,
    requirementSourceInputs,
  );
  if (typeRequirements === undefined) return undefined;
  return {
    template: {
      ...template,
      target: substituteProviderOperationForm(template.target, bindings),
      resultCarrier: substituteRustTargetGenerics(template.resultCarrier, bindings),
      ...(template.sourceResultCarrier === undefined
        ? {}
        : {
            sourceResultCarrier: substituteRustTargetGenerics(
              template.sourceResultCarrier,
              bindings,
            ),
          }),
      ...(template.parameterCarriers === undefined
        ? {}
        : { parameterCarriers: template.parameterCarriers.map((carrier) =>
            carrier === undefined ? undefined : substituteRustTargetGenerics(carrier, bindings)) }),
      ...(template.receiverCarrier === undefined
        ? {}
        : { receiverCarrier: substituteRustTargetGenerics(template.receiverCarrier, bindings) }),
      ...(template.targetReceiver === undefined
        ? {}
        : {
            targetReceiver: {
              ...template.targetReceiver,
              type: substituteRustTargetGenerics(template.targetReceiver.type, bindings),
            },
          }),
      targetInferenceParameters: [],
      ...(template.targetGenericArguments === undefined
        ? {}
        : {
            targetGenericArguments: template.targetGenericArguments.map((argument) =>
              substituteRustGenericArgument(argument, bindings)),
          }),
      ...(template.resultConversion === undefined
        ? {}
        : {
            resultConversion: substituteRustValueConversionGenerics(
              template.resultConversion,
              bindings,
            ),
          }),
      sourceGenericBindings: [],
      typeRequirements: [],
    },
    substitutions: bindings,
    typeRequirements,
  };

  function inferTemplateBindings(
    pattern: TargetTypeRef | undefined,
    actual: TargetTypeRef | undefined,
  ): boolean {
    if (pattern === undefined) {
      return true;
    }
    const openIdentities = rustTargetTypeOpenGenericIdentityKeys(pattern);
    const associatedProjections = rustTargetTypeAssociatedProjectionKeys(pattern);
    if (!openIdentities.some((key) => identitySets.lifetimes.has(key) ||
      identitySets.types.has(key) || identitySets.consts.has(key)) &&
      !associatedProjections.some((key) => identitySets.associatedTypes.has(key))) {
      return true;
    }
    if (actual === undefined) {
      const closedPattern = substituteRustTargetGenerics(pattern, bindings);
      return !rustTargetTypeOpenGenericIdentityKeys(closedPattern).some((key) =>
        identitySets.lifetimes.has(key) || identitySets.types.has(key) ||
        identitySets.consts.has(key)) &&
        !rustTargetTypeAssociatedProjectionKeys(closedPattern).some((key) =>
          identitySets.associatedTypes.has(key));
    }
    const inferred = inferRustTargetGenericSubstitutions(pattern, actual, identitySets, bindings);
    if (inferred === undefined) {
      return false;
    }
    bindings = inferred;
    return true;
  }
}

function providerRequirementSourceInputs(
  template: RustProviderOperationTemplate<RustProviderFactOperationKind | RustRuntimeSetOperationKind>,
): ReadonlyMap<
  string,
  readonly import("../../../../target-model/operations/model.js").RustResolvedProviderRequirementSourceInput[]
> {
  const result = new Map<
    string,
    readonly import("../../../../target-model/operations/model.js").RustResolvedProviderRequirementSourceInput[]
  >();
  for (const requirement of template.typeRequirements ?? []) {
    const binding = (template.sourceGenericBindings ?? []).find((candidate) =>
      candidate.sourceName === requirement.name);
    if (binding === undefined) {
      result.set(requirement.name, Object.freeze([]));
      continue;
    }
    const inputs: import("../../../../target-model/operations/model.js").RustResolvedProviderRequirementSourceInput[] = [];
    if (template.receiverCarrier !== undefined &&
      providerBindingOccursInCarrier(binding, template.receiverCarrier)) {
      inputs.push(Object.freeze({ kind: "receiver" }));
    }
    (template.parameterCarriers ?? []).forEach((carrier, sourceIndex) => {
      if (carrier !== undefined && providerBindingOccursInCarrier(binding, carrier)) {
        inputs.push(Object.freeze({ kind: "argument", sourceIndex }));
      }
    });
    result.set(requirement.name, Object.freeze(inputs));
  }
  return result;
}

function providerBindingOccursInCarrier(
  binding: import("../../../../target-model/operations/model.js").RustProviderSourceGenericBinding,
  carrier: TargetTypeRef,
): boolean {
  if (binding.target.kind === "semantic-parameter") return false;
  if (binding.target.kind === "associated-type") {
    return rustTargetTypeAssociatedProjectionKeys(carrier).includes(
      rustTypeSemanticKey(binding.target.projection),
    );
  }
  const identity = rustGenericParameterIdentity(binding.target.parameter);
  return identity !== undefined && rustTargetTypeOpenGenericIdentityKeys(carrier)
    .includes(identity.identityKey);
}

function mergeDirectGenericBinding(
  bindings: RustGenericSubstitutions,
  identityKey: string,
  argument: RustGenericArgument,
): boolean {
  if (argument.kind === "type") {
    const existing = bindings.types.get(identityKey);
    if (existing !== undefined) return rustTargetTypeRefEquals(existing, argument.value);
    (bindings.types as Map<string, TargetTypeRef>).set(identityKey, argument.value);
    return true;
  }
  if (argument.kind === "lifetime") {
    const existing = bindings.lifetimes.get(identityKey);
    if (existing !== undefined) {
      return rustLifetimeSemanticKey(existing) === rustLifetimeSemanticKey(argument.value);
    }
    (bindings.lifetimes as Map<string, typeof argument.value>).set(identityKey, argument.value);
    return true;
  }
  const existing = bindings.consts.get(identityKey);
  if (existing !== undefined) {
    return rustConstSemanticKey(existing) ===
      rustConstSemanticKey(argument.value);
  }
  (bindings.consts as Map<string, typeof argument.value>).set(identityKey, argument.value);
  return true;
}

export function substituteProviderOperationForm(
  form: RustProviderOperationForm,
  substitutions: RustGenericSubstitutions,
): RustProviderOperationForm {
  switch (form.form) {
    case "call-value-slice":
    case "call-value-array":
    case "receiver-value-array":
      return {
        ...form,
        leadingArguments: form.leadingArguments.map((argument) => ({
          ...argument,
          carrier: substituteRustTargetGenerics(argument.carrier, substitutions),
        })),
        elementCarrier: substituteRustTargetGenerics(form.elementCarrier, substitutions),
      };
    case "receiver-tagged-array":
      return {
        ...form,
        leadingArguments: form.leadingArguments.map((argument) => ({
          ...argument,
          carrier: substituteRustTargetGenerics(argument.carrier, substitutions),
        })),
        elementCarrier: substituteRustTargetGenerics(form.elementCarrier, substitutions),
        alternatives: form.alternatives.map((alternative) => ({
          ...alternative,
          inputCarrier: substituteRustTargetGenerics(alternative.inputCarrier, substitutions),
        })),
      };
    case "arg-structural-method":
    case "arg-receiver-method":
      return form.argConversions === undefined
        ? form
        : {
            ...form,
            argConversions: form.argConversions.map((conversion) =>
              conversion === undefined
                ? undefined
                : substituteRustValueConversionGenerics(conversion, substitutions)),
          };
    case "trait-call":
    case "trait-associated-value":
      return {
        ...form,
        owner: substituteRustTargetGenerics(form.owner, substitutions),
        trait: substituteRustTraitRef(form.trait, substitutions),
      };
    default:
      return form;
  }
}

export function finalizeProviderOperationFact(
  template: RustProviderOperationTemplate,
  sourceArgumentCarriers: readonly TargetTypeRef[],
  sourceReceiverCarrier: TargetTypeRef | undefined,
  typeRequirements: readonly RustResolvedProviderTypeParameterRequirement[] = [],
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
    ...(template.targetGenericArguments === undefined
      ? {}
      : { targetGenericArguments: template.targetGenericArguments }),
    typeRequirements,
    ...(template.resultConversion === undefined ? {} : { resultConversion: template.resultConversion }),
    isAsync: template.isAsync,
    isFallible: template.isFallible,
    ...(template.evaluation === undefined ? {} : { evaluation: template.evaluation }),
    ...(template.errorBoundary === "none" ? {} : { errorBoundary: template.errorBoundary }),
    ...(template.errorCarrier === undefined ? {} : { errorCarrier: template.errorCarrier }),
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
