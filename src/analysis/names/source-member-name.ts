import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api/source";
import type { RustNamePlan } from "../../target-model/names/model.js";

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
  if (ast.is.IsComputedPropertyName(name) || ast.is.IsNumericLiteral(name)) {
    const selected = context.semanticsFor(declaration)
      .propertyNames.get(name);
    if (selected?.kind === "well-known-symbol") return selected.symbol === "dispose"
      ? "dispose" : selected.symbol === "async-dispose" ? "dispose_async" : undefined;
    if (selected?.kind !== "resolved") return undefined;
  }
  return context.names.nameForDeclaration(declaration);
}
