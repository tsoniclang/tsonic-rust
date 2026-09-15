import type { Node } from "@tsonic/tsts";
import type { RustItem } from "../../target-ast/nodes.js";
import { emptyRustGenerics } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { diagnosticInput } from "../program/plan-context.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustProjectGenerics } from "../objects/polymorphism/names.js";
import { rustTargetGenericReferences } from "../../../target-model/types/carriers/generic-references.js";
import { rustAuthoredDeadCodeDisposition } from "../liveness/directives.js";

export function planRustTypeFamilyDeclaration(
  declaration: Node,
  context: RustPlanContext,
): readonly RustItem[] | undefined {
  const family = context.input.program.typeFamilies.families.find(candidate => candidate.declaration === declaration);
  if (family === undefined) return undefined;
  const name = context.input.program.names.nameForDeclaration(declaration);
  if (name === undefined) throw new Error("A sealed source type family has no target name.");
  const deadCode = rustAuthoredDeadCodeDisposition(context, declaration);
  return [{
    kind: "trait", visibility: "public", name, generics: emptyRustGenerics,
    ...(deadCode === undefined ? {} : { deadCode }),
    associatedTypes: [{ name: "Output", bounds: [] }], functions: [],
  }];
}

export function planRustTypeFamilyImplementations(context: RustPlanContext): readonly RustItem[] {
  const fileName = context.input.program.source.ast.getFileName(context.sourceFile);
  const items: RustItem[] = [];
  for (const implementation of context.input.program.typeFamilies.implementations) {
    if (implementation.sourceFileName !== fileName) continue;
    const owner = rustTypeFromCarrierInContext(implementation.owner, context);
    const trait = rustTypeFromCarrierInContext(implementation.family.trait, context);
    const output = rustTypeFromCarrierInContext(implementation.output, context);
    const parameters = rustTargetGenericReferences(implementation.owner);
    const definition = context.input.program.projectTypes.definitionForCarrier(implementation.owner);
    const generics = parameters.typeNames.length === 0 && parameters.lifetimes.length === 0 && parameters.constIdentities.length === 0
      ? emptyRustGenerics : definition === undefined ? undefined : rustProjectGenerics(definition, context);
    if (owner === undefined || trait === undefined || output === undefined || generics === undefined) {
      context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, implementation.family.declaration),
        "rust.backend.type-family-implementation", "A checked type family implementation has no exact native declaration contract."));
      continue;
    }
    items.push({ kind: "impl", trait, target: owner, generics,
      associatedTypes: [{ name: "Output", type: output }], functions: [] });
  }
  return items;
}
