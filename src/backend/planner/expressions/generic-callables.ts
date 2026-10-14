import { requireRustCaptureOwnership } from "./typed-locations.js";
import type { Node } from "@tsonic/tsts";

import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import { rustGenericCallableImplementationPath } from "../declarations/callables/generic-implementations.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { diagnosticInput, rustSourceBindingPath } from "../program/plan-context.js";
import { requireRustCarrierRequirements } from "../types/generic-requirements.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { planRustCaptureValue } from "./typed-locations.js";
import { planRustCapturedReceiverFields, planRustCapturedReceivers } from "./receiver-captures.js";
import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import { rustGenericCallableSignaturesMatch } from "../../../target-model/conversions/generic-callable.js";

export function planRustGenericCallableValue(
  node: Node, carrier: TargetTypeRef, context: RustPlanContext,
): RustExpr | undefined {
  const plan = context.input.program.callableValues.generic;
  const implementation = plan.implementationFor(node);
  const selected = context.input.program.callableValues.nativeStorage.operandFor(node);
  const physical = selected.kind === "unresolved" ? undefined : selected.carrier;
  const definition = physical === undefined ? undefined : plan.physical.definitionFor(physical);
  const member = definition?.members.length === 1 ? definition.members[0] : undefined;
  const environment = implementation === undefined ? undefined : plan.physical.environmentFor(implementation);
  const rendered = physical === undefined ? undefined : rustTypeFromCarrierInContext(physical, context);
  const owner = rendered?.kind === "named" ? rendered : undefined;
  const path = implementation === undefined ? undefined
    : rustGenericCallableImplementationPath(implementation, implementation.stateName, context);
  if (implementation === undefined || definition === undefined || environment === undefined || owner === undefined || path === undefined ||
    member?.implementation !== implementation || physical === undefined || !rustGenericCallableSignaturesMatch(carrier, physical)) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
      "rust.backend.generic-callable-construction", "A generic callable requires one sealed native implementation and environment."));
    return undefined;
  }
  const fields: { name: string; value: RustExpr }[] = [];
  for (const [index, capture] of implementation.captures.entries()) {
    const binding = context.input.program.records.sourceBinding.get(capture.reference);
    const source = binding === undefined ? undefined : rustSourceBindingPath(context, binding);
    const move = (requireRustCaptureOwnership(node, capture.declaration, context).read.kind !== "clone");
    if (source === undefined || !requireRustCarrierRequirements(capture.carrier,
      move ? [] : ["clone"], capture.reference, { ...context, callableDeclaration: node })) return undefined;
    fields.push({ name: `capture_${index}`, value: planRustCaptureValue(node, capture, source, capture.storage, context) });
  }
  const receivers = planRustCapturedReceiverFields(node, implementation.receiverFields, context, context,
    { staticStorage: false, offset: implementation.captures.length });
  if (receivers === undefined) return undefined;
  const whole = planRustCapturedReceivers(node, implementation.receivers, context, context,
    { staticStorage: false, offset: implementation.captures.length + implementation.receiverFields.length });
  if (whole === undefined) return undefined;
  const receiverBindings = [...receivers.bindings, ...whole.bindings];
  for (const [index, binding] of receiverBindings.entries()) fields.push({
    name: `capture_${implementation.captures.length + index}`, value: { kind: "path", path: binding.name },
  });
  if (definition.signature.environmentParameters.length + environment.parameters.length > 0) {
    fields.push({ name: "marker", value: { kind: "path", path: "core::marker::PhantomData" } });
  }
  const state: RustExpr = { kind: "struct-literal", path, fields };
  const value: RustExpr = { kind: "associated-call", owner, method: member.variantName,
    args: [implementation.storage === "shared" ? { kind: "call", path: "alloc::rc::Rc::new", args: [state] } : state],
  };
  return receiverBindings.length === 0 ? value : rustValueBlock(receiverBindings, value);
}
