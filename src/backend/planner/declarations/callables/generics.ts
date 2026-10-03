import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { rustGenericsWithAssociatedBounds } from "../../types/generic-bounds.js";
import {
  type RustSourceGenericParameterContract,
} from "../../../../target-model/lifetimes/index.js";
import {
  emptyRustGenerics,
  type RustGenerics,
  type RustGenericParameter,
  type RustTypeBound,
} from "../../../target-ast/nodes.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../../diagnostics.js";
import { diagnosticInput, isValidRustIdentifier } from "../../program/plan-context.js";
import { rustLifetimeToAst } from "../../types/lifetime-syntax.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustDeclarationAssociatedPredicates } from "../../types/associated-bounds.js";
import { rustTypeParameterBounds } from "../../types/generic-bounds.js";
import { rustOptionalStorageParameters } from "../../types/type-projections.js";
import { allocateRustGeneratedName } from "../../../../target-model/names/generated.js";

export interface RustCallableGenericPlan {
  readonly context: RustPlanContext;
  readonly preservesExplicitLifetimes: boolean;
  readonly sourceTypeParameterIdentities: readonly string[];
  finalizeGenerics(): RustGenerics;
}

export function rustSourceDeclarationGenerics(
  contract: import("../../../../target-model/lifetimes/index.js").RustSourceGenericContract,
): RustGenerics | undefined {
  if (contract.lifetimeBinder !== undefined) return undefined;
  const parameters: RustGenericParameter[] = [];
  for (const parameter of contract.parameters) {
    if (parameter.kind === "lifetime") {
      if (parameter.lifetime.kind !== "parameter") return undefined;
      parameters.push({
        kind: "lifetime",
        name: parameter.lifetime.name,
        outlives: Object.freeze(parameter.outlives.map(rustLifetimeToAst)),
      });
      continue;
    }
    if (!isValidRustIdentifier(parameter.targetName)) return undefined;
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
  specialization?: ReadonlyMap<string, TargetTypeRef>,
  capturedParameters: readonly RustSourceGenericParameterContract[] = [],
): RustCallableGenericPlan | undefined {
  const sourceParameters = context.input.program.source.ast.typeParameters(declaration);
  if (sourceParameters.some((parameter) => parameter === undefined)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.generic-parameter",
      "Callable declaration contains an undefined generic-parameter slot.",
    ));
    return undefined;
  }
  if (sourceParameters.length === 0 && capturedParameters.length === 0) {
    if (specialization !== undefined && specialization.size !== 0) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, declaration),
        "rust.backend.callable-specialization",
        "A non-generic callable received a target specialization.",
      ));
      return undefined;
    }
    return {
      context: { ...context, callableDeclaration: declaration },
      preservesExplicitLifetimes: false,
      sourceTypeParameterIdentities: Object.freeze([]),
      finalizeGenerics: () => emptyRustGenerics,
    };
  }

  const sourceContract = sourceParameters.length === 0 ? { declaration, parameters: [] }
    : context.input.program.sourceLifetimes.contractFor(declaration);
  if (sourceContract === undefined ||
    sourceContract.parameters.length !== sourceParameters.length ||
    sourceContract.parameters.some((parameter, index) =>
      parameter.declaration !== sourceParameters[index])) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.callable-generic-contract",
      "Callable declaration has no exact sealed Rust generic contract.",
    ));
    return undefined;
  }

  const ordinaryParameters = sourceContract.parameters.filter(
    (parameter): parameter is Extract<RustSourceGenericParameterContract, { readonly kind: "type" }> =>
      parameter.kind === "type",
  );
  const typeParameterNames = new Map(context.typeParameterNames);
  for (const parameter of ordinaryParameters) typeParameterNames.set(parameter.identity, parameter.targetName);
  const selectedCaptures = capturedParameters.filter(parameter => parameter.kind !== "type" ||
    context.typeParameterSubstitutions?.has(parameter.identity) !== true);
  const usedNames = new Set(ordinaryParameters.map(parameter => parameter.targetName));
  for (const parameter of selectedCaptures) {
    if (parameter.kind === "type") typeParameterNames.set(parameter.identity,
      allocateRustGeneratedName(usedNames, parameter.targetName));
  }
  context = { ...context, typeParameterNames };
  if (ordinaryParameters.some((parameter) =>
    !isValidRustIdentifier(parameter.targetName))) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.generics",
      "Callable type parameters require exact valid Rust target names.",
    ));
    return undefined;
  }
  const sourceTypeParameterIdentities = Object.freeze(
    ordinaryParameters.map((parameter) => parameter.identity),
  );
  const requirementContract = context.input.program.declarationGenericRequirements.contractFor(
    declaration,
  );
  if (requirementContract === undefined ||
    requirementContract.typeParameters.length !== ordinaryParameters.length ||
    requirementContract.typeParameters.some((parameter, index) =>
      parameter.identity !== ordinaryParameters[index]?.identity)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.callable-generic-requirements",
      "Callable declaration has no exact sealed Rust type-requirement contract.",
    ));
    return undefined;
  }

  const substitutions = new Map(context.typeParameterSubstitutions ?? []);
  if (specialization !== undefined) {
    if (specialization.size !== sourceTypeParameterIdentities.length ||
      sourceTypeParameterIdentities.some((name) => !specialization.has(name))) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, declaration),
        "rust.backend.callable-specialization",
        "Callable specialization does not cover the exact ordinary source type parameters.",
      ));
      return undefined;
    }
    for (const [name, carrier] of specialization) substitutions.set(name, carrier);
  }

  const declarationContract = { ...sourceContract, parameters: [...sourceContract.parameters, ...selectedCaptures] };
  const declarationGenerics = rustSourceDeclarationGenerics(declarationContract);
  if (declarationGenerics === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.callable-generic-contract",
      "Callable declaration has a bound lifetime contract that cannot be emitted as item generics.",
    ));
    return undefined;
  }
  const requirementsByIdentity = new Map([...requirementContract.typeParameters, ...requirementContract.capturedTypeParameters].map((parameter) =>
    [parameter.identity, parameter.requirements] as const));
  const parameters = declarationContract.parameters.flatMap((parameter): readonly RustGenericParameter[] => {
    if (parameter.kind === "lifetime") {
      if (parameter.lifetime.kind !== "parameter") return Object.freeze([]);
      return Object.freeze([{
        kind: "lifetime" as const,
        name: parameter.lifetime.name,
        outlives: Object.freeze(parameter.outlives.map(rustLifetimeToAst)),
      }]);
    }
    if (specialization?.has(parameter.identity) === true) return Object.freeze([]);
    const requirements = requirementsByIdentity.get(parameter.identity);
    if (requirements === undefined) {
      throw new Error("Sealed callable generic requirements lost one exact source type parameter.");
    }
    return Object.freeze([{
      kind: "type" as const,
      name: typeParameterNames.get(parameter.identity)!,
      bounds: rustTypeParameterBounds(parameter, requirements),
    }]);
  });
  const generics: RustGenerics = rustGenericsWithAssociatedBounds([
    ...parameters.filter(parameter => parameter.kind === "lifetime"),
    ...parameters.filter(parameter => parameter.kind !== "lifetime"),
    ...(specialization === undefined ? rustOptionalStorageParameters(requirementContract.optionalStorage, context) : []),
  ],
    rustDeclarationAssociatedPredicates(declaration, {
      ...context, typeParameterSubstitutions: substitutions,
    }),
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
