import type { Node } from "@tsonic/tsts";
import type { RustGenerics, RustItem } from "../../target-ast/syntax/nodes.js";
import { emptyRustGenerics } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../../invariants.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustProjectGenerics } from "../objects/polymorphism/names.js";
import { rustGenericRequirementBounds } from "../types/generic-bounds.js";
import { rustAssociatedPredicates } from "../types/associated-bounds.js";
import { planRustIndexedFieldImplementation } from "./classes/indexed-fields.js";
import { rustGeneratedTypeParameterContext } from "../names/type-parameters.js";

export function planRustTypeFamilyDeclaration(
  declaration: Node,
  context: RustPlanContext,
): readonly RustItem[] {
  const admitted = context.input.program.records.nativeDeclaration.get(declaration);
  if (admitted?.kind !== "alias" || admitted.fact.kind !== "family" || admitted.family === undefined) {
    return failRustPlannerInvariant("Type-family emission requires its exact sealed declaration and native name.", declaration);
  }
  const name = admitted.name;
  const liveness = context.input.program.records.declarationLiveness.get(declaration);
  if (liveness === undefined) failRustPlannerInvariant("An admitted type family requires its native declaration liveness.", declaration);
  const { deadCode } = liveness;
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
  const implementations = context.input.program.records.nativeTypeFamilyImplementations.get(context.sourceFile);
  if (implementations === undefined) failRustPlannerInvariant("A source file requires its sealed native type-family implementations.", context.sourceFile);
  for (const admitted of implementations) {
    const { implementation } = admitted;
    context = baseContext;
    if (implementation.sourceFileName !== fileName) continue;
    if (implementation.family.kind === "indexed") {
      items.push(...planRustIndexedFieldImplementation(admitted, context));
      continue;
    }
    const contract = admitted.genericContract;
    context = rustGeneratedTypeParameterContext(contract.typeParameters, [], context);
    const owner = rustTypeFromCarrierInContext(implementation.owner, context);
    const trait = rustTypeFromCarrierInContext({ ...implementation.family.trait,
      genericArguments: implementation.arguments }, context);
    const output = rustTypeFromCarrierInContext(implementation.output, context);
    const definition = admitted.projectDefinition;
    const compoundGenerics: RustGenerics = {
        parameters: contract.typeParameters.map(parameter => ({ kind: "type", name: context.typeParameterNames?.get(parameter.identity) ?? parameter.name,
          bounds: rustGenericRequirementBounds(parameter.requirements) })),
        wherePredicates: rustAssociatedPredicates(contract.associatedTypes, context),
      };
    const generics = definition === undefined ? compoundGenerics : rustProjectGenerics(definition, context);
    if (owner === undefined || trait === undefined || output === undefined) {
      failRustPlannerInvariant("An admitted type-family implementation requires renderable native owner, trait and output types.", implementation.family.declaration);
    }
    items.push({ kind: "impl", trait, target: owner, generics,
      members: [{ kind: "type", name: "Output", generics: emptyRustGenerics, type: output }] });
  }
  return items;
}
