import type { AstReader, Node } from "@tsonic/tsts";
import { createSourceExplicitUnsafeContextIndex } from "@tsonic/target-api/analysis";

type SafetyOperationReader = Parameters<typeof createSourceExplicitUnsafeContextIndex>[2];

const independentBoundaryKinds: ReadonlySet<string> = new Set([
  "KindFunctionDeclaration", "KindMethodDeclaration", "KindMethodSignature", "KindConstructor",
  "KindConstructorDeclaration", "KindGetAccessor", "KindSetAccessor",
]);

/** A declaration whose Rust item does not inherit the unsafety of an enclosing block. */
export function isRustIndependentSafetyBoundary(ast: AstReader, node: Node): boolean {
  return independentBoundaryKinds.has(ast.kindName(node));
}

export interface RustExplicitUnsafeContexts {
  has(node: Node): boolean;
}

/**
 * Nodes inside an explicit unsafecontext() region, where a region ends at an independent safety boundary: a nested
 * function, method, constructor or accessor is its own Rust item and needs its own region.
 */
export function createRustExplicitUnsafeContexts(
  ast: AstReader, roots: readonly Node[], read: SafetyOperationReader,
): RustExplicitUnsafeContexts {
  const outer = createSourceExplicitUnsafeContextIndex(ast, roots, read);
  const inner = new Map<Node, ReadonlySet<Node>>();
  const boundaries = new WeakMap<Node, Node | null>();
  const nearestBoundary = (node: Node): Node | undefined => {
    const cached = boundaries.get(node);
    if (cached !== undefined) return cached ?? undefined;
    const parent = ast.parent(node);
    const selected = parent === undefined ? undefined
      : isRustIndependentSafetyBoundary(ast, parent) ? parent : nearestBoundary(parent);
    boundaries.set(node, selected ?? null);
    return selected;
  };
  const regionFor = (boundary: Node): ReadonlySet<Node> => {
    const existing = inner.get(boundary);
    if (existing !== undefined) return existing;
    const selected = createSourceExplicitUnsafeContextIndex(ast, [boundary], read);
    inner.set(boundary, selected);
    return selected;
  };
  return Object.freeze({
    has(node: Node): boolean {
      const boundary = nearestBoundary(node);
      return boundary === undefined ? outer.has(node) : regionFor(boundary).has(node);
    },
  });
}
