import type { Node } from "@tsonic/tsts";
import type {
  RustDeclarationContract,
  RustDeclarationImplContract,
} from "../../../analysis/declarations/declaration-applications.js";
import type { RustAttribute } from "../../target-ast/attributes.js";
import type {
  RustGenerics,
  RustItem,
  RustType,
} from "../../target-ast/nodes.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { diagnosticInput } from "../program/plan-context.js";
import type { RustPlanContext } from "../program/plan-context.js";

export function rustExplicitDeclarationContract(
  declaration: Node,
  context: RustPlanContext,
): RustDeclarationContract | undefined {
  return context.input.program.declarationContracts.forDeclaration(declaration);
}

export function rustExplicitRepresentationAttributes(
  declaration: Node,
  context: RustPlanContext,
): readonly RustAttribute[] {
  const contract = rustExplicitDeclarationContract(declaration, context);
  return contract === undefined || contract.representations.length === 0
    ? emptyAttributes
    : [Object.freeze({
        kind: "repr" as const,
        representations: Object.freeze(contract.representations.map((representation) => {
          switch (representation.kind) {
            case "c":
            case "transparent":
              return Object.freeze({ kind: representation.kind });
            case "packed":
            case "align":
              return Object.freeze({
                kind: representation.kind,
                alignment: representation.alignment,
              });
          }
        })),
      })];
}

export function planRustExplicitTraitImplementations(
  declaration: Node,
  target: RustType,
  generics: RustGenerics,
  context: RustPlanContext,
): readonly RustItem[] | undefined {
  const contract = rustExplicitDeclarationContract(declaration, context);
  if (contract === undefined || contract.traitImpls.length === 0) return emptyItems;
  const items: RustItem[] = [];
  for (const implementation of contract.traitImpls.filter((candidate) =>
    candidate.emission === "standalone")) {
    const trait = renderTrait(implementation, context);
    if (trait === undefined) return undefined;
    items.push(Object.freeze({
      kind: "impl" as const,
      generics,
      trait,
      target,
      polarity: implementation.polarity,
      safety: implementation.safety,
      functions: Object.freeze([]),
      associatedTypes: Object.freeze([]),
      associatedConstants: Object.freeze([]),
    }));
  }
  return Object.freeze(items);
}

export function rustProjectTraitImplementationSafety(
  declaration: Node,
  trait: TargetTypeRef,
  context: RustPlanContext,
): "safe" | "unsafe" | undefined {
  const traitDefinition = context.input.program.projectTypes.definitionForCarrier(trait);
  const traitContract = traitDefinition === undefined
    ? undefined
    : context.input.program.declarationContracts.forDeclaration(traitDefinition.declaration);
  if (traitContract?.unsafeTrait !== true) return "safe";
  const implementations = context.input.program.declarationContracts
    .forDeclaration(declaration)?.traitImpls.filter((implementation) =>
      implementation.emission === "project-relation" &&
      implementation.polarity === "positive" &&
      rustTargetTypeRefEquals(implementation.trait, trait)) ?? [];
  if (implementations.length === 1 && implementations[0]!.safety === "unsafe") {
    return "unsafe";
  }
  context.diagnostics.push(missingFactDiagnostic(
    diagnosticInput(context, declaration),
    "rust.backend.unsafe-project-trait-implementation",
    "An exact unsafe project trait relation has no finalized explicit unsafe implementation contract.",
  ));
  return undefined;
}

function renderTrait(
  implementation: RustDeclarationImplContract,
  context: RustPlanContext,
): RustType | undefined {
  const trait = rustTypeFromCarrierInContext(implementation.trait, context);
  if (trait !== undefined) return trait;
  context.diagnostics.push(missingFactDiagnostic(
    diagnosticInput(context, implementation.sourceSubject),
    "rust.backend.explicit-trait-implementation",
    "An explicit Rust trait implementation has no renderable finalized trait carrier.",
  ));
  return undefined;
}

const emptyAttributes = Object.freeze([]) as readonly RustAttribute[];
const emptyItems = Object.freeze([]) as readonly RustItem[];
