import type { Node } from "@tsonic/tsts";

export interface RustGeneratedDeclarationUse {
  readonly reference: Node;
  readonly declaration: Node;
}

export interface RustGeneratedDeclarationUseRegistry {
  record(reference: Node, declarations: readonly Node[]): void;
  seal(): readonly RustGeneratedDeclarationUse[];
}

export function createRustGeneratedDeclarationUseRegistry(): RustGeneratedDeclarationUseRegistry {
  const uses: RustGeneratedDeclarationUse[] = [];
  const declarationsByReference = new Map<Node, Set<Node>>();
  let sealed = false;

  return Object.freeze({
    record(reference: Node, declarations: readonly Node[]): void {
      if (sealed) {
        throw new Error("Rust generated declaration uses cannot be recorded after analysis is sealed.");
      }
      const existing = declarationsByReference.get(reference) ?? new Set<Node>();
      for (const declaration of declarations) {
        if (existing.has(declaration)) continue;
        existing.add(declaration);
        uses.push(Object.freeze({ reference, declaration }));
      }
      declarationsByReference.set(reference, existing);
    },
    seal(): readonly RustGeneratedDeclarationUse[] {
      if (sealed) {
        throw new Error("Rust generated declaration uses can be sealed only once.");
      }
      sealed = true;
      return Object.freeze([...uses]);
    },
  });
}
