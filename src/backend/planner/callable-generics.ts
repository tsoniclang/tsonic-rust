import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../policy/types.js";
import type { RustTypeParameter } from "../rust-ast/nodes.js";
import {
  applyRustGenericRequirements,
  createRustGenericRequirementSet,
} from "./generic-requirements.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "./diagnostics.js";
import { diagnosticInput, isValidRustIdentifier } from "./plan-context.js";
import type { RustPlanContext } from "./plan-context.js";

export interface RustCallableGenericPlan {
  readonly context: RustPlanContext;
  readonly sourceTypeParameterNames: readonly string[];
  finalizeTypeParameters(): readonly RustTypeParameter[];
}

export function planRustCallableGenerics(
  declaration: Node,
  context: RustPlanContext,
  specialization?: ReadonlyMap<string, TargetTypeRef>,
): RustCallableGenericPlan | undefined {
  const sourceTypeParameterNames: string[] = [];
  const targetTypeParameters: RustTypeParameter[] = [];
  for (const typeParameter of context.input.ast.typeParameters(declaration)) {
    if (typeParameter === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, declaration),
        "rust.backend.type-parameter",
        "Callable declaration contains an undefined type-parameter slot.",
      ));
      return undefined;
    }
    const sourceNameNode = context.input.ast.name(typeParameter);
    const sourceName = sourceNameNode === undefined ? "" : context.input.ast.text(sourceNameNode);
    const targetName = context.input.names.nameForDeclaration(typeParameter) ?? "";
    if (sourceName.length === 0 || !isValidRustIdentifier(targetName)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, typeParameter),
        "rust.backend.generics",
        "Callable type parameters require exact source identity and valid Rust target names.",
      ));
      return undefined;
    }
    sourceTypeParameterNames.push(sourceName);
    targetTypeParameters.push({ name: targetName, bounds: [] });
  }

  if (specialization !== undefined) {
    if (specialization.size !== sourceTypeParameterNames.length ||
      sourceTypeParameterNames.some((name) => !specialization.has(name))) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, declaration),
        "rust.backend.callable-specialization",
        "Callable specialization does not cover the exact declared source type parameters.",
      ));
      return undefined;
    }
    const substitutions = new Map(context.typeParameterSubstitutions ?? []);
    for (const [name, carrier] of specialization) {
      substitutions.set(name, carrier);
    }
    return {
      context: { ...context, typeParameterSubstitutions: substitutions },
      sourceTypeParameterNames: Object.freeze(sourceTypeParameterNames),
      finalizeTypeParameters: () => Object.freeze([]),
    };
  }

  const genericRequirements = createRustGenericRequirementSet(
    targetTypeParameters.map((parameter) => parameter.name),
  );
  return {
    context: { ...context, genericRequirements },
    sourceTypeParameterNames: Object.freeze(sourceTypeParameterNames),
    finalizeTypeParameters: () => Object.freeze(
      applyRustGenericRequirements(targetTypeParameters, genericRequirements),
    ),
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
