import type { AstReader, Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { sourceExpressionResultDisposition } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustPromiseResult, RustPromiseResults } from "../../target-model/records/promise-results.js";
import { mapRustAwaitSelection, rustAwaitSelection, rustAwaitSelectionLeaves } from "../../target-model/types/await.js";
import { rustJsPromiseOutputTargetType } from "../../target-model/types/index.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { rustEffectiveValueCarrier } from "../conversions/value-carrier-queries.js";

export function analyzeRustPromiseResults(input: {
  readonly ast: AstReader;
  readonly nodes: readonly Node[];
  readonly records: RustProgramRecords;
  readonly definitions: RustTypeDefinitions;
}): { readonly results: RustPromiseResults; readonly diagnostics: readonly TargetDiagnostic[] } {
  const results = new Map<Node, RustPromiseResult>();
  const diagnostics: TargetDiagnostic[] = [];
  for (const node of input.nodes) {
    if (!input.ast.is.IsCallExpression(node) && !input.ast.is.IsNewExpression(node)) continue;
    const selection = rustAwaitSelection(rustEffectiveValueCarrier(input.records, node), input.definitions);
    if (selection === undefined) continue;
    const leaves = rustAwaitSelectionLeaves(selection);
    if (!leaves.some(leaf => leaf.future !== undefined)) continue;
    const disposition = sourceExpressionResultDisposition(input.ast, node);
    if (disposition.kind !== "discarded") {
      results.set(node, Object.freeze({ disposition }));
      continue;
    }
    if (leaves.some(leaf => leaf.future !== undefined &&
      rustJsPromiseOutputTargetType(leaf.future.futureCarrier) === undefined)) {
      diagnostics.push(Object.freeze({ code: "RUST_DISCARDED_NATIVE_ASYNC_CALL", category: "error", source: "tsonic-rust",
        sourceNode: node, message: "A native async call must be awaited, returned, passed or stored; discarding its future does not execute it.",
        evidence: ["target.capability=rust.async.native-result-use"] }));
      continue;
    }
    const discard = mapRustAwaitSelection(selection, leaf => Object.freeze({ observe: leaf.future !== undefined }));
    results.set(node, Object.freeze({ disposition, discard }));
  }
  return Object.freeze({ results, diagnostics: Object.freeze(diagnostics) });
}
