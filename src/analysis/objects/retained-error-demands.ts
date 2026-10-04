import type { Node } from "@tsonic/tsts";
import type { SourceErrorRetainedDemand } from "@tsonic/target-api/analysis";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import type { RustProviderOperationRow } from "../../providers/packages/model.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { isRustRetainedErrorCarrier } from "../../target-model/types/carriers/source-error.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import { selectedCallProviderDeclaration, resolveSelectedProviderDeclaration } from "../../policy/evidence/selected-source.js";
import { selectRustProviderOperation } from "../../policy/operations/provider-selection.js";

export function createRustRetainedErrorDemandSelection(
  source: TargetSourceProgram,
  facts: RustPlanQueries,
  rows: readonly RustProviderOperationRow[],
): (node: Node) => SourceErrorRetainedDemand {
  const demands = new WeakMap<TargetTypeRef, boolean>();
  const containsRetainedError = (carrier: TargetTypeRef): boolean | undefined => {
    const previous = demands.get(carrier);
    if (previous !== undefined) return previous;
    const pending = [carrier];
    const visited = new Set<TargetTypeRef>();
    let retained = false;
    for (let index = 0; index < pending.length; index++) {
      const current = pending[index]!;
      if (visited.has(current)) continue;
      visited.add(current);
      if (visited.size > 8_192) return undefined;
      retained ||= isRustRetainedErrorCarrier(current);
      pending.push(...rustTargetTypeChildren(current));
    }
    demands.set(carrier, retained);
    return retained;
  };
  return node => {
    const semantics = source.semantics.forNode(node);
    const call = source.ast.is.IsCallExpression(node) || source.ast.is.IsNewExpression(node)
      ? semantics.operations.call(node) : undefined;
    const property = source.ast.is.IsPropertyAccessExpression(node) ? semantics.operations.propertyAccess(node) : undefined;
    const signature = call === undefined ? undefined : semantics.declarations.signatureDeclaration(call.selectedSignature);
    const selected = call === undefined ? resolveSelectedProviderDeclaration({ facts }, property?.selectedReadDeclaration ?? property?.selectedDeclaration)
      : selectedCallProviderDeclaration({ source: call, sourceSelectedDeclaration: signature }, { facts });
    if (selected.kind === "conflict") return { kind: "unresolved", reason: "Selected Error retention has conflicting provider identity evidence." };
    if (selected.kind !== "selected") return { kind: "ordinary" };
    const operation = selectRustProviderOperation(rows, selected.identity, call === undefined ? "property"
      : source.ast.is.IsNewExpression(node) ? "constructor" : "method");
    if (operation.kind === "ambiguous") return { kind: "unresolved", reason: "Selected Error retention has ambiguous native operation evidence." };
    if (operation.kind !== "selected") return { kind: "ordinary" };
    let retained = false;
    for (const carrier of [operation.row.resultCarrier, ...operation.row.parameterCarriers ?? []]) {
      const selected = containsRetainedError(carrier);
      if (selected === undefined) return { kind: "unresolved", reason: "Selected Error retention exceeds its finite native carrier budget." };
      retained ||= selected;
    }
    return { kind: retained ? "retained" : "ordinary" };
  };
}
