import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import {
  rustFlowReadProjectionFactKey,
  rustSourceBindingFactKey,
} from "../facts/keys.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

export interface RustProjectFlowReadSelectionQuery {
  readonly root: Node;
  readonly declaration: Node;
  readonly sourceCarrier: TargetTypeRef;
  readonly dispatchCarrier: TargetTypeRef;
  readonly selectedCarrier: TargetTypeRef;
}

export interface RustProjectFlowReadSelectionIndex {
  readsWithin(query: RustProjectFlowReadSelectionQuery): readonly Node[];
}

interface RustIndexedProjectFlowRead {
  readonly node: Node;
  readonly start: number;
  readonly end: number;
  readonly sourceCarrier: TargetTypeRef;
  readonly dispatchCarrier: TargetTypeRef;
  readonly selectedCarrier: TargetTypeRef;
}

type RustReadsByScope = Map<Node, RustIndexedProjectFlowRead[]>;
type RustReadsBySourceFile = Map<SourceFile, RustReadsByScope>;

const noProjectFlowReads: readonly Node[] = Object.freeze([]);

export function analyzeRustProjectFlowReadSelections(input: {
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly facts: RustPlanQueries;
}): RustProjectFlowReadSelectionIndex {
  const readsByDeclaration = new Map<Node, RustReadsBySourceFile>();
  const visit = (node: Node, sourceFile: SourceFile, scope: Node): void => {
    const binding = input.facts.getFact(node, rustSourceBindingFactKey);
    const flow = input.facts.getFact(node, rustFlowReadProjectionFactKey);
    if (binding !== undefined && flow?.kind === "project-downcast") {
      const bySourceFile = readsByDeclaration.get(binding.sourceDeclaration) ?? new Map();
      const byScope = bySourceFile.get(sourceFile) ?? new Map();
      const reads = byScope.get(scope) ?? [];
      reads.push(Object.freeze({
        node,
        start: input.ast.pos(node),
        end: input.ast.end(node),
        sourceCarrier: flow.sourceCarrier,
        dispatchCarrier: flow.dispatchCarrier,
        selectedCarrier: flow.selectedCarrier,
      }));
      byScope.set(scope, reads);
      bySourceFile.set(sourceFile, byScope);
      readsByDeclaration.set(binding.sourceDeclaration, bySourceFile);
    }
    const childScope = isRustCallableBoundary(input.ast.kindName(node)) ? node : scope;
    input.ast.forEachChild(node, (child) => {
      if (child !== undefined) visit(child, sourceFile, childScope);
    });
  };
  for (const sourceFile of input.sourceFiles) {
    visit(sourceFile, sourceFile, sourceFile);
  }
  for (const bySourceFile of readsByDeclaration.values()) {
    for (const byScope of bySourceFile.values()) {
      for (const reads of byScope.values()) {
        reads.sort((left, right) => left.start - right.start || left.end - right.end);
        Object.freeze(reads);
      }
    }
  }
  return Object.freeze({
    readsWithin(query: RustProjectFlowReadSelectionQuery): readonly Node[] {
      const sourceFile = input.ast.getSourceFile(query.root);
      if (sourceFile === undefined) return noProjectFlowReads;
      const scope = enclosingRustCallable(query.root, input.ast) ?? sourceFile;
      const reads = readsByDeclaration.get(query.declaration)?.get(sourceFile)?.get(scope);
      if (reads === undefined) return noProjectFlowReads;
      const rootStart = input.ast.pos(query.root);
      const rootEnd = input.ast.end(query.root);
      const first = lowerBoundByStart(reads, rootStart);
      const selected: Node[] = [];
      for (let index = first; index < reads.length; index += 1) {
        const read = reads[index]!;
        if (read.start >= rootEnd) break;
        if (read.end <= rootEnd &&
          rustTargetTypeRefEquals(read.sourceCarrier, query.sourceCarrier) &&
          rustTargetTypeRefEquals(read.dispatchCarrier, query.dispatchCarrier) &&
          rustTargetTypeRefEquals(read.selectedCarrier, query.selectedCarrier)) {
          selected.push(read.node);
        }
      }
      return selected.length === 0 ? noProjectFlowReads : Object.freeze(selected);
    },
  });
}

function lowerBoundByStart(
  reads: readonly RustIndexedProjectFlowRead[],
  start: number,
): number {
  let low = 0;
  let high = reads.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (reads[middle]!.start < start) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

function enclosingRustCallable(node: Node, ast: AstReader): Node | undefined {
  let current = ast.parent(node);
  while (current !== undefined) {
    if (isRustCallableBoundary(ast.kindName(current))) return current;
    current = ast.parent(current);
  }
  return undefined;
}

function isRustCallableBoundary(kind: string): boolean {
  return kind === "KindFunctionDeclaration" || kind === "KindFunctionExpression" ||
    kind === "KindArrowFunction" || kind === "KindMethodDeclaration" ||
    kind === "KindGetAccessor" || kind === "KindSetAccessor" ||
    kind === "KindConstructor";
}
