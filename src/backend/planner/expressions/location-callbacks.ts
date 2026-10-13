import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import type { Node } from "@tsonic/tsts";

import { rustCallableProtocol, rustClosureProtocol } from "../../../target-model/types/index.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { rustNativeCallableOperand } from "../../../analysis/callables/native-conversions.js";
import { planRustNativeProtocolInvocation } from "./calls/native-input.js";

export function planRustLocationCallback(
  call: Node,
  argumentIndex: number,
  value: RustExpr,
  context: RustPlanContext,
): RustExpr | undefined {
  const selected = context.input.program.records.selectedCall.get(call);
  const carrier = selected?.member.parameters[argumentIndex]?.type;
  if (rustClosureProtocol(carrier)?.fallible === true) return value;
  const callable = rustCallableProtocol(carrier);
  if (callable === undefined || context.syntheticNames === undefined) return undefined;
  const node = context.input.program.source.ast.arguments(call)[argumentIndex];
  const source = node === undefined || carrier === undefined ? undefined : rustNativeCallableOperand(carrier, node, {
    records: context.input.program.records, storage: context.input.program.callableValues.nativeStorage,
    producers: context.input.program.callableValues.nativeProducers, definitions: context.input.program.typeDefinitions,
  });
  if (source === undefined) return undefined;
  const boundary = context.input.program.retainedCallableInputs.forBoundary(call, argumentIndex);
  if (source.input !== undefined && boundary?.inputs.includes(source.input) !== true) return undefined;
  const name = allocateRustSyntheticName(context.syntheticNames, "location_callback");
  const parameters = callable.parameters.map(() => allocateRustSyntheticName(context.syntheticNames!, "value"));
  const arguments_: RustExpr[] = parameters.map(name => ({ kind: "path", path: name }));
  const invocation = source.input === undefined ? {
    kind: "method-call" as const, receiver: { kind: "path" as const, path: name }, method: "call",
    args: [{ kind: "tuple-literal" as const, elements: arguments_ }],
  } : planRustNativeProtocolInvocation(source.input,
    { kind: "reference", expr: { kind: "path", path: name } }, arguments_, undefined, context);
  if (invocation === undefined) return undefined;
  return rustValueBlock([{ name, mutable: false, value }], {
      kind: "closure", move: true,
      params: parameters.map(name => ({ name, byRefCopy: false })),
      body: source.input === undefined ? invocation : { kind: "method-call", receiver: invocation,
        method: "map_err", args: [{ kind: "path", path: "core::convert::Into::into" }] },
    });
}
