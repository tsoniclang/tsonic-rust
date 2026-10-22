import type { Node } from "@tsonic/tsts";
import type { RustFactWalk } from "../../program/walk.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { sourceTypeCarrierForDeclaration } from "../../operations/inputs.js";

export interface RustClassReceiverCarriers {
  readonly thisCarrier: TargetTypeRef;
  readonly superCarrier: TargetTypeRef | undefined;
}

// The `this` and `super` carriers in force inside the bodies of one class's members.
export function rustClassReceiverCarriers(walk: RustFactWalk, declaration: Node): RustClassReceiverCarriers | undefined {
  const thisCarrier = sourceTypeCarrierForDeclaration(walk, declaration);
  if (thisCarrier === undefined) return undefined;
  const definition = walk.context.projectTypes.definitionForDeclaration(declaration);
  const superCarrier = definition === undefined
    ? undefined
    : walk.context.projectTypes.heritageForDefinition(definition).find((edge) =>
        edge.kind === "extends" && edge.target.kind === "class")?.targetType ??
      walk.context.projectTypes.externalBaseForDefinition(definition)?.targetType;
  return { thisCarrier, superCarrier };
}

// The owning class of a method, accessor or constructor; undefined for every other callable.
export function rustClassCallableMemberOwner(walk: RustFactWalk, declaration: Node): Node | undefined {
  const { ast } = walk.context;
  if (!ast.is.IsMethodDeclaration(declaration) && !ast.is.IsGetAccessorDeclaration(declaration) &&
    !ast.is.IsSetAccessorDeclaration(declaration) && !ast.is.IsConstructorDeclaration(declaration)) return undefined;
  const owner = ast.parent(declaration);
  return owner !== undefined && (ast.is.IsClassDeclaration(owner) || ast.is.IsClassExpression(owner)) ? owner : undefined;
}
