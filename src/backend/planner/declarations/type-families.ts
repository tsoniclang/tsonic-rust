import type { Node } from "@tsonic/tsts";
import type { RustGenerics, RustItem } from "../../target-ast/syntax/nodes.js";
import { emptyRustGenerics } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { diagnosticInput } from "../program/plan-context.js";
import { failRustPlannerInvariant, missingFactDiagnostic } from "../diagnostics.js";
import { rustTypeFromSelectedNativeCarrierInContext } from "../types/render.js";
import { rustProjectGenerics } from "../objects/polymorphism/names.js";
import { rustAuthoredDeadCodeDisposition } from "../program/reachability-directives.js";
import { rustGenericRequirementBounds } from "../types/generic-bounds.js";
import { rustAssociatedPredicates } from "../types/associated-bounds.js";
import { planRustIndexedFieldImplementation } from "./classes/indexed-fields.js";
import { rustGeneratedTypeParameterContext } from "../names/type-parameters.js";

export function planRustTypeFamilyDeclaration(
  declaration: Node,
  context: RustPlanContext,
): readonly RustItem[] | undefined {
  const admitted = context.input.program.nativeDeclarations.get(declaration);
  if (admitted?.kind !== "alias" || admitted.fact.kind !== "family" || admitted.family === undefined) {
    return failRustPlannerInvariant("Type-family emission requires its exact sealed declaration and native name.", declaration);
  }
  const name = admitted.name;
  const deadCode = rustAuthoredDeadCodeDisposition(context, declaration);
  return [{
    kind: "trait", visibility: "public", name, generics: emptyRustGenerics,
    ...(deadCode === undefined ? {} : { deadCode }),
    members: [{ kind: "type", name: "Output", generics: emptyRustGenerics, bounds: [] }],
  }];
}

export function planRustTypeFamilyImplementations(context: RustPlanContext): readonly RustItem[] {
  const fileName = context.input.program.source.ast.getFileName(context.sourceFile);
  const items: RustItem[] = [];
  const baseContext = context;
  for (const admitted of context.input.program.nativeDeclarations.implementations) {
    const { implementation } = admitted;
    context = baseContext;
    if (implementation.sourceFileName !== fileName) continue;
    if (implementation.family.kind === "indexed") {
      const selected = planRustIndexedFieldImplementation(implementation, context);
      if (selected === undefined) context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, context.sourceFile),
        "rust.backend.indexed-field-implementation", "A dependent field has no exact native storage implementation."));
      else items.push(...selected);
      continue;
    }
    const contract = context.input.program.declarationGenericRequirements.contractForCarrier({
      kind: "tuple", elements: [implementation.owner, implementation.output],
    });
    if (contract === undefined) return failRustPlannerInvariant(
      "An admitted type-family implementation lost its selected native generic contract.");
    context = rustGeneratedTypeParameterContext(contract.typeParameters, [], context);
    const selected = admitted.nativeTypes;
    if (selected === null) return failRustPlannerInvariant(
      "An admitted conditional implementation lost its selected native types.", implementation.family.declaration);
    const owner = rustTypeFromSelectedNativeCarrierInContext(selected.owner, context);
    const trait = rustTypeFromSelectedNativeCarrierInContext(selected.trait, context);
    const output = rustTypeFromSelectedNativeCarrierInContext(selected.output, context);
    const definition = admitted.projectDefinition;
    const compoundGenerics: RustGenerics = {
        parameters: contract.typeParameters.map(parameter => ({ kind: "type", name: context.typeParameterNames?.get(parameter.identity) ?? parameter.name,
          bounds: rustGenericRequirementBounds(parameter.requirements) })),
        wherePredicates: rustAssociatedPredicates(contract.associatedTypes, context),
      };
    const generics = definition === undefined ? compoundGenerics : rustProjectGenerics(definition, context);
    items.push({ kind: "impl", trait, target: owner, generics,
      members: [{ kind: "type", name: "Output", generics: emptyRustGenerics, type: output }] });
  }
  return items;
}
