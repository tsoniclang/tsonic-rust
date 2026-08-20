import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api/source";
import type { RustNamePlan } from "../../policy/names/model.js";

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
  return context.names.nameForDeclaration(declaration);
}
