import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import type { Node } from "@tsonic/tsts";

import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { diagnosticInput, rustSourceBindingPath } from "../program/plan-context.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { rustCallableConstructionType } from "./fundamentals.js";
import { planRustCaptureValue } from "./typed-locations.js";
import { rustSuspendedCallableStateType } from "../types/suspended-callables.js";
import { planRustCapturedReceiverFields, planRustCapturedReceivers } from "./receiver-captures.js";

export function planRustSuspendedCallableConstruction(node: Node, context: RustPlanContext): RustExpr | undefined {
  const implementation = context.input.program.callableValues.suspended.implementationFor(node);
  const carrier = implementation === undefined ? undefined :
    context.input.program.callableValues.nativeProducers.physicalFor(node, implementation.carrier);
  const ownerType = carrier === undefined ? undefined : rustCallableConstructionType(carrier, context);
  const stateType = implementation === undefined ? undefined : rustSuspendedCallableStateType(implementation, context);
  if (implementation === undefined || ownerType === undefined || stateType === undefined || context.syntheticNames === undefined) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
      "rust.backend.suspended-callable-state", "A suspended callable has no sealed native state declaration."));
    return undefined;
  }
  const bindings: { readonly name: string; readonly value: RustExpr }[] = [];
  for (const [index, capture] of implementation.captures.entries()) {
    const binding = context.input.program.records.sourceBinding.get(capture.reference);
    const source = binding === undefined ? undefined : rustSourceBindingPath(context, binding);
    if (source === undefined) return undefined;
    bindings.push({ name: allocateRustSyntheticName(context.syntheticNames, `capture_${index}`),
      value: planRustCaptureValue(node, capture, source, capture.storage, context),
    });
  }
  const receivers = planRustCapturedReceiverFields(node, implementation.receiverFields, context, context,
    { staticStorage: true, offset: bindings.length });
  if (receivers === undefined) return undefined;
  bindings.push(...receivers.bindings);
  const whole = planRustCapturedReceivers(node, implementation.receivers, context, context,
    { staticStorage: true, offset: bindings.length });
  if (whole === undefined) return undefined;
  bindings.push(...whole.bindings);
  const weakName = allocateRustSyntheticName(context.syntheticNames, "callable_owner");
  context.usedAliases?.add("rt");
  return rustValueBlock(bindings, {
    kind: "associated-call", owner: ownerType, method: "from_shared", args: [{
      kind: "associated-call", owner: { kind: "named", path: "alloc::rc::Rc", genericArguments: [{ kind: "type", type: stateType }] },
      method: "new_cyclic", args: [{
        kind: "closure", params: [{ name: weakName, byRefCopy: false }], move: true,
        body: { kind: "struct-literal", path: stateType.path, fields: [{ name: "state", value: {
          kind: "tuple-literal", elements: bindings.map(binding => ({ kind: "path", path: binding.name })),
        } }, { name: "owner", value: { kind: "method-call", receiver: { kind: "path", path: weakName }, method: "clone", args: [] } }] },
      }],
    }],
  });
}
