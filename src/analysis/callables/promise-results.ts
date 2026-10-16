import type { AstReader, Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { createSourceStorageBudget, defaultSourceStorageLimits, decideSourceAsyncResultUse, type SourceStorageQueries } from "@tsonic/target-api/analysis";
import { sourceExpressionResultDisposition, type TargetSourceProgram } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustPromiseResult, RustPromiseResults } from "../../target-model/records/promise-results.js";
import { mapRustAwaitSelection, rustAwaitSelection, rustAwaitSelectionLeaves } from "../../target-model/types/await.js";
import { rustJsPromiseOutputTargetType } from "../../target-model/types/index.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { rustEffectiveValueCarrier } from "../conversions/value-carrier-queries.js";

export function analyzeRustPromiseResults(input: {
  readonly ast: AstReader;
  readonly source: TargetSourceProgram;
  readonly storage: SourceStorageQueries;
  readonly nodes: readonly Node[];
  readonly records: RustProgramRecords;
  readonly definitions: RustTypeDefinitions;
}): { readonly results: RustPromiseResults; readonly diagnostics: readonly TargetDiagnostic[] } {
  const results = new Map<Node, RustPromiseResult>();
  const diagnostics: TargetDiagnostic[] = [];
  const budget = createSourceStorageBudget(defaultSourceStorageLimits);
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
      if (!input.ast.is.IsCallExpression(node)) { results.set(node, Object.freeze({ disposition })); continue; }
      const semantics = input.source.semantics.forNode(node);
      const call = semantics.operations.call(node);
      const declaration = call?.sourceSelectedSignatureKind === "resolved"
        ? semantics.declarations.signatureDeclaration(call.selectedSignature) : undefined;
      const selected = call === undefined || declaration === undefined
        ? { kind: "unresolved" as const, reason: "Native async result-use requires its exact checked source signature." }
        : decideSourceAsyncResultUse({ source: input.source, storage: input.storage, budget, call: node, disposition,
          completion: { kind: "async", resultPolicy: "must-observe", contractDeclaration: declaration, checkedType: call.sourceResultType },
          continuation: { kind: "unresolved", at: node, reason: "The native discarded-call rule is independent of continuation ownership." } });
      diagnostics.push(Object.freeze({ code: selected.kind === "resolved" && selected.decision === "rejected"
        ? selected.diagnostic.code : "RUST_ASYNC_RESULT_USE_NOT_PROVEN", category: "error", source: "tsonic-rust",
        sourceNode: node, message: selected.kind === "resolved" && selected.decision === "rejected" ? selected.diagnostic.message
          : selected.kind === "unresolved" ? selected.reason : "The native discarded-call decision was not proven.",
        evidence: ["target.capability=rust.async.native-result-use"] }));
      continue;
    }
    const discard = mapRustAwaitSelection(selection, leaf => Object.freeze({ observe: leaf.future !== undefined }));
    results.set(node, Object.freeze({ disposition, discard }));
  }
  return Object.freeze({ results, diagnostics: Object.freeze(diagnostics) });
}
