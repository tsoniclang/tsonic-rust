import {
  inferRustTargetGenericBindings,
  rustTargetGenericReferences,
  substituteRustTargetGenerics,
} from "../../../../target-model/types/index.js";
import { finalizeRustProviderOperationAbi } from "../../../facts/finalized-operation-abi.js";
import { rustProviderGenericRequirementsAreSatisfied } from "../../../../policy/types/provider-generic-requirements.js";
import {
  rustTargetGenericArgumentEquals,
  rustTargetTypeRefEquals,
} from "../../../../target-model/types/equality.js";
import { substituteRustValueConversion } from "../../../../target-model/conversions/contracts.js";
import { rustLifetimeKey } from "../../../../target-model/lifetimes/index.js";
import type {
  RustProviderFactOperationKind,
  RustProviderOperationForm,
  RustProviderOperationTemplate,
  RustRuntimeSetOperationKind,
  RustTargetOperationFact,
} from "../../../facts/keys.js";
import type { RustProviderGenericParameter } from "../../../../target-model/operations/model.js";
import type {
  RustTargetConstArgument,
  RustTargetGenericArgument,
  TargetTypeRef,
} from "../../../../target-model/types/model.js";
import type { RustLifetimeRef } from "../../../../target-model/lifetimes/index.js";
import type {
  RustTargetGenericBindings,
  RustTargetGenericParameterSet,
} from "../../../../target-model/types/index.js";

export interface InstantiatedProviderOperationTemplate<
  OperationKind extends RustProviderFactOperationKind | RustRuntimeSetOperationKind = RustProviderFactOperationKind,
> {
  readonly template: RustProviderOperationTemplate<OperationKind>;
  readonly substitutions: RustTargetGenericBindings;
}

export function instantiateProviderOperationTemplate<
  OperationKind extends RustProviderFactOperationKind | RustRuntimeSetOperationKind,
>(
  template: RustProviderOperationTemplate<OperationKind>,
  evidence: {
    readonly sourceReceiverCarrier?: TargetTypeRef;
    readonly sourceParameterCarriers?: readonly (TargetTypeRef | undefined)[];
    readonly sourceResultCarrier?: TargetTypeRef;
    readonly directGenericArguments?: ReadonlyMap<string, RustTargetGenericArgument>;
    readonly callScopedElisionBindings?: ReadonlyMap<string, RustLifetimeRef>;
  },
): InstantiatedProviderOperationTemplate<OperationKind> | undefined {
  const parameters = template.genericParameters ?? [];
  const parameterSet = providerGenericParameterSet(parameters);
  const bindings: MutableRustTargetGenericBindings = {
    types: new Map(),
    lifetimes: new Map(),
    consts: new Map(),
  };
  for (const [sourceName, argument] of evidence.directGenericArguments ?? []) {
    const parameter = parameters.find((candidate) => candidate.sourceName === sourceName);
    if (parameter === undefined || !mergeDirectGenericArgument(bindings, parameter, argument)) {
      return undefined;
    }
  }
  if (!inferExactTemplateBindings(
    template.receiverCarrier,
    evidence.sourceReceiverCarrier,
  )) {
    return undefined;
  }
  const parameterBindings: MutableRustTargetGenericBindings = {
    types: new Map(),
    lifetimes: new Map(),
    consts: new Map(),
  };
  for (let index = 0; index < (template.parameterCarriers?.length ?? 0); index += 1) {
    if (!inferUnboundTemplateBindings(
      template.parameterCarriers?.[index],
      evidence.sourceParameterCarriers?.[index],
      parameterBindings,
    )) {
      return undefined;
    }
  }
  if (!mergeGenericBindings(bindings, parameterBindings)) return undefined;
  const resultBindings: MutableRustTargetGenericBindings = {
    types: new Map(),
    lifetimes: new Map(),
    consts: new Map(),
  };
  if (!inferUnboundTemplateBindings(
    template.resultCarrier,
    evidence.sourceResultCarrier,
    resultBindings,
  ) || !mergeGenericBindings(bindings, resultBindings)) {
    return undefined;
  }
  for (const parameter of parameters) {
    if (providerGenericParameterIsBound(bindings, parameter)) continue;
    if (parameter.kind === "lifetime") {
      const inferred = evidence.callScopedElisionBindings?.get(parameter.targetIdentity);
      if (inferred === undefined || !mergeLifetimeBinding(
        bindings.lifetimes,
        parameter.targetIdentity,
        inferred,
      )) {
        return undefined;
      }
      continue;
    }
    if (parameter.defaultArgument === undefined) {
      return undefined;
    }
    const defaultArgument = substituteTargetGenericArgument(
      parameter.defaultArgument,
      bindings,
    );
    if (!mergeDirectGenericArgument(bindings, parameter, defaultArgument)) {
      return undefined;
    }
  }
  if (!rustProviderGenericRequirementsAreSatisfied(template.typeRequirements, bindings.types)) {
    return undefined;
  }
  const substitutions: RustTargetGenericBindings = Object.freeze({
    types: bindings.types,
    lifetimes: bindings.lifetimes,
    consts: bindings.consts,
  });
  const {
    genericParameters: _genericParameters,
    typeRequirements: _typeRequirements,
    ...closedTemplate
  } = template;
  return {
    template: {
      ...closedTemplate,
      target: substituteProviderOperationForm(template.target, substitutions),
      resultCarrier: substituteProviderCarrier(template.resultCarrier, substitutions),
      ...(template.sourceResultCarrier === undefined
        ? {}
        : {
            sourceResultCarrier: substituteProviderCarrier(template.sourceResultCarrier, substitutions),
          }),
      ...(template.sourceAbsenceCarrier === undefined
        ? {}
        : {
            sourceAbsenceCarrier: substituteProviderCarrier(template.sourceAbsenceCarrier, substitutions),
          }),
      ...(template.parameterCarriers === undefined
        ? {}
        : { parameterCarriers: template.parameterCarriers.map((carrier) =>
            carrier === undefined ? undefined : substituteProviderCarrier(carrier, substitutions)) }),
      ...(template.receiverCarrier === undefined
        ? {}
        : { receiverCarrier: substituteProviderCarrier(template.receiverCarrier, substitutions) }),
      ...(template.targetGenericArguments === undefined
        ? {}
        : {
            targetGenericArguments: template.targetGenericArguments.map((argument) =>
              substituteTargetGenericArgument(argument, substitutions)),
          }),
      ...(template.resultConversion === undefined
        ? {}
        : {
            resultConversion: substituteRustValueConversion(
              template.resultConversion,
              substitutions.types,
              substitutions.lifetimes,
              substitutions.consts,
            ),
          }),
      ...(template.errorCarrier === undefined
        ? {}
        : { errorCarrier: substituteProviderCarrier(template.errorCarrier, substitutions) }),
    },
    substitutions,
  };

  function inferExactTemplateBindings(
    pattern: TargetTypeRef | undefined,
    actual: TargetTypeRef | undefined,
  ): boolean {
    if (pattern === undefined || !carrierReferencesProviderParameters(pattern, parameterSet)) {
      return true;
    }
    if (actual === undefined) {
      return false;
    }
    const inferred = inferRustTargetGenericBindings(pattern, actual, parameterSet, {
      callScopedElisionBindings: evidence.callScopedElisionBindings,
    });
    if (inferred === undefined) {
      return false;
    }
    return mergeGenericBindings(bindings, inferred);
  }

  function inferUnboundTemplateBindings(
    pattern: TargetTypeRef | undefined,
    actual: TargetTypeRef | undefined,
    inferredBindings: MutableRustTargetGenericBindings,
  ): boolean {
    if (pattern === undefined || !carrierReferencesUnboundProviderParameters(
      pattern,
      parameterSet,
      bindings,
    )) {
      return true;
    }
    if (actual === undefined) return false;
    const inferred = inferRustTargetGenericBindings(pattern, actual, parameterSet, {
      callScopedElisionBindings: evidence.callScopedElisionBindings,
    });
    return inferred !== undefined && mergeUnboundGenericBindings(
      inferredBindings,
      inferred,
      bindings,
    );
  }
}

interface MutableRustTargetGenericBindings {
  readonly types: Map<string, TargetTypeRef>;
  readonly lifetimes: Map<string, RustLifetimeRef>;
  readonly consts: Map<string, RustTargetConstArgument>;
}

function providerGenericParameterSet(
  parameters: readonly RustProviderGenericParameter[],
): RustTargetGenericParameterSet {
  return Object.freeze({
    typeNames: new Set(parameters.flatMap((parameter) =>
      parameter.kind === "type" ? [parameter.sourceName] : [])),
    lifetimeIdentities: new Set(parameters.flatMap((parameter) =>
      parameter.kind === "lifetime" ? [parameter.targetIdentity] : [])),
    constIdentities: new Set(parameters.flatMap((parameter) =>
      parameter.kind === "const" ? [parameter.targetIdentity] : [])),
  });
}

function carrierReferencesProviderParameters(
  carrier: TargetTypeRef,
  parameters: RustTargetGenericParameterSet,
): boolean {
  const references = rustTargetGenericReferences(carrier);
  return references.typeNames.some((name) => parameters.typeNames.has(name)) ||
    references.lifetimeIdentities.some((identity) =>
      parameters.lifetimeIdentities.has(identity)) ||
    references.constIdentities.some((identity) =>
      parameters.constIdentities.has(identity));
}

function carrierReferencesUnboundProviderParameters(
  carrier: TargetTypeRef,
  parameters: RustTargetGenericParameterSet,
  bound: RustTargetGenericBindings,
): boolean {
  const references = rustTargetGenericReferences(carrier);
  return references.typeNames.some((name) =>
    parameters.typeNames.has(name) && !bound.types.has(name)) ||
    references.lifetimeIdentities.some((identity) =>
      parameters.lifetimeIdentities.has(identity) && !bound.lifetimes.has(identity)) ||
    references.constIdentities.some((identity) =>
      parameters.constIdentities.has(identity) && !bound.consts.has(identity));
}

function providerGenericParameterIsBound(
  bindings: RustTargetGenericBindings,
  parameter: RustProviderGenericParameter,
): boolean {
  switch (parameter.kind) {
    case "type":
      return bindings.types.has(parameter.sourceName);
    case "lifetime":
      return bindings.lifetimes.has(parameter.targetIdentity);
    case "const":
      return bindings.consts.has(parameter.targetIdentity);
  }
}

function mergeDirectGenericArgument(
  bindings: MutableRustTargetGenericBindings,
  parameter: RustProviderGenericParameter,
  argument: RustTargetGenericArgument,
): boolean {
  if (parameter.kind !== argument.kind) return false;
  switch (parameter.kind) {
    case "type":
      return argument.kind === "type" &&
        mergeTypeBinding(bindings.types, parameter.sourceName, argument.type);
    case "lifetime":
      return argument.kind === "lifetime" && mergeLifetimeBinding(
        bindings.lifetimes,
        parameter.targetIdentity,
        argument.lifetime,
      );
    case "const":
      return argument.kind === "const" && mergeConstBinding(
        bindings.consts,
        parameter.targetIdentity,
        argument.value,
      );
  }
}

function mergeGenericBindings(
  target: MutableRustTargetGenericBindings,
  source: RustTargetGenericBindings,
): boolean {
  for (const [identity, type] of source.types) {
    if (!mergeTypeBinding(target.types, identity, type)) return false;
  }
  for (const [identity, lifetime] of source.lifetimes) {
    if (!mergeLifetimeBinding(target.lifetimes, identity, lifetime)) return false;
  }
  for (const [identity, value] of source.consts) {
    if (!mergeConstBinding(target.consts, identity, value)) return false;
  }
  return true;
}

function mergeUnboundGenericBindings(
  target: MutableRustTargetGenericBindings,
  source: RustTargetGenericBindings,
  bound: RustTargetGenericBindings,
): boolean {
  for (const [identity, type] of source.types) {
    if (!bound.types.has(identity) && !mergeTypeBinding(target.types, identity, type)) {
      return false;
    }
  }
  for (const [identity, lifetime] of source.lifetimes) {
    if (!bound.lifetimes.has(identity) &&
      !mergeLifetimeBinding(target.lifetimes, identity, lifetime)) {
      return false;
    }
  }
  for (const [identity, value] of source.consts) {
    if (!bound.consts.has(identity) && !mergeConstBinding(target.consts, identity, value)) {
      return false;
    }
  }
  return true;
}

function mergeTypeBinding(
  bindings: Map<string, TargetTypeRef>,
  identity: string,
  carrier: TargetTypeRef,
): boolean {
  const existing = bindings.get(identity);
  if (existing !== undefined) return rustTargetTypeRefEquals(existing, carrier);
  bindings.set(identity, carrier);
  return true;
}

function mergeLifetimeBinding(
  bindings: Map<string, RustLifetimeRef>,
  identity: string,
  lifetime: RustLifetimeRef,
): boolean {
  const existing = bindings.get(identity);
  if (existing !== undefined) {
    return rustTargetGenericArgumentEquals(
      { kind: "lifetime", lifetime: existing },
      { kind: "lifetime", lifetime },
    );
  }
  bindings.set(identity, lifetime);
  return true;
}

function mergeConstBinding(
  bindings: Map<string, RustTargetConstArgument>,
  identity: string,
  value: RustTargetConstArgument,
): boolean {
  const existing = bindings.get(identity);
  if (existing !== undefined) {
    return rustTargetGenericArgumentEquals(
      { kind: "const", value: existing },
      { kind: "const", value },
    );
  }
  bindings.set(identity, value);
  return true;
}

function substituteProviderCarrier(
  carrier: TargetTypeRef,
  substitutions: RustTargetGenericBindings,
): TargetTypeRef {
  return substituteRustTargetGenerics(
    carrier,
    substitutions.types,
    substitutions.lifetimes,
    substitutions.consts,
  );
}

function substituteTargetGenericArgument(
  argument: RustTargetGenericArgument,
  substitutions: RustTargetGenericBindings,
): RustTargetGenericArgument {
  switch (argument.kind) {
    case "type":
      return Object.freeze({
        kind: "type",
        type: substituteProviderCarrier(argument.type, substitutions),
      });
    case "lifetime":
      return Object.freeze({
        kind: "lifetime",
        lifetime: substitutions.lifetimes.get(rustLifetimeKey(argument.lifetime)) ??
          argument.lifetime,
      });
    case "const":
      return argument.value.kind === "parameter"
        ? Object.freeze({
            kind: "const",
            value: substitutions.consts.get(argument.value.identity) ?? argument.value,
          })
        : argument;
  }
}

export function substituteProviderOperationForm(
  form: RustProviderOperationForm,
  substitutions: RustTargetGenericBindings,
): RustProviderOperationForm {
  switch (form.form) {
    case "call-value-slice":
    case "call-value-array":
    case "receiver-value-array":
      return {
        ...form,
        leadingArguments: form.leadingArguments.map((argument) => ({
          ...argument,
          carrier: substituteProviderCarrier(argument.carrier, substitutions),
        })),
        elementCarrier: substituteProviderCarrier(form.elementCarrier, substitutions),
      };
    case "receiver-tagged-array":
      return {
        ...form,
        leadingArguments: form.leadingArguments.map((argument) => ({
          ...argument,
          carrier: substituteProviderCarrier(argument.carrier, substitutions),
        })),
        elementCarrier: substituteProviderCarrier(form.elementCarrier, substitutions),
        alternatives: form.alternatives.map((alternative) => ({
          ...alternative,
          inputCarrier: substituteProviderCarrier(alternative.inputCarrier, substitutions),
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
                : substituteRustValueConversion(
                    conversion,
                    substitutions.types,
                    substitutions.lifetimes,
                    substitutions.consts,
                  )),
          };
    case "trait-call":
    case "trait-associated-value":
      return {
        ...form,
        owner: substituteProviderCarrier(form.owner, substitutions),
        traitGenericArguments: form.traitGenericArguments.map((argument) =>
          substituteTargetGenericArgument(argument, substitutions)),
      };
    case "associated-value":
      return {
        ...form,
        owner: substituteProviderCarrier(form.owner, substitutions),
      };
    case "call":
    case "free-call":
    case "receiver-method":
      return form.argConversions === undefined
        ? form
        : {
            ...form,
            argConversions: form.argConversions.map((conversion) =>
              conversion === undefined
                ? undefined
                : substituteRustValueConversion(
                    conversion,
                    substitutions.types,
                    substitutions.lifetimes,
                    substitutions.consts,
                  )),
          };
    case "index":
      return form.indexConversion === undefined
        ? form
        : {
            ...form,
            indexConversion: substituteRustValueConversion(
              form.indexConversion,
              substitutions.types,
              substitutions.lifetimes,
              substitutions.consts,
            ),
          };
    case "marker":
    case "call-c-variadic":
    case "call-str-slice":
    case "free-call-str-slice":
    case "path":
    case "static":
    case "method":
    case "arg-method":
    case "field":
    case "binary-operator":
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
    ...(template.targetGenericArguments === undefined
      ? {}
      : { targetGenericArguments: template.targetGenericArguments }),
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
