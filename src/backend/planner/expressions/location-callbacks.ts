import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planRustNativeProtocolInvocation } from "./calls/native-input.js";

export function planRustLocationCallback(call: Node, argumentIndex: number, value: RustExpr, context: RustPlanContext): RustExpr {
  const selected = context.input.program.records.locationCallback.get(call, argumentIndex)
    ?? failRustPlannerInvariant("An admitted location callback requires its sealed native adapter.", call);
  if (selected.kind === "direct") return value;
  const names = context.syntheticNames ?? failRustPlannerInvariant("An admitted location callback requires its native name scope.", call);
  const name = allocateRustSyntheticName(names, "location_callback");
  const parameters = Array.from({ length: selected.parameterCount }, () => allocateRustSyntheticName(names, "value"));
  const arguments_: RustExpr[] = parameters.map(parameter => ({ kind: "path", path: parameter }));
  const invocation = selected.input === undefined
    ? { kind: "method-call" as const, receiver: { kind: "path" as const, path: name }, method: "call",
        args: [{ kind: "tuple-literal" as const, elements: arguments_ }] }
    : planRustNativeProtocolInvocation(selected.input, { kind: "reference", expr: { kind: "path", path: name } }, arguments_, undefined, context);
  if (invocation === undefined) failRustPlannerInvariant("An admitted location callback requires its native protocol invocation.", call);
  return rustValueBlock([{ name, mutable: false, value }], { kind: "closure", move: true,
    params: parameters.map(parameter => ({ name: parameter, byRefCopy: false })),
    body: selected.input === undefined ? invocation : { kind: "method-call", receiver: invocation,
      method: "map_err", args: [{ kind: "path", path: "core::convert::Into::into" }] } });
}
