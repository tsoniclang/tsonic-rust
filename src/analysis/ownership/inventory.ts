import type { Node } from "@tsonic/tsts";
import type {
  RustPlaceRef,
  RustRegionRef,
} from "../../target-model/semantics/index.js";
import type { RustOwnershipAnalysisInput } from "./context.js";
import type { RustLexicalRegionIndex } from "./lexical-regions.js";
import {
  rustPlaceForDeclaration,
  rustPlaceForExpression,
} from "./places.js";
import { isRustSourceValueDeclarationKind } from "./source-values.js";

export interface RustOwnershipNodeInventory {
  readonly nodes: readonly Node[];
  readonly places: WeakMap<Node, RustPlaceRef>;
  readonly declarationByRoot: ReadonlyMap<string, Node>;
  readonly regions: readonly RustRegionRef[];
  readonly regionByNode: WeakMap<Node, RustRegionRef>;
  readonly lexicalRegions: RustLexicalRegionIndex;
}

export function collectRustOwnershipNodeInventory(
  input: RustOwnershipAnalysisInput,
  lexicalRegions: RustLexicalRegionIndex,
): RustOwnershipNodeInventory {
  const nodes: Node[] = [];
  const places = new WeakMap<Node, RustPlaceRef>();
  const declarationByRoot = new Map<string, Node>();
  const regionByNode = new WeakMap<Node, RustRegionRef>();
  const placeContext = {
    ast: input.ast,
    navigation: input.navigation,
    facts: input.facts,
  };
  for (const sourceFile of input.sourceFiles) {
    visitRustSource(sourceFile, input, (node) => {
      nodes.push(node);
      const place = rustPlaceForExpression(node, placeContext) ??
        (isRustSourceValueDeclarationKind(input.ast.kindName(node))
          ? rustPlaceForDeclaration(node, input.ast)
          : undefined);
      if (place !== undefined) places.set(node, place);
      if (place !== undefined && place.projections.length === 0 &&
        isRustSourceValueDeclarationKind(input.ast.kindName(node)) &&
        !declarationByRoot.has(place.rootId)) {
        declarationByRoot.set(place.rootId, node);
      }
      const region = lexicalRegions.regionFor(node);
      if (region !== undefined) {
        regionByNode.set(node, region);
      }
    });
  }
  return Object.freeze({
    nodes: Object.freeze(nodes),
    places,
    declarationByRoot,
    regions: lexicalRegions.regions,
    regionByNode,
    lexicalRegions,
  });
}

export function visitRustSource(
  node: Node,
  input: Pick<RustOwnershipAnalysisInput, "ast">,
  visit: (node: Node) => void,
): void {
  visit(node);
  input.ast.forEachChild(node, (child) => {
    if (child !== undefined) visitRustSource(child, input, visit);
  });
}
