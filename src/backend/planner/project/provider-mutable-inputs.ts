import type { Node } from "@tsonic/tsts";
import type { RustFinalizedSourceInput } from "../../../target-model/records/operations/finalized-operation.js";
import type { RustEmissionProviderOperation } from "../../../target-model/records/native/physical-emission-contexts.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { planRustPromotedStorageLocation, type RustExpressionPlanner } from "../expressions/typed-locations.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export type MutableProviderInput =
  | { readonly kind: "promoted"; readonly node: Node; readonly inputs: readonly RustFinalizedSourceInput[];
      readonly location: RustExpr; readonly rootDeclaration: Node }
  | { readonly kind: "direct"; readonly node: Node; readonly inputs: readonly RustFinalizedSourceInput[]; readonly rootDeclaration?: Node }
  | { readonly kind: "project-field"; readonly node: Node; readonly inputs: readonly RustFinalizedSourceInput[];
      readonly receiverNode: Node; readonly storagePath: readonly string[]; readonly rootDeclaration?: Node }
  | { readonly kind: "owned"; readonly node: Node; readonly inputs: readonly RustFinalizedSourceInput[] };

export function collectMutableInputs(context: RustPlanContext, fact: RustEmissionProviderOperation,
  operationNode: Node, planExpression: RustExpressionPlanner): ReadonlyMap<string, MutableProviderInput> {
  const admitted = context.input.program.records.providerMutableOperands.get(operationNode, fact);
  if (admitted === undefined) failRustPlannerInvariant("An admitted native operation requires its exact mutable source storage proof.", operationNode);
  const inputs = new Map<string, MutableProviderInput>();
  for (const selected of admitted) {
    const { node, storage } = selected;
    const location = planRustPromotedStorageLocation(node, context, planExpression, true);
    if (location.kind === "promoted") {
      if (location.expression === undefined) failRustPlannerInvariant("An admitted promoted mutable input requires its native location expression.", node);
      inputs.set(selected.key, { kind: "promoted", node, inputs: [selected.input],
        location: location.expression, rootDeclaration: location.rootDeclaration });
    } else if (storage.kind === "project-field") inputs.set(selected.key, { kind: "project-field", node, inputs: [selected.input],
      receiverNode: storage.receiver, storagePath: storage.path, ...(storage.rootDeclaration === undefined ? {} : { rootDeclaration: storage.rootDeclaration }) });
    else if (storage.kind === "direct") inputs.set(selected.key, { kind: "direct", node, inputs: [selected.input],
      ...(storage.rootDeclaration === undefined ? {} : { rootDeclaration: storage.rootDeclaration }) });
    else inputs.set(selected.key, { kind: "owned", node, inputs: [selected.input] });
  }
  return inputs;
}
