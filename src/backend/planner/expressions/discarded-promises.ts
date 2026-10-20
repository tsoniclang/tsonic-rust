import { failRustPlannerInvariant } from "../../invariants.js";
import type { Node } from "@tsonic/tsts";
import type { RustAwaitSelection } from "../../../target-model/types/await.js";
import type { RustDiscardedPromiseLeaf } from "../../../target-model/records/promise-results.js";
import type { RustExpr, RustPattern } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { rustUnionTypePathInContext } from "../types/render.js";

export function planRustDiscardedPromise(
  node: Node,
  expression: RustExpr,
  selection: RustAwaitSelection<RustDiscardedPromiseLeaf>,
  context: RustPlanContext,
): RustExpr {
  const names = context.syntheticNames;
  if (names === undefined) failRustPlannerInvariant("An admitted discarded Promise requires its native name scope.", node);
  const unit: RustExpr = { kind: "tuple-literal", elements: [] };
  const plan = (selected: RustAwaitSelection<RustDiscardedPromiseLeaf>, value: RustExpr): RustExpr => {
    if (selected.kind === "leaf") return selected.value.observe
      ? { kind: "method-call", receiver: value, method: "observe_discarded", args: [] }
      : { kind: "evaluate-then", effect: value, discard: "value", value: unit };
    if (selected.kind === "optional") {
      const name = allocateRustSyntheticName(names, "discarded_promise");
      return { kind: "match", expression: value, arms: [
        { pattern: { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name }] },
          expression: plan(selected.present, { kind: "path", path: name }) },
        { pattern: { kind: "path", path: "None" }, expression: unit },
      ] };
    }
    const owner = rustUnionTypePathInContext(selected.carrier, context);
    if (owner === undefined) return failRustPlannerInvariant("A sealed discarded Promise union has no native type identity.", node);
    const arms: { readonly pattern: RustPattern; readonly expression: RustExpr }[] = selected.alternatives.map(alternative => {
      const name = allocateRustSyntheticName(names, "discarded_value");
      const path = `${owner}::${alternative.variant.name}`;
      const constant = alternative.variant.kind === "constant";
      const payload: RustExpr = constant ? { kind: "bool-literal", value: alternative.variant.value }
        : { kind: "path", path: name };
      return { pattern: constant ? { kind: "path", path }
        : { kind: "tuple-variant", path, elements: [{ kind: "binding", name }] },
        expression: plan(alternative.selection, payload) };
    });
    return { kind: "match", expression: value, arms };
  };
  return plan(selection, expression);
}
