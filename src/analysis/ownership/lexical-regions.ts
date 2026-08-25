import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import { sourceNodeIdentity } from "@tsonic/target-api/source";
import type { RustRegionRef } from "../../target-model/semantics/index.js";

export interface RustLexicalRegionIndex {
  readonly regions: readonly RustRegionRef[];
  regionFor(node: Node | undefined): RustRegionRef | undefined;
  ownedRegionFor(owner: Node | undefined): RustRegionRef | undefined;
  regionById(id: string): RustRegionRef | undefined;
  contains(outer: RustRegionRef | string, inner: RustRegionRef | string): boolean;
  exitedRegions(fromId: string | undefined, toId: string | undefined): readonly RustRegionRef[];
}

export function collectRustLexicalRegions(
  ast: AstReader,
  sourceFiles: readonly SourceFile[],
): RustLexicalRegionIndex {
  const regions: RustRegionRef[] = [];
  const byId = new Map<string, RustRegionRef>();
  const regionByNode = new WeakMap<Node, RustRegionRef>();
  const ownedRegionByNode = new WeakMap<Node, RustRegionRef>();

  const createRegion = (owner: Node, parent: RustRegionRef | undefined): RustRegionRef => {
    const identity = sourceNodeIdentity(ast, owner) ?? [
      ast.getPath(ast.getSourceFile(owner)),
      ast.kind(owner),
      ast.pos(owner),
      ast.end(owner),
    ].join(":");
    const region = Object.freeze({
      id: `rust-lexical\0${identity}`,
      kind: "lexical" as const,
      ...(parent === undefined ? {} : { parentId: parent.id }),
    });
    regions.push(region);
    byId.set(region.id, region);
    ownedRegionByNode.set(owner, region);
    return region;
  };

  const visitChildren = (owner: Node, region: RustRegionRef): void => {
    ast.forEachChild(owner, (child) => {
      if (child !== undefined) visit(child, region);
    });
  };

  const visit = (node: Node, inherited: RustRegionRef): void => {
    if (isRustLexicalOwner(ast.kindName(node))) {
      regionByNode.set(node, inherited);
      const owned = createRegion(node, inherited);
      visitChildren(node, owned);
      return;
    }
    regionByNode.set(node, inherited);
    visitChildren(node, inherited);
  };

  for (const sourceFile of sourceFiles) {
    const sourceRegion = createRegion(sourceFile, undefined);
    regionByNode.set(sourceFile, sourceRegion);
    visitChildren(sourceFile, sourceRegion);
  }

  const lineage = (id: string | undefined): readonly RustRegionRef[] => {
    const selected: RustRegionRef[] = [];
    const seen = new Set<string>();
    let current = id === undefined ? undefined : byId.get(id);
    while (current !== undefined && !seen.has(current.id)) {
      selected.push(current);
      seen.add(current.id);
      current = current.parentId === undefined ? undefined : byId.get(current.parentId);
    }
    return selected;
  };

  return Object.freeze<RustLexicalRegionIndex>({
    regions: Object.freeze(regions),
    regionFor(node) {
      return node === undefined ? undefined : regionByNode.get(node);
    },
    ownedRegionFor(owner) {
      return owner === undefined ? undefined : ownedRegionByNode.get(owner);
    },
    regionById(id) {
      return byId.get(id);
    },
    contains(outer, inner) {
      const outerId = typeof outer === "string" ? outer : outer.id;
      const innerId = typeof inner === "string" ? inner : inner.id;
      return lineage(innerId).some((region) => region.id === outerId);
    },
    exitedRegions(fromId, toId) {
      const targetLineage = new Set(lineage(toId).map((region) => region.id));
      return Object.freeze(lineage(fromId).filter((region) => !targetLineage.has(region.id)));
    },
  });
}

function isRustLexicalOwner(kind: string | undefined): boolean {
  return kind === "KindArrowFunction" || kind === "KindConstructor" ||
    kind === "KindFunctionDeclaration" || kind === "KindFunctionExpression" ||
    kind === "KindGetAccessor" || kind === "KindMethodDeclaration" ||
    kind === "KindSetAccessor" || kind === "KindBlock" ||
    kind === "KindCaseBlock" || kind === "KindCatchClause" ||
    kind === "KindForInStatement" || kind === "KindForOfStatement" ||
    kind === "KindForStatement";
}
