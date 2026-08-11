import type { AstReader, Node } from "@tsonic/tsts";

export interface RustSyntheticNameState {
  readonly reserved: Set<string>;
  nextId: number;
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
      }
    }
    ast.forEachChild(node, (child) => {
      if (child !== undefined) {
        visit(child);
      }
    });
  };
  visit(root);
  return { reserved, nextId: 0 };
}

export function allocateRustSyntheticName(
  state: RustSyntheticNameState,
  purpose: string,
): string {
  for (;;) {
    const candidate = state.nextId === 0
      ? `__tsonic_${purpose}`
      : `__tsonic_${purpose}_${state.nextId}`;
    state.nextId += 1;
    if (!state.reserved.has(candidate)) {
      state.reserved.add(candidate);
      return candidate;
    }
  }
}
