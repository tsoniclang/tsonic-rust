import {
  emptyRustGenericSubstitutions,
  inferRustTargetGenericSubstitutions,
  rustGenericParameterIdentity,
  rustTargetTypeAssociatedProjectionKeys,
  rustTargetTypeOpenGenericIdentityKeys,
  substituteRustGenericArgument,
  substituteRustTargetGenerics,
  substituteRustTraitRef,
} from "../../../../target-model/types/index.js";
import { finalizeRustProviderOperationAbi } from "../../../facts/finalized-operation-abi.js";
import { resolveRustProviderGenericRequirements } from "../../../../policy/types/provider-generic-requirements.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { substituteRustValueConversionGenerics } from "../../../../target-model/conversions/contracts.js";
import {
  rustConstSemanticKey,
  rustLifetimeSemanticKey,
  rustTypeSemanticKey,
} from "../../../../target-model/semantics/index.js";
import type {
  RustProviderFactOperationKind,
  RustProviderOperationForm,
  RustProviderOperationTemplate,
  RustResolvedProviderTypeParameterRequirement,
  RustRuntimeSetOperationKind,
  RustTargetOperationFact,
} from "../../../facts/keys.js";
import type {
  RustProviderSourceGenericBinding,
  RustResolvedProviderRequirementSourceInput,
} from "../../../../target-model/operations/model.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustGenericArgument } from "../../../../target-model/semantics/index.js";
import type { RustGenericSubstitutions } from "../../../../target-model/types/index.js";

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
): ReadonlyMap<string, readonly RustResolvedProviderRequirementSourceInput[]> {
  const result = new Map<string, readonly RustResolvedProviderRequirementSourceInput[]>();
  for (const requirement of template.typeRequirements ?? []) {
    const binding = (template.sourceGenericBindings ?? []).find((candidate) =>
      candidate.sourceName === requirement.name);
    if (binding === undefined) {
      result.set(requirement.name, Object.freeze([]));
      continue;
    }
    const inputs: RustResolvedProviderRequirementSourceInput[] = [];
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
  binding: RustProviderSourceGenericBinding,
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

export function mergeDirectGenericBinding(
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
    return rustConstSemanticKey(existing) === rustConstSemanticKey(argument.value);
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
