import type { Node } from "@tsonic/tsts";
import type {
  RustBound,
  RustGenericParameter,
  RustGenerics as RustSemanticGenerics,
  RustSemanticIdentity,
} from "../../../target-model/semantics/index.js";
import {
  rustBoundSemanticKey,
  rustSemanticIdentitiesEqual,
} from "../../../target-model/semantics/index.js";
import {
  emptyRustGenericSubstitutions,
  mergeRustGenericSubstitutions,
  rustCloneTrait,
  rustDefaultTrait,
  rustGenericParameterIdentityKey,
  rustSendTrait,
  rustSyncTrait,
  rustUnpinTrait,
  substituteRustGenerics,
} from "../../../target-model/types/index.js";
import type { RustGenericSubstitutions } from "../../../target-model/types/index.js";
import type { RustGenerics } from "../../target-ast/nodes.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { diagnosticInput } from "../program/plan-context.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustAstGenericsFromSemanticInContext } from "../types/render.js";
import type { RustGenericRequirement } from "../../../analysis/callables/generic-requirements.js";

export interface RustCallableGenericPlan {
  readonly context: RustPlanContext;
  finalizeGenerics(): RustGenerics;
}

export function planRustCallableGenerics(
  declaration: Node,
  context: RustPlanContext,
  specialization?: RustGenericSubstitutions,
): RustCallableGenericPlan | undefined {
  const sourceContract = context.input.program.sourceGenerics.contractFor(declaration);
  if (sourceContract === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.source-generic-contract",
      "Callable declaration has no exact sealed source-generic contract.",
    ));
    return undefined;
  }
  const sourceTypeParameters = sourceContract.parameters.filter((parameter) =>
    parameter.parameter.kind === "type");
  const inferred = context.input.program.callableGenericRequirements.contractFor(declaration);
  if (inferred === undefined || inferred.typeParameters.length !== sourceTypeParameters.length ||
    inferred.typeParameters.some((parameter, index) => {
      const sourceParameter = sourceTypeParameters[index]?.parameter;
      return sourceParameter?.kind !== "type" || !rustSemanticIdentitiesEqual(
        parameter.identity,
        sourceParameter.identity,
      );
    })) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.callable-generic-contract",
      "Callable declaration has no exact sealed Rust generic-requirement contract.",
    ));
    return undefined;
  }

  if (specialization !== undefined) {
    const requiredTypeIdentities = sourceContract.parameters.flatMap((parameter) => {
      const semantic = parameter.parameter;
      const identity = rustGenericParameterIdentityKey(semantic);
      return semantic.kind === "type" && identity !== undefined ? [identity] : [];
    });
    const requiredConstIdentities = sourceContract.parameters.flatMap((parameter) => {
      const semantic = parameter.parameter;
      const identity = rustGenericParameterIdentityKey(semantic);
      return semantic.kind === "const" && identity !== undefined ? [identity] : [];
    });
    if (specialization.lifetimes.size !== 0 ||
      specialization.types.size !== requiredTypeIdentities.length ||
      specialization.consts.size !== requiredConstIdentities.length ||
      requiredTypeIdentities.some((identity) => !specialization.types.has(identity)) ||
      requiredConstIdentities.some((identity) => !specialization.consts.has(identity))) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, declaration),
        "rust.backend.callable-specialization",
        "Finite source-callable specialization must cover exactly the callable's type and const parameters while preserving lifetime parameters.",
      ));
      return undefined;
    }
    const substitutions = mergeRustGenericSubstitutions(
      context.genericSubstitutions ?? emptyRustGenericSubstitutions,
      specialization,
    );
    if (substitutions === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, declaration),
        "rust.backend.callable-specialization-conflict",
        "Finite source-callable specialization conflicts with the enclosing exact Rust generic substitution.",
      ));
      return undefined;
    }
    const specializedGenerics = substituteRustGenerics(
      mergeInferredRequirements(sourceContract.generics, inferred.typeParameters),
      substitutions,
      { omitSubstitutedParameters: true },
    );
    const renderedSpecialized = rustAstGenericsFromSemanticInContext(
      specializedGenerics,
      { ...context, genericSubstitutions: substitutions },
    );
    if (renderedSpecialized === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, declaration),
        "rust.backend.callable-specialization-rendering",
        "Finite source-callable specialization cannot render its retained lifetime contract.",
      ));
      return undefined;
    }
    return {
      context: {
        ...context,
        callableDeclaration: declaration,
        genericSubstitutions: substitutions,
      },
      finalizeGenerics: () => renderedSpecialized,
    };
  }

  const semanticGenerics = mergeInferredRequirements(
    sourceContract.generics,
    inferred.typeParameters,
  );
  const rendered = rustAstGenericsFromSemanticInContext(semanticGenerics, context);
  if (rendered === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.generic-rendering",
      "Callable generic parameters, defaults, or where predicates cannot be rendered from their sealed Rust semantics.",
    ));
    return undefined;
  }
  return {
    context: { ...context, callableDeclaration: declaration },
    finalizeGenerics: () => rendered,
  };
}

function mergeInferredRequirements(
  generics: RustSemanticGenerics,
  requirements: readonly {
    readonly identity: RustSemanticIdentity;
    readonly requirements: readonly RustGenericRequirement[];
  }[],
): RustSemanticGenerics {
  const parameters = generics.parameters.map((parameter): RustGenericParameter => {
    if (parameter.kind !== "type") return parameter;
    const selected = requirements.find((candidate) =>
      rustSemanticIdentitiesEqual(candidate.identity, parameter.identity));
    if (selected === undefined || selected.requirements.length === 0) return parameter;
    const inferredBounds: RustBound[] = selected.requirements.map((requirement): RustBound =>
      requirement === "static"
        ? {
            kind: "type-outlives",
            type: {
              kind: "type-parameter",
              identity: parameter.identity,
              displayName: parameter.displayName,
            },
            lifetime: { kind: "static" },
          }
        : {
            kind: "trait",
            trait: requirement === "clone"
              ? rustCloneTrait
              : requirement === "default"
                ? rustDefaultTrait
                : requirement === "send"
                  ? rustSendTrait
                  : requirement === "sync"
                    ? rustSyncTrait
                    : rustUnpinTrait,
            polarity: "required",
          });
    const existing = new Set(parameter.bounds.map(rustBoundSemanticKey));
    return Object.freeze({
      ...parameter,
      bounds: Object.freeze([
        ...parameter.bounds,
        ...inferredBounds.filter((bound) => !existing.has(rustBoundSemanticKey(bound))),
      ]),
    });
  });
  return Object.freeze({
    parameters: Object.freeze(parameters),
    wherePredicates: generics.wherePredicates,
  });
}
