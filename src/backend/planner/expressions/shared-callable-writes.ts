import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustCallableJoinWrite } from "../../../target-model/records/native/native-storage.js";
import { rustCallablePhysicalSignature } from "../../../target-model/conversions/callable-physical.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustCallableConstructionType } from "../types/constructions.js";
import { rustEliminateInfallibleResult } from "../types/fallible-shape.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { isRustUnitCarrier } from "../../../target-model/types/carriers/js.js";

// A callable whose error is uninhabited, written into storage shared with other producers, keeps its own invocation
// inside the shared boxed callable and eliminates its error.
export function planRustCallableJoinWrite(
  write: RustCallableJoinWrite, expression: RustExpr, node: Node, context: RustPlanContext,
): RustExpr {
  const signature = rustCallablePhysicalSignature(write.carrier);
  const targetType = rustCallableConstructionType(write.carrier, context);
  const argumentsType = signature === undefined ? undefined : rustTypeFromCarrierInContext({ kind: "tuple", elements: signature.parameters }, context);
  const errorType = signature === undefined ? undefined : rustTypeFromCarrierInContext(signature.error, context);
  const names = context.syntheticNames;
  if (signature === undefined || targetType === undefined || argumentsType === undefined || errorType === undefined || names === undefined)
    failRustPlannerInvariant("An admitted shared callable write requires its rendered native callable and name scope.", node);
  const callable = allocateRustSyntheticName(names, "callable");
  const argumentsName = allocateRustSyntheticName(names, "arguments");
  const value = rustEliminateInfallibleResult({ kind: "method-call", receiver: { kind: "path", path: callable },
    method: "call", args: [{ kind: "path", path: argumentsName }] },
  allocateRustSyntheticName(names, "call_value"), allocateRustSyntheticName(names, "call_error"));
  // A unit result is evaluated before Ok(()) rather than passed as the argument (clippy::unit_arg).
  const unit = isRustUnitCarrier(signature.result);
  const result: RustExpr = { kind: "call", path: "Ok", genericArguments: [{ kind: "type", type: { kind: "infer" } },
    { kind: "type", type: errorType }], args: [unit ? { kind: "tuple-literal", elements: [] } : value] };
  const body: RustExpr = unit ? { kind: "evaluate-then", effect: value, discard: "unit", value: result } : result;
  return { kind: "block", body: { statements: [{ kind: "let", mutable: false, name: callable, init: expression }, { kind: "tail", expr: {
    kind: "associated-call", owner: targetType, method: "new", args: [{
      kind: "closure", move: true, params: [{ name: argumentsName, byRefCopy: false, type: argumentsType }], body,
    }],
  } }] } };
}
