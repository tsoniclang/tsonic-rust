import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api/source";
import type { RustNamePlan } from "../../target-model/names/model.js";
import { allocateRustGeneratedName } from "../../target-model/names/generated.js";

export interface RustSourceMemberNameContext {
  readonly ast: AstReader;
  readonly names: RustNamePlan;
  semanticsFor(node: Node): SourceFileSemantics;
}

export function rustProjectCallableTargetName(
  declaration: Node,
  context: RustSourceMemberNameContext,
): string | undefined {
  const { ast } = context;
  if (ast.kindName(declaration) === "KindConstructor") {
    return "new";
  }
  const name = ast.name(declaration);
  if (name === undefined) {
    return undefined;
  }
  if (ast.is.IsComputedPropertyName(name)) {
    const selected = context.semanticsFor(declaration)
      .operations.wellKnownSymbol(name);
    return selected?.kind === "dispose"
      ? "dispose"
      : selected?.kind === "async-dispose"
        ? "dispose_async"
        : undefined;
  }
  const selected = context.names.nameForDeclaration(declaration);
  const owner = ast.parent(declaration);
  if (selected === undefined || owner === undefined || !ast.hasModifierKind(declaration, "static") ||
    !ast.is.IsMethodDeclaration(declaration)) return selected;
  const members = ast.members(owner).filter((member): member is Node => member !== undefined);
  const collides = members.some(member => !ast.hasModifierKind(member, "static") &&
    ast.is.IsMethodDeclaration(member) && context.names.nameForDeclaration(member) === selected);
  if (!collides) return selected;
  const used = new Set(members.flatMap(member => {
    const name = context.names.nameForDeclaration(member);
    return name === undefined ? [] : [name];
  }));
  return allocateRustGeneratedName(used, `${selected}_static`);
}
