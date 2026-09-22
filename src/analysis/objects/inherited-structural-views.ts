import type { RustFactWalk } from "../program/walk.js";
import { appendRustDiagnostic } from "../program/walk.js";
import { inferRustTargetGenericBindings, rustTargetGenericReferences, substituteRustTargetGenerics } from "../../target-model/types/index.js";
import { selectRustProjectStructuralView } from "./project-structural-views.js";

export function closeRustInheritedStructuralViews(walk: RustFactWalk): void {
  const { projectTypes, classValues } = walk.context;
  for (const view of classValues.instanceViewRequests()) {
    const owner = projectTypes.definitionForDeclaration(view.declaration);
    if (owner === undefined || !projectTypes.isPolymorphic(owner)) continue;
    for (const concrete of projectTypes.concreteClassesFor(owner)) {
      if (concrete === owner) continue;
      const carrier = projectTypes.openCarrier(concrete);
      const relationship = projectTypes.relationship(carrier, owner);
      const parameters = rustTargetGenericReferences(carrier);
      const bindings = relationship.kind !== "related" ? undefined : inferRustTargetGenericBindings(relationship.targetType, view.sourceCarrier, {
        typeNames: new Set(parameters.typeNames), lifetimeIdentities: new Set(parameters.lifetimeIdentities), constIdentities: new Set(parameters.constIdentities),
      });
      const selectedCarrier = bindings === undefined ? undefined : substituteRustTargetGenerics(carrier, bindings.types, bindings.lifetimes, bindings.consts);
      const semantics = walk.context.semanticsFor(concrete.declaration);
      const sourceType = semantics.declarations.declaredType(concrete.declaration);
      if (selectedCarrier === undefined || sourceType === undefined ||
        !selectRustProjectStructuralView(walk, concrete.declaration, selectedCarrier, view.targetCarrier, semantics, sourceType)) {
        appendRustDiagnostic(walk, "RUST_INHERITED_STRUCTURAL_VIEW_NOT_CLOSED",
          "An inherited native structural contract requires the exact descendant instantiation and member correspondence.", concrete.declaration,
          ["target.capability=rust.structural-view.inherited-native-contract"]);
      }
    }
  }
}
