import { requireRustCaptureOwnership } from "./typed-locations.js";
import type { Node } from "@tsonic/tsts";

import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import { rustGenericCallableImplementationPath } from "../declarations/callables/generic-implementations.js";
import { failRustPlannerInvariant } from "../../invariants.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustSourceBindingPath } from "../program/plan-context.js";
import { requireRustCarrierRequirements } from "../types/generic-requirements.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { planRustCaptureValue } from "./typed-locations.js";
import { planRustCapturedReceiverFields, planRustCapturedReceivers } from "./receiver-captures.js";
import { rustValueBlock } from "../../target-ast/syntax/value-block.js";

export function planRustGenericCallableValue(
  node: Node, carrier: TargetTypeRef, context: RustPlanContext,
): RustExpr | undefined {
  const selected = context.input.program.records.genericValue.get(node, carrier)
    ?? failRustPlannerInvariant("An admitted generic callable requires its native construction plan.", node);
  const { implementation, member } = selected;
  const rendered = rustTypeFromCarrierInContext(selected.carrier, context);
  const owner = rendered?.kind === "named" ? rendered : undefined;
  const path = rustGenericCallableImplementationPath(implementation, implementation.stateName, context);
  if (owner === undefined || path === undefined) failRustPlannerInvariant("An admitted generic callable requires its native implementation and storage type identities.", node);
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
  if (selected.marker) {
    fields.push({ name: "marker", value: { kind: "path", path: "core::marker::PhantomData" } });
  }
  const state: RustExpr = { kind: "struct-literal", path, fields };
  const value: RustExpr = { kind: "associated-call", owner, method: member.variantName,
    args: [implementation.storage === "shared" ? { kind: "call", path: "alloc::rc::Rc::new", args: [state] } : state],
  };
  return receiverBindings.length === 0 ? value : rustValueBlock(receiverBindings, value);
}
