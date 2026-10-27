import { sourceIntegerIsNonnegative, type TargetSourceProgram } from "@tsonic/target-api/source";
import type { Node } from "@tsonic/tsts";
import type { RustIntegerRangeIndex } from "../../../../target-model/records/operations/integer-ranges.js";

export function createRustIntegerRangeIndex(source: TargetSourceProgram, nodes: readonly Node[]): RustIntegerRangeIndex {
  const nonnegative = new WeakSet<Node>();
  for (const node of nodes) {
    if (sourceIntegerIsNonnegative({ ast: source.ast, navigation: source.navigation, sourceFacts: source.sourceFacts }, node)) {
      nonnegative.add(node);
    }
  }
  return Object.freeze({ get: (expression: Node) => nonnegative.has(expression) });
}
