import type { Node } from "@tsonic/tsts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustArgumentViewProducer } from "../program/records/calls/argument-views.js";
import { rustBorrowValueIsUnprojected } from "../storage/borrowed-element-purity.js";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";
import { sourceTransparentExpressionOperand } from "@tsonic/target-api/source";
import type { RustArgumentView } from "../../target-model/records/calls/argument-views.js";

export function analyzeRustArgumentViews(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustArgumentViewProducer): void {
  const physicalStorageFor = (node: Node): RustArgumentView["borrowedStorage"] => {
    const seen = new Set<Node>();
    let current = node;
    while (!seen.has(current)) {
      seen.add(current);
      if (!rustBorrowValueIsUnprojected(current, program.records)) return undefined;
      const operand = sourceTransparentExpressionOperand(program.source.ast, current);
      if (operand !== undefined) { current = operand; continue; }
      const declaration = program.records.sourceBinding.get(current)?.sourceDeclaration;
      if (declaration !== undefined && program.records.bindingStorage.get(declaration)?.storage === "borrow-cell") return "borrow-guard";
      const operation = program.records.targetOperation.get(current);
      if (operation?.kind === "source-field" && operation.declaration !== undefined &&
        program.records.capturedFieldStorage.get(operation.declaration)?.storage.kind === "borrow-cell") return "borrow-guard";
      return "plain";
    }
    return undefined;
  };
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    const operation = program.records.targetOperation.get(node);
    const read = program.records.readOwnership.get(node);
    producer.publish(node, { slice: operation?.kind === "array-literal" && operation.lane === "native" &&
      operation.contributions.every(contribution => contribution.kind === "value") && program.records.nativeArrayStorage.get(node) === undefined &&
      rustBorrowValueIsUnprojected(node, program.records),
      borrowedStorage: read?.readsStorage === true && (read.source.kind === "clone" || read.source.kind === "borrow")
        ? physicalStorageFor(node) : undefined });
  }
}
