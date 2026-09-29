import type { AstReader, Node } from "@tsonic/tsts";
import { sourceNodeIdentity } from "@tsonic/target-api/source";
import type { TargetTypeRef } from "../types/model.js";
import type { RustTypeLifetimeContract } from "../lifetimes/model.js";
export {
  generatedTypeParameterNames as rustGeneratedTypeParameterNames,
  authoredTypeParameterNames as rustAuthoredTypeParameterNames,
} from "@tsonic/target-api/source";

export function rustTypeParameterFromSourceContract(
  parameter: RustTypeLifetimeContract,
): Extract<TargetTypeRef, { readonly kind: "type-parameter" }> {
  return Object.freeze({ kind: "type-parameter", identity: parameter.identity, name: parameter.targetName });
}

export function rustSourceTypeParameter(
  declaration: Node,
  ast: AstReader,
): Extract<TargetTypeRef, { readonly kind: "type-parameter" }> | undefined {
  if (!ast.is.IsTypeParameterDeclaration(declaration)) return undefined;
  const nameNode = ast.name(declaration);
  const identity = sourceNodeIdentity(ast, declaration);
  if (nameNode === undefined || identity === undefined) return undefined;
  const name = ast.text(nameNode);
  return name.length === 0 ? undefined : Object.freeze({ kind: "type-parameter", identity, name });
}

export function rustSourceTypeParameters(
  declarations: readonly Node[],
  ast: AstReader,
): readonly Extract<TargetTypeRef, { readonly kind: "type-parameter" }>[] | undefined {
  const parameters = declarations.map(declaration => rustSourceTypeParameter(declaration, ast));
  return parameters.some(parameter => parameter === undefined) ? undefined
    : Object.freeze(parameters.filter(parameter => parameter !== undefined));
}
