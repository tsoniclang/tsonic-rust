import type { Node } from "@tsonic/tsts";
import { rustSelectedCallKey } from "../../../target-model/facts/selections.js";
import { rustCallableProtocol, rustClosureProtocol } from "../../../target-model/types/index.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";

export function planRustLocationCallback(
  call: Node,
  argumentIndex: number,
  value: RustExpr,
  context: RustPlanContext,
): RustExpr | undefined {
  const selected = context.input.program.facts.getFact(call, rustSelectedCallKey);
  const carrier = selected?.member.parameters[argumentIndex]?.type;
  if (rustClosureProtocol(carrier)?.fallible === true) return value;
  const callable = rustCallableProtocol(carrier);
  if (callable === undefined || context.syntheticNames === undefined) return undefined;
  const name = allocateRustSyntheticName(context.syntheticNames, "location_callback");
  const parameters = callable.parameters.map(() => allocateRustSyntheticName(context.syntheticNames!, "value"));
  return {
    kind: "block", bindings: [{ name, mutable: false, value }],
    value: {
      kind: "closure", move: true,
      params: parameters.map(name => ({ name, byRefCopy: false })),
      body: {
        kind: "method-call", receiver: { kind: "path", path: name }, method: "call",
        args: [{ kind: "tuple-literal", elements: parameters.map(name => ({ kind: "path", path: name })) }],
      },
    },
  };
}
