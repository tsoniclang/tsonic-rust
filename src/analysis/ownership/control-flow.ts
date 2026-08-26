import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { RustLexicalRegionIndex } from "./lexical-regions.js";
import { buildRustSourceFlowGraphInternal } from "./control-flow-builder.js";
import {
  FlowConstructionError,
  RustSourceFlowQueryLimitError,
} from "./control-flow-errors.js";

export { RustSourceFlowQueryLimitError };

export interface RustSourceFlowPoint {
  readonly id: string;
  readonly index: number;
  readonly regionId: string;
  readonly lexicalRegionId?: string;
  readonly node?: Node;
  readonly kind: "entry" | "node" | "exit" | "join";
  readonly suspension?: {
    readonly kind: "await" | "yield";
    readonly occurrenceId: string;
  };
  readonly resourceCleanup?: {
    readonly declaration: Node;
    readonly access: "shared" | "mutable";
  };
}

export interface RustSourceFlowGraph {
  readonly points: readonly RustSourceFlowPoint[];
  readonly edgeCount: number;
  pointsFor(node: Node | undefined): readonly RustSourceFlowPoint[];
  successors(point: RustSourceFlowPoint): readonly RustSourceFlowPoint[];
  predecessors(point: RustSourceFlowPoint): readonly RustSourceFlowPoint[];
  reaches(from: Node | RustSourceFlowPoint, to: Node | RustSourceFlowPoint): boolean;
  repeats(node: Node | RustSourceFlowPoint): boolean;
  pointsOnPaths(
    from: Node | RustSourceFlowPoint,
    to: readonly (Node | RustSourceFlowPoint)[],
  ): readonly RustSourceFlowPoint[];
  regionFor(node: Node | undefined): string | undefined;
  exitsFor(node: SourceFile | Node): readonly RustSourceFlowPoint[];
}

export type BuildRustSourceFlowGraphResult =
  | { readonly kind: "resolved"; readonly graph: RustSourceFlowGraph }
  | { readonly kind: "rejected"; readonly code: string; readonly message: string };

export interface RustSourceResourceCleanupEffect {
  readonly access: "shared" | "mutable";
  readonly asynchronous: boolean;
  readonly fallible: boolean;
}

export interface RustSourceFlowEffects {
  nodeMayThrow(node: Node): boolean | undefined;
  nodeSuspensionKind(node: Node): "await" | "yield" | undefined;
  resourceCleanupFor(declaration: Node): RustSourceResourceCleanupEffect | undefined;
}

export function buildRustSourceFlowGraph(
  ast: AstReader,
  sourceFiles: readonly SourceFile[],
  lexicalRegions: RustLexicalRegionIndex,
  effects: RustSourceFlowEffects,
): BuildRustSourceFlowGraphResult {
  try {
    return {
      kind: "resolved",
      graph: buildRustSourceFlowGraphInternal(ast, sourceFiles, lexicalRegions, effects),
    };
  } catch (error) {
    if (!(error instanceof FlowConstructionError)) throw error;
    return {
      kind: "rejected",
      code: error.code,
      message: error.message,
    };
  }
}
