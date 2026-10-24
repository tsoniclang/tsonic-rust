import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { rustGenericsWithAssociatedBounds, rustTypeParameterBounds } from "../../types/generic-bounds.js";
import {
  type RustSourceGenericParameterContract,
  rustLifetimeKey,
} from "../../../../target-model/lifetimes/index.js";
import { emptyRustGenerics, type RustGenerics, type RustGenericParameter, type RustTypeBound } from "../../../target-ast/syntax/nodes.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import { isValidRustIdentifier } from "../../../../target-model/names/identifiers.js";
import { rustLifetimeToAst } from "../../types/lifetime-syntax.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustAssociatedPredicates } from "../../types/associated-bounds.js";
import { rustProjectProjectionPredicates } from "../../types/project-projection-bounds.js";
import { rustOptionalStorageParameters } from "../../types/type-projections.js";
import { allocateRustGeneratedName } from "../../../../target-model/names/generated.js";
import { rustCapturedLifetimeSubstitutions } from "../../../../target-model/names/captured-lifetimes.js";
import { planRustNativeCallableGenerics } from "./native-generics.js";
import { planRustRetainedGenerics } from "./retained-generics.js";

export interface RustCallableGenericPlan {
  readonly context: RustPlanContext;
  readonly preservesExplicitLifetimes: boolean;
  readonly sourceTypeParameterIdentities: readonly string[];
  readonly parameterSlots: ReadonlyMap<string, number>;
  finalizeGenerics(): RustGenerics;
}

export function rustSourceDeclarationGenerics(
  contract: import("../../../../target-model/lifetimes/model.js").RustSourceGenericContract,
): RustGenerics {
  if (contract.lifetimeBinder !== undefined) failRustPlannerInvariant("An admitted item generic contract cannot retain a higher-ranked binder.", contract.declaration);
  const parameters: RustGenericParameter[] = [];
  for (const parameter of contract.parameters) {
    if (parameter.kind === "lifetime") {
      if (parameter.lifetime.kind !== "parameter") failRustPlannerInvariant("An admitted item lifetime requires its named native binder.", contract.declaration);
      parameters.push({
        kind: "lifetime",
        name: parameter.lifetime.name,
        outlives: Object.freeze(parameter.outlives.map(rustLifetimeToAst)),
      });
      continue;
    }
    if (!isValidRustIdentifier(parameter.targetName)) failRustPlannerInvariant("An admitted item type parameter requires its native identifier.", contract.declaration);
    parameters.push({
      kind: "type",
      name: parameter.targetName,
      bounds: Object.freeze([
        ...parameter.outlives.map((lifetime): RustTypeBound => ({
          kind: "lifetime",
          lifetime: rustLifetimeToAst(lifetime),
        })),
        ...(parameter.maybeSized ? [{ kind: "maybe-sized" as const }] : []),
      ]),
    });
  }
  return Object.freeze({
    parameters: Object.freeze(parameters),
    wherePredicates: Object.freeze([]),
  });
}

export function planRustCallableGenerics(
  declaration: Node,
  context: RustPlanContext,
  ownerLifetimes: ReadonlySet<string>,
  specialization?: ReadonlyMap<string, TargetTypeRef>,
  capturedParameters: readonly RustSourceGenericParameterContract[] = [],
): RustCallableGenericPlan {
  const source = planRustSourceCallableGenerics(declaration, context, ownerLifetimes, specialization, capturedParameters);
  const native = planRustNativeCallableGenerics(declaration, source);
  return planRustRetainedGenerics(declaration, native);
}

function planRustSourceCallableGenerics(
  declaration: Node,
  context: RustPlanContext,
  ownerLifetimes: ReadonlySet<string>,
  specialization?: ReadonlyMap<string, TargetTypeRef>,
  capturedParameters: readonly RustSourceGenericParameterContract[] = [],
): RustCallableGenericPlan {
  const native = context.input.program.records.nativeGenerics.get(declaration);
  if (native === undefined) failRustPlannerInvariant(
    "An emitted native callable requires its exact original pre-seal generic context.", declaration);
  capturedParameters = [...capturedParameters, ...native.implicitLifetimes];
  const sourceParameters = context.input.program.source.ast.typeParameters(declaration);
  if (sourceParameters.some((parameter) => parameter === undefined)) {
    failRustPlannerInvariant("An admitted callable requires its dense checked generic parameter list.", declaration);
  }
  if (sourceParameters.length === 0 && capturedParameters.length === 0) {
    if (specialization !== undefined && specialization.size !== 0) {
      failRustPlannerInvariant("An admitted non-generic callable cannot receive a target specialization.", declaration);
    }
    return {
      context: { ...context, callableDeclaration: declaration },
      preservesExplicitLifetimes: false,
      sourceTypeParameterIdentities: Object.freeze([]),
      parameterSlots: new Map(),
      finalizeGenerics: () => emptyRustGenerics,
    };
  }

  const sourceContract = native.sourceContract;
  if (sourceContract === undefined ||
    sourceContract.parameters.length !== sourceParameters.length ||
    sourceContract.parameters.some((parameter, index) =>
      parameter.declaration !== sourceParameters[index])) {
    failRustPlannerInvariant("An admitted callable requires its exact sealed native generic contract.", declaration);
  }

  const ordinaryParameters = sourceContract.parameters.filter(
    (parameter): parameter is Extract<RustSourceGenericParameterContract, { readonly kind: "type" }> =>
      parameter.kind === "type",
  );
  const typeParameterNames = new Map(context.typeParameterNames);
  for (const parameter of ordinaryParameters) typeParameterNames.set(parameter.identity, parameter.targetName);
  const selectedCaptures = capturedParameters.filter(parameter => parameter.kind === "type"
    ? context.typeParameterSubstitutions?.has(parameter.identity) !== true
    : !ownerLifetimes.has(rustLifetimeKey(parameter.lifetime)));
  const usedNames = new Set(ordinaryParameters.map(parameter => parameter.targetName));
  const lifetimeSubstitutions = new Map(context.lifetimeSubstitutions);
  for (const parameter of sourceContract.parameters) {
    if (parameter.kind === "lifetime") lifetimeSubstitutions.delete(rustLifetimeKey(parameter.lifetime));
  }
  for (const parameter of selectedCaptures) {
    if (parameter.kind === "type") typeParameterNames.set(parameter.identity,
      allocateRustGeneratedName(usedNames, parameter.targetName));
  }
  for (const [key, lifetime] of rustCapturedLifetimeSubstitutions(sourceContract.parameters, selectedCaptures))
    lifetimeSubstitutions.set(key, lifetime);
  context = { ...context, typeParameterNames, lifetimeSubstitutions };
  if (ordinaryParameters.some((parameter) =>
    !isValidRustIdentifier(parameter.targetName))) {
    failRustPlannerInvariant("An admitted callable type parameter requires its preserved native identifier.", declaration);
  }
  const sourceTypeParameterIdentities = Object.freeze(
    ordinaryParameters.map((parameter) => parameter.identity),
  );
  const requirementContract = context.promiseBody === true ? native.bodyRequirements : native.sourceRequirements;
  if (requirementContract === undefined ||
    requirementContract.typeParameters.length !== ordinaryParameters.length ||
    requirementContract.typeParameters.some((parameter, index) =>
      parameter.identity !== ordinaryParameters[index]?.identity)) {
    failRustPlannerInvariant("An admitted callable requires its exact sealed native type-requirement contract.", declaration);
  }

  const substitutions = new Map(context.typeParameterSubstitutions ?? []);
  if (specialization !== undefined) {
    if (specialization.size !== sourceTypeParameterIdentities.length ||
      sourceTypeParameterIdentities.some((name) => !specialization.has(name))) {
      failRustPlannerInvariant("An admitted callable specialization requires exact ordinary source type parameter coverage.", declaration);
    }
    for (const [name, carrier] of specialization) substitutions.set(name, carrier);
  }

  const declarationParameters: RustSourceGenericParameterContract[] = [];
  for (const parameter of [...sourceContract.parameters, ...selectedCaptures]) {
    const outlives = parameter.outlives.map(lifetime =>
      lifetimeSubstitutions.get(rustLifetimeKey(lifetime)) ?? lifetime);
    if (parameter.kind === "type") {
      declarationParameters.push({ ...parameter, outlives });
      continue;
    }
    const lifetime = lifetimeSubstitutions.get(rustLifetimeKey(parameter.lifetime)) ?? parameter.lifetime;
    if (lifetime.kind !== "parameter" && lifetime.kind !== "bound") {
      failRustPlannerInvariant("An admitted callable lifetime substitution requires its exact native binder.", declaration);
    }
    declarationParameters.push({ ...parameter, lifetime, outlives });
  }
  const declarationContract = { ...sourceContract, parameters: declarationParameters };
  rustSourceDeclarationGenerics(declarationContract);
  const requirementsByIdentity = new Map([...requirementContract.typeParameters, ...requirementContract.capturedTypeParameters].map((parameter) =>
    [parameter.identity, parameter.requirements] as const));
  const identities = new Map<RustGenericParameter, string>();
  const parameters = declarationContract.parameters.flatMap((parameter): readonly RustGenericParameter[] => {
    if (parameter.kind === "lifetime") {
      if (parameter.lifetime.kind !== "parameter") return Object.freeze([]);
      const rendered: RustGenericParameter = {
        kind: "lifetime" as const,
        name: parameter.lifetime.name,
        outlives: Object.freeze(parameter.outlives.map(rustLifetimeToAst)),
      };
      identities.set(rendered, rustLifetimeKey(parameter.lifetime));
      return Object.freeze([rendered]);
    }
    if (specialization?.has(parameter.identity) === true) return Object.freeze([]);
    const requirements = requirementsByIdentity.get(parameter.identity);
    if (requirements === undefined) {
      failRustPlannerInvariant("Sealed callable generic requirements lost one exact source type parameter.", declaration);
    }
    const rendered: RustGenericParameter = {
      kind: "type" as const,
      name: typeParameterNames.get(parameter.identity)!,
      bounds: rustTypeParameterBounds(parameter, requirements),
    };
    identities.set(rendered, parameter.identity);
    return Object.freeze([rendered]);
  });
  const orderedParameters = [
    ...parameters.filter(parameter => parameter.kind === "lifetime"),
    ...parameters.filter(parameter => parameter.kind !== "lifetime"),
    ...(specialization === undefined ? rustOptionalStorageParameters(requirementContract.optionalStorage, context) : []),
  ];
  const generics: RustGenerics = rustGenericsWithAssociatedBounds(orderedParameters,
    [...rustAssociatedPredicates(requirementContract.associatedTypes, { ...context, typeParameterSubstitutions: substitutions }),
      ...rustProjectProjectionPredicates(requirementContract.projectProjections, { ...context, typeParameterSubstitutions: substitutions })],
  );
  return {
    context: {
      ...context,
      callableDeclaration: declaration,
      ...(substitutions.size === 0 ? {} : { typeParameterSubstitutions: substitutions }),
    },
    preservesExplicitLifetimes: declarationContract.parameters.some(
      (parameter) => parameter.kind === "lifetime",
    ),
    sourceTypeParameterIdentities,
    parameterSlots: new Map(orderedParameters.flatMap((parameter, index) => {
      const identity = identities.get(parameter);
      return identity === undefined ? [] : [[identity, index] as const];
    })),
    finalizeGenerics: () => generics,
  };
}

export function rustCallableSpecialization(
  sourceTypeParameterIdentities: readonly string[],
  targetTypeArguments: readonly TargetTypeRef[],
): ReadonlyMap<string, TargetTypeRef> | undefined {
  if (sourceTypeParameterIdentities.length !== targetTypeArguments.length) {
    return undefined;
  }
  return new Map(sourceTypeParameterIdentities.map((name, index) =>
    [name, targetTypeArguments[index]!] as const));
}
