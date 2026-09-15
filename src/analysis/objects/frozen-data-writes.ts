import type { AstReader, Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustStructuralObjectCarrierValue } from "../../target-model/types/carriers/source-types.js";
import type { RustProjectTypeDefinition, RustProjectTypePolicy } from "../project-types/type-policy.js";
import type { RustObjectRepresentationPlan } from "../project-types/object-representation.js";
import { rustProjectObjectLayout } from "../project-types/object-layout.js";
import type { RustStructuralShapePlan } from "./structural-shape-plan.js";

export type RustFrozenWriteReceiver = "receiver" | "state" | "identity";

export interface RustFrozenDataWritePlan {
  receiverFor(storage: "project-object" | "structural-object", carrier: TargetTypeRef, index: number): RustFrozenWriteReceiver | undefined;
  receiverForDeclaration(declaration: Node): RustFrozenWriteReceiver | undefined;
}

export interface RustFrozenDataWriteRegistry extends RustFrozenDataWritePlan {
  initialize(input: {
    readonly jsEnabled: boolean;
    readonly ast: AstReader;
    readonly projectTypes: RustProjectTypePolicy;
    readonly representations: RustObjectRepresentationPlan;
    readonly structuralShapes: RustStructuralShapePlan;
  }): void;
  seal(): RustFrozenDataWritePlan;
}

export function createRustFrozenDataWriteRegistry(): RustFrozenDataWriteRegistry {
  let current: RustFrozenDataWritePlan | undefined;
  const requireCurrent = (): RustFrozenDataWritePlan => {
    if (current === undefined) throw new Error("Frozen data-write analysis has not been initialized.");
    return current;
  };
  return {
    initialize(input) {
      if (current !== undefined) throw new Error("Frozen data-write analysis is already initialized.");
      const declarations = new Map<Node, RustFrozenWriteReceiver>();
      const fields = new Map<RustProjectTypeDefinition, ReadonlyMap<number, RustFrozenWriteReceiver>>();
      if (input.jsEnabled) for (const definition of input.projectTypes.definitions) {
        const representation = input.representations.representationFor(definition);
        const layout = rustProjectObjectLayout(definition.declaration, input.ast);
        if (layout === undefined || representation === undefined || representation.kind === "value") continue;
        const mode = representation.kind === "shared-immutable" || representation.kind === "shared-mutable" ? "state" : "identity";
        const offset = input.projectTypes.externalBaseForDefinition(definition)?.fields.length ?? 0;
        const selected = new Map<number, RustFrozenWriteReceiver>();
        for (const field of layout.fields) {
          const name = input.ast.name(field.declaration);
          if (name !== undefined && input.ast.kindName(name) === "KindPrivateIdentifier") continue;
          declarations.set(field.declaration, mode);
          selected.set(offset + field.storageIndex, mode);
        }
        for (const member of input.ast.members(definition.declaration)) {
          if (member === undefined || input.ast.kindName(member) !== "KindMethodDeclaration" ||
            input.ast.hasModifierKind(member, "static")) continue;
          const name = input.ast.name(member);
          if (name === undefined || input.ast.kindName(name) === "KindPrivateIdentifier") continue;
          declarations.set(member, mode);
        }
        fields.set(definition, selected);
      }
      current = Object.freeze({
        receiverFor(storage: "project-object" | "structural-object", carrier: TargetTypeRef, index: number) {
          if (!input.jsEnabled) return undefined;
          if (storage === "structural-object") {
            const field = input.structuralShapes.field(carrier, index);
            return rustStructuralObjectCarrierValue(carrier)?.representation === "reference" && field !== undefined && field.storage !== "bound" &&
              field.method !== true && field.nativeLayout === undefined ? "receiver" as const : undefined;
          }
          const definition = input.projectTypes.definitionForCarrier(carrier);
          return definition === undefined ? undefined : fields.get(definition)?.get(index);
        },
        receiverForDeclaration: (declaration: Node) => declarations.get(declaration),
      });
    },
    receiverFor: (storage, carrier, index) => requireCurrent().receiverFor(storage, carrier, index),
    receiverForDeclaration: declaration => requireCurrent().receiverForDeclaration(declaration),
    seal: requireCurrent,
  };
}
