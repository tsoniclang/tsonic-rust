import type { Node } from "@tsonic/tsts";
import { sourceNodeIdentity } from "@tsonic/target-api/source";
import type { RustLifetimeRef } from "../../target-model/lifetimes/index.js";
import type { RustTargetTypeResolutionContext } from "../types/resolution/model.js";
import { allocateRustGeneratedName } from "../../target-model/names/generated.js";

export function rustSourceInputLifetime(
  parameter: Node,
  context: RustTargetTypeResolutionContext,
): Extract<RustLifetimeRef, { readonly kind: "parameter" }> | undefined {
  const { ast } = context;
  const owner = ast.parent(parameter);
  if (!ast.is.IsParameterDeclaration(parameter) || owner === undefined ||
    !ast.is.IsFunctionDeclaration(owner) ||
    !ast.hasModifierKind(owner, "async") && context.semanticsFor(owner).operations.generator(owner) === undefined) return undefined;
  const identity = sourceNodeIdentity(ast, owner);
  if (identity === undefined || !ast.parameters(owner).includes(parameter)) return undefined;
  const names = new Set<string>();
  for (let enclosing: Node | undefined = owner; enclosing !== undefined; enclosing = ast.parent(enclosing)) {
    for (const selected of context.sourceLifetimes.contractFor(enclosing)?.parameters ?? [])
      if (selected.kind === "lifetime") names.add(selected.lifetime.name);
  }
  return Object.freeze({ kind: "parameter", identity: `source-input-borrow\0${identity}`,
    name: allocateRustGeneratedName(names, "input") });
}
