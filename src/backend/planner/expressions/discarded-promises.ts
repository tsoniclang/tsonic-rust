import { failRustPlannerInvariant } from "../diagnostics.js";
import type { Node } from "@tsonic/tsts";
import type { RustAwaitSelection } from "../../../target-model/types/await.js";
import type { RustDiscardedFutureSpawn, RustDiscardedPromiseLeaf } from "../../../target-model/records/callables/promise-results.js";
import { planExpression } from "./entry.js";
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
    if (selected.kind === "leaf" && selected.value.spawn !== undefined) return planRustSpawnedFuture(node, value, selected.value.spawn, context);
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

// A native future discarded on the js surface runs as an event-loop task that owns a clone of its receiver binding:
// { let worker = worker.clone(); JsPromise::<()>::from_fallible_factory(move || async move {
//   worker.terminate().await.map(|_| ()).map_err(JsValue::from_error) }) }.observe_discarded()
function planRustSpawnedFuture(node: Node, future: RustExpr, spawn: RustDiscardedFutureSpawn, context: RustPlanContext): RustExpr {
  const receiver = planExpression(spawn.receiver, context);
  if (receiver?.kind !== "path") failRustPlannerInvariant("A spawned native future requires its receiver binding path.", node);
  context.usedAliases?.add("js_abi");
  const awaited: RustExpr = { kind: "await", expr: future };
  const unit: RustExpr = { kind: "closure", params: [{ name: "_" }], body: { kind: "tuple-literal", elements: [] } };
  const rejection = spawn.rejection;
  const error = rejection === undefined ? undefined : allocateRustSyntheticName(context.syntheticNames!, "spawned_error");
  const converted: RustExpr | undefined = rejection === undefined || error === undefined ? undefined
    : rejection.kind === "identity" ? undefined
    : { kind: "closure", params: [{ name: error }], body: rejection.kind === "uninhabited"
      ? { kind: "match", expression: { kind: "path", path: error }, arms: [] }
      : { kind: "call", path: "js_abi::JsValue::from_error", args: [{ kind: "path", path: error }] } };
  const mapped: RustExpr = rejection === undefined ? { kind: "evaluate-then", effect: awaited, discard: "value", value: { kind: "tuple-literal", elements: [] } }
    : { kind: "method-call", receiver: converted === undefined ? awaited : { kind: "method-call", receiver: awaited, method: "map_err", args: [converted] },
      method: "map", args: [unit] };
  const task: RustExpr = { kind: "call", path: rejection === undefined ? "js_abi::JsPromise::<()>::from_infallible_factory"
    : "js_abi::JsPromise::<()>::from_fallible_factory",
    args: [{ kind: "closure-block", params: [], move: true, async: true, body: { statements: [{ kind: "tail", expr: mapped }] } }] };
  return { kind: "method-call", method: "observe_discarded", args: [], receiver: { kind: "block", body: { statements: [
    { kind: "let", name: receiver.path, mutable: false, init: { kind: "method-call", receiver, method: "clone", args: [] } },
    { kind: "tail", expr: task },
  ] } } };
}
