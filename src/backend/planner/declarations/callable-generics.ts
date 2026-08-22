import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustTypeParameter } from "../../target-ast/nodes.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { diagnosticInput, isValidRustIdentifier } from "../program/plan-context.js";
import type { RustPlanContext } from "../program/plan-context.js";

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
  for (const typeParameter of context.input.program.source.ast.typeParameters(declaration)) {
    if (typeParameter === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, declaration),
        "rust.backend.type-parameter",
        "Callable declaration contains an undefined type-parameter slot.",
      ));
      return undefined;
    }
    const sourceNameNode = context.input.program.source.ast.name(typeParameter);
    const sourceName = sourceNameNode === undefined ? "" : context.input.program.source.ast.text(sourceNameNode);
    const targetName = context.input.program.names.nameForDeclaration(typeParameter) ?? "";
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
  const contract = context.input.program.callableGenericRequirements.contractFor(
    declaration,
  );
  if (contract === undefined ||
    contract.typeParameters.length !== targetTypeParameters.length ||
    contract.typeParameters.some((parameter, index) =>
      parameter.name !== targetTypeParameters[index]?.name)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.callable-generic-contract",
      "Callable declaration has no exact sealed Rust generic-requirement contract.",
    ));
    return undefined;
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
      context: {
        ...context,
        callableDeclaration: declaration,
        typeParameterSubstitutions: substitutions,
      },
      sourceTypeParameterNames: Object.freeze(sourceTypeParameterNames),
      finalizeTypeParameters: () => Object.freeze([]),
    };
  }

  const finalizedTypeParameters = Object.freeze(targetTypeParameters.map(
    (parameter, index): RustTypeParameter => ({
      ...parameter,
      bounds: contract.typeParameters[index]!.requirements.map((requirement) =>
        requirement === "static"
          ? { kind: "lifetime" as const, name: "static" }
          : {
              kind: "trait" as const,
              path: requirement === "clone" ? "Clone" : "Default",
            }),
    }),
  ));
  return {
    context: { ...context, callableDeclaration: declaration },
    sourceTypeParameterNames: Object.freeze(sourceTypeParameterNames),
    finalizeTypeParameters: () => finalizedTypeParameters,
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
