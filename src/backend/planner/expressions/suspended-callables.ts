import type { Node } from "@tsonic/tsts";
import { rustSourceBindingFactKey } from "../../../analysis/facts/keys.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { diagnosticInput, rustSourceBindingPath } from "../program/plan-context.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { requireRustCarrierRequirements } from "../types/generic-requirements.js";
import { planRustCaptureValue } from "./typed-locations.js";
import { rustSuspendedCallableStateType } from "../types/suspended-callables.js";

export function planRustSuspendedCallableConstruction(node: Node, context: RustPlanContext): RustExpr | undefined {
  const implementation = context.input.program.callableValues.suspended.implementationFor(node);
  const ownerType = implementation === undefined ? undefined : rustTypeFromCarrierInContext(implementation.carrier, context);
  const stateType = implementation === undefined ? undefined : rustSuspendedCallableStateType(implementation, context);
  if (implementation === undefined || ownerType === undefined || stateType === undefined || context.syntheticNames === undefined) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
      "rust.backend.suspended-callable-state", "A suspended callable has no sealed native state declaration."));
    return undefined;
  }
  const bindings: { readonly name: string; readonly value: RustExpr }[] = [];
  for (const [index, capture] of implementation.captures.entries()) {
    const binding = context.input.program.facts.getFact(capture.reference, rustSourceBindingFactKey);
    const source = binding === undefined ? undefined : rustSourceBindingPath(context, binding);
    const move = context.input.program.valueLifetimes.canMoveCapture(node, capture.declaration);
    if (source === undefined || !requireRustCarrierRequirements(capture.carrier,
      move ? ["static"] : ["clone", "static"], capture.reference, { ...context, callableDeclaration: node })) return undefined;
    bindings.push({ name: allocateRustSyntheticName(context.syntheticNames, `capture_${index}`),
      value: planRustCaptureValue(capture.reference, source, capture.storage, move, context),
    });
  }
  const weakName = allocateRustSyntheticName(context.syntheticNames, "callable_owner");
  context.usedAliases?.add("rt");
  return { kind: "block", bindings, value: {
    kind: "associated-call", owner: ownerType, method: "from_shared", args: [{
      kind: "associated-call", owner: { kind: "named", path: "alloc::rc::Rc", genericArguments: [{ kind: "type", type: stateType }] },
      method: "new_cyclic", args: [{
        kind: "closure", params: [{ name: weakName, byRefCopy: false }], move: true,
        body: { kind: "struct-literal", path: stateType.path, fields: [{ name: "state", value: {
          kind: "tuple-literal", elements: bindings.map(binding => ({ kind: "path", path: binding.name })),
        } }, { name: "owner", value: { kind: "method-call", receiver: { kind: "path", path: weakName }, method: "clone", args: [] } }] },
      }],
    }],
  } };
}
