import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import {
  rustLifetimeName,
  type RustLifetimeRef,
  type RustSourceGenericParameterContract,
} from "../../../target-model/lifetimes/index.js";
import {
  emptyRustGenerics,
  type RustGenerics,
  type RustGenericParameter,
  type RustLifetime,
  type RustTypeBound,
} from "../../target-ast/nodes.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { diagnosticInput, isValidRustIdentifier } from "../program/plan-context.js";
import type { RustPlanContext } from "../program/plan-context.js";

export interface RustCallableGenericPlan {
  readonly context: RustPlanContext;
  readonly preservesExplicitLifetimes: boolean;
  readonly sourceTypeParameterNames: readonly string[];
  finalizeGenerics(): RustGenerics;
}

export function rustSourceDeclarationGenerics(
  contract: import("../../../target-model/lifetimes/index.js").RustSourceGenericContract,
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
  if (sourceParameters.length === 0) {
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
      sourceTypeParameterNames: Object.freeze([]),
      finalizeGenerics: () => emptyRustGenerics,
    };
  }

  const sourceContract = context.input.program.sourceLifetimes.contractFor(declaration);
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
  if (ordinaryParameters.some((parameter) =>
    !isValidRustIdentifier(parameter.targetName))) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.generics",
      "Callable type parameters require exact valid Rust target names.",
    ));
    return undefined;
  }
  const sourceTypeParameterNames = Object.freeze(
    ordinaryParameters.map((parameter) => parameter.sourceName),
  );
  const requirementContract = context.input.program.callableGenericRequirements.contractFor(
    declaration,
  );
  if (requirementContract === undefined ||
    requirementContract.typeParameters.length !== ordinaryParameters.length ||
    requirementContract.typeParameters.some((parameter, index) =>
      parameter.name !== ordinaryParameters[index]?.targetName)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.callable-generic-requirements",
      "Callable declaration has no exact sealed Rust type-requirement contract.",
    ));
    return undefined;
  }

  const substitutions = new Map(context.typeParameterSubstitutions ?? []);
  if (specialization !== undefined) {
    if (specialization.size !== sourceTypeParameterNames.length ||
      sourceTypeParameterNames.some((name) => !specialization.has(name))) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, declaration),
        "rust.backend.callable-specialization",
        "Callable specialization does not cover the exact ordinary source type parameters.",
      ));
      return undefined;
    }
    for (const [name, carrier] of specialization) substitutions.set(name, carrier);
  }

  const declarationGenerics = rustSourceDeclarationGenerics(sourceContract);
  if (declarationGenerics === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.callable-generic-contract",
      "Callable declaration has a bound lifetime contract that cannot be emitted as item generics.",
    ));
    return undefined;
  }
  const requirementsByName = new Map(requirementContract.typeParameters.map((parameter) =>
    [parameter.name, parameter.requirements] as const));
  const parameters = sourceContract.parameters.flatMap((parameter): readonly RustGenericParameter[] => {
    if (parameter.kind === "lifetime") {
      if (parameter.lifetime.kind !== "parameter") return Object.freeze([]);
      return Object.freeze([{
        kind: "lifetime" as const,
        name: parameter.lifetime.name,
        outlives: Object.freeze(parameter.outlives.map(rustLifetimeToAst)),
      }]);
    }
    if (specialization !== undefined) return Object.freeze([]);
    const requirements = requirementsByName.get(parameter.targetName);
    if (requirements === undefined) {
      throw new Error("Sealed callable generic requirements lost one exact source type parameter.");
    }
    return Object.freeze([{
      kind: "type" as const,
      name: parameter.targetName,
      bounds: mergeTypeBounds(parameter, requirements),
    }]);
  });
  const generics: RustGenerics = Object.freeze({
    parameters: Object.freeze(parameters),
    wherePredicates: Object.freeze([]),
  });
  return {
    context: {
      ...context,
      callableDeclaration: declaration,
      ...(substitutions.size === 0 ? {} : { typeParameterSubstitutions: substitutions }),
    },
    preservesExplicitLifetimes: sourceContract.parameters.some(
      (parameter) => parameter.kind === "lifetime",
    ),
    sourceTypeParameterNames,
    finalizeGenerics: () => generics,
  };
}

export function rustCallableSpecialization(
  sourceTypeParameterNames: readonly string[],
  targetTypeArguments: readonly TargetTypeRef[],
): ReadonlyMap<string, TargetTypeRef> | undefined {
  if (sourceTypeParameterNames.length !== targetTypeArguments.length) {
    return undefined;
  }
  return new Map(sourceTypeParameterNames.map((name, index) =>
    [name, targetTypeArguments[index]!] as const));
}

export function rustLifetimeToAst(lifetime: RustLifetimeRef): RustLifetime {
  return lifetime.kind === "static"
    ? { kind: "static" }
    : lifetime.kind === "placeholder"
      ? { kind: "placeholder" }
      : { kind: "named", name: rustLifetimeName(lifetime) };
}

function mergeTypeBounds(
  parameter: Extract<RustSourceGenericParameterContract, { readonly kind: "type" }>,
  requirements: readonly import("../../../analysis/callables/generic-requirements.js").RustGenericRequirement[],
): readonly RustTypeBound[] {
  const bounds: RustTypeBound[] = [
    ...parameter.outlives.map((lifetime): RustTypeBound => ({
      kind: "lifetime",
      lifetime: rustLifetimeToAst(lifetime),
    })),
    ...(parameter.maybeSized ? [{ kind: "maybe-sized" as const }] : []),
  ];
  for (const requirement of requirements) {
    const candidate: RustTypeBound = requirement === "static"
      ? { kind: "lifetime", lifetime: { kind: "static" } }
      : {
          kind: "trait",
          path: requirement === "clone" ? "Clone" : "Default",
        };
    if (!bounds.some((bound) => typeBoundsEqual(bound, candidate))) bounds.push(candidate);
  }
  return Object.freeze(bounds);
}

function typeBoundsEqual(left: RustTypeBound, right: RustTypeBound): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "trait" && right.kind === "trait") return left.path === right.path;
  if (left.kind === "lifetime" && right.kind === "lifetime") {
    return left.lifetime.kind === right.lifetime.kind &&
      (left.lifetime.kind !== "named" ||
        right.lifetime.kind === "named" && left.lifetime.name === right.lifetime.name);
  }
  return left.kind === "maybe-sized" && right.kind === "maybe-sized";
}
