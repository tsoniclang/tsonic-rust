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
import {
  maximumSourceNodes,
  RustOwnershipComplexityError,
  rustOwnershipInventoryCountComplexityDiagnostic,
} from "./complexity.js";
import { requireRustOwnershipSourceIdentity } from "./identity.js";

export interface RustOwnershipNodeInventory {
  readonly nodes: readonly Node[];
  readonly places: WeakMap<Node, RustPlaceRef>;
  readonly declarationByRoot: ReadonlyMap<string, Node>;
  readonly nodesByRoot: ReadonlyMap<string, readonly Node[]>;
  readonly callableOwnerByNode: WeakMap<Node, Node>;
  readonly nodesByCallable: WeakMap<Node, readonly Node[]>;
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
  const mutableNodesByRoot = new Map<string, Node[]>();
  const callableOwnerByNode = new WeakMap<Node, Node>();
  const mutableNodesByCallable = new WeakMap<Node, Node[]>();
  const regionByNode = new WeakMap<Node, RustRegionRef>();
  const placeContext = {
    ast: input.ast,
    navigation: input.navigation,
    facts: input.facts,
  };
  for (const sourceFile of input.sourceFiles) {
    visitRustSourceWithCallableOwner(sourceFile, input, (node, callableOwner) => {
      requireRustOwnershipSourceIdentity(input.ast, node);
      if (nodes.length >= maximumSourceNodes) {
        const diagnostic = rustOwnershipInventoryCountComplexityDiagnostic(
          input.sourceFiles.length,
          nodes.length + 1,
          lexicalRegions.regions.length,
        );
        if (diagnostic !== undefined) throw new RustOwnershipComplexityError(diagnostic);
      }
      nodes.push(node);
      const place = rustPlaceForExpression(node, placeContext) ??
        (isRustSourceValueDeclarationKind(input.ast.kindName(node))
          ? rustPlaceForDeclaration(node, input.ast)
          : undefined);
      if (place !== undefined) {
        places.set(node, place);
        const rootNodes = mutableNodesByRoot.get(place.rootId) ?? [];
        rootNodes.push(node);
        mutableNodesByRoot.set(place.rootId, rootNodes);
      }
      if (place !== undefined && place.projections.length === 0 &&
        isRustSourceValueDeclarationKind(input.ast.kindName(node)) &&
        !declarationByRoot.has(place.rootId)) {
        declarationByRoot.set(place.rootId, node);
      }
      const region = lexicalRegions.regionFor(node);
      if (region !== undefined) {
        regionByNode.set(node, region);
      }
      if (callableOwner !== undefined) {
        callableOwnerByNode.set(node, callableOwner);
        const callableNodes = mutableNodesByCallable.get(callableOwner) ?? [];
        callableNodes.push(node);
        mutableNodesByCallable.set(callableOwner, callableNodes);
      }
    });
  }
  const nodesByRoot = new Map<string, readonly Node[]>();
  for (const [rootId, rootNodes] of mutableNodesByRoot) {
    nodesByRoot.set(rootId, Object.freeze(rootNodes));
  }
  const nodesByCallable = new WeakMap<Node, readonly Node[]>();
  for (const node of nodes) {
    const callableNodes = mutableNodesByCallable.get(node);
    if (callableNodes !== undefined) {
      nodesByCallable.set(node, Object.freeze(callableNodes));
    }
  }
  return Object.freeze({
    nodes: Object.freeze(nodes),
    places,
    declarationByRoot,
    nodesByRoot,
    callableOwnerByNode,
    nodesByCallable,
    regions: lexicalRegions.regions,
    regionByNode,
    lexicalRegions,
  });
}

function visitRustSourceWithCallableOwner(
  node: Node,
  input: Pick<RustOwnershipAnalysisInput, "ast">,
  visit: (node: Node, callableOwner: Node | undefined) => void,
): void {
  const pending: { readonly node: Node; readonly callableOwner?: Node }[] = [{ node }];
  while (pending.length > 0) {
    const selected = pending.pop()!;
    const callableOwner = isCallableKind(input.ast.kindName(selected.node))
      ? selected.node
      : selected.callableOwner;
    visit(selected.node, callableOwner);
    const children: Node[] = [];
    input.ast.forEachChild(selected.node, (child) => {
      if (child !== undefined) children.push(child);
    });
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push({ node: children[index]!, ...(callableOwner === undefined ? {} : { callableOwner }) });
    }
  }
}

function isCallableKind(kind: string): boolean {
  return kind === "KindFunctionDeclaration" || kind === "KindFunctionExpression" ||
    kind === "KindArrowFunction" || kind === "KindMethodDeclaration" ||
    kind === "KindConstructor" || kind === "KindGetAccessor" || kind === "KindSetAccessor";
}

export function visitRustSource(
  node: Node,
  input: Pick<RustOwnershipAnalysisInput, "ast">,
  visit: (node: Node) => void,
): void {
  visitRustSourceWithCallableOwner(node, input, visit);
}
