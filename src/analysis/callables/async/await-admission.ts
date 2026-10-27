import type { AstReader, Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustAwaitValueFact, RustAwaitValueLeafFact } from "../../../target-model/records/await-values.js";
import type { RustAwaitSelection } from "../../../target-model/types/await.js";

export function admitRustAwaitBoundary(ast: AstReader, node: Node, fact: RustAwaitValueFact | undefined,
  fallible: boolean): TargetDiagnostic | undefined {
  if (fact === undefined || fallible) return undefined;
  const pending: RustAwaitSelection<RustAwaitValueLeafFact>[] = [fact.selection];
  while (pending.length !== 0) {
    const selected = pending.pop()!;
    if (selected.kind === "optional") pending.push(selected.present);
    else if (selected.kind === "union") pending.push(...selected.alternatives.map(alternative => alternative.selection));
    else if (selected.value.future?.awaiting === "fallible") return {
      code: "RUST_UNSUPPORTED_AST", category: "error", source: "tsonic-rust", sourceNode: node,
      message: `Fallible awaits require a finalized fallible lowering context. Node kind: ${ast.kindName(node)}.`,
      evidence: ["target.capability=rust.error.call"],
    };
  }
  return undefined;
}
