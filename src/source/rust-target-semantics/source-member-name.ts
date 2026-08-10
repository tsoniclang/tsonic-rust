import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api";

export interface RustSourceMemberNameContext {
  readonly ast: AstReader;
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
      .getResolvedWellKnownSymbolInfo(name);
    return selected?.kind === "dispose"
      ? "dispose"
      : selected?.kind === "async-dispose"
        ? "dispose_async"
        : undefined;
  }
  const text = ast.text(name);
  return text.length === 0 ? undefined : text;
}
