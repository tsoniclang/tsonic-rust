import type { AstReader, Node } from "@tsonic/tsts";
import { rustSnakeCaseIdentifier } from "../../common/rust-identifiers.js";

export interface RustSyntheticNameState {
  readonly reserved: Set<string>;
  readonly nextSuffixByBase: Map<string, number>;
}

export function createRustSyntheticNameState(
  ast: AstReader,
  root: Node,
  initialNames: readonly string[],
): RustSyntheticNameState {
  const reserved = new Set(initialNames);
  const visit = (node: Node): void => {
    if (ast.kindName(node) === "KindIdentifier") {
      const name = ast.text(node);
      if (name.length > 0) {
        reserved.add(name);
        reserved.add(rustSnakeCaseIdentifier(name));
      }
    }
    ast.forEachChild(node, (child) => {
      if (child !== undefined) {
        visit(child);
      }
    });
  };
  visit(root);
  return { reserved, nextSuffixByBase: new Map() };
}

export function allocateRustSyntheticName(
  state: RustSyntheticNameState,
  purpose: string,
): string {
  const selectedBase = rustSnakeCaseIdentifier(purpose);
  const base = selectedBase.startsWith("r#")
    ? `${selectedBase.slice(2)}_value`
    : selectedBase;
  let suffix = state.nextSuffixByBase.get(base) ?? 1;
  for (;;) {
    const candidate = suffix === 1 ? base : `${base}_${suffix}`;
    suffix += 1;
    state.nextSuffixByBase.set(base, suffix);
    if (!state.reserved.has(candidate)) {
      state.reserved.add(candidate);
      return candidate;
    }
  }
}
