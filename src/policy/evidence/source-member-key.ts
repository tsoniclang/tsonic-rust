import type { Node } from "@tsonic/tsts";
import {
  rustPropertySourceMemberKey,
  rustSourceMemberKeysEqual,
  rustWellKnownSymbolSourceMemberKey,
} from "../../target-model/types/index.js";
import type { RustSourceMemberKey } from "../../target-model/types/index.js";
import type { AstReader } from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api/source";

export interface RustSourceMemberKeyContext {
  readonly ast: AstReader;
  semanticsFor(node: Node): SourceFileSemantics;
}

export function resolveRustSourceMemberKey(
  declarations: readonly Node[],
  fallbackName: string,
  context: RustSourceMemberKeyContext,
): RustSourceMemberKey | undefined {
  if (declarations.length === 0) {
    return fallbackName.length === 0
      ? undefined
      : rustPropertySourceMemberKey(fallbackName);
  }
  const keys = declarations.map((declaration) =>
    resolveRustDeclarationMemberKey(declaration, fallbackName, context));
  if (keys.some((key) => key === undefined)) {
    return undefined;
  }
  const selected = keys as readonly RustSourceMemberKey[];
  const first = selected[0]!;
  return selected.every((key) => rustSourceMemberKeysEqual(first, key))
    ? first
    : undefined;
}

export function resolveRustDeclarationMemberKey(
  declaration: Node,
  fallbackName: string,
  context: RustSourceMemberKeyContext,
): RustSourceMemberKey | undefined {
  const name = context.ast.name(declaration);
  if (name === undefined) {
    return undefined;
  }
  if (!context.ast.is.IsComputedPropertyName(name)) {
    return fallbackName.length === 0
      ? undefined
      : rustPropertySourceMemberKey(fallbackName);
  }
  const selected = context.semanticsFor(declaration)
    .operations.wellKnownSymbol(name);
  return selected === undefined
    ? undefined
    : rustWellKnownSymbolSourceMemberKey(selected.kind);
}
