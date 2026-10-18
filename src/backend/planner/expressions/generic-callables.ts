import type { Node } from "@tsonic/tsts";

import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import { failRustPlannerInvariant, missingFactDiagnostic } from "../diagnostics.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { diagnosticInput, requireRustEmissionContext, registerAliasFromPath, rustSourceBindingPath } from "../program/plan-context.js";
import { rustTypeFromCarrierInContext, rustTypeFromSelectedNativeCarrierInContext } from "../types/render.js";
import { planRustCaptureValue } from "./typed-locations.js";
import { planRustCapturedReceiverFields, planRustCapturedReceivers } from "./receiver-captures.js";
import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import { rustGenericCallableSignaturesMatch } from "../../../target-model/conversions/generic-callable.js";
import { requireRustNativeCaptureEnvironment } from "./binding-storage.js";

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
  if (implementation === undefined || definition === undefined || environment === undefined || owner === undefined ||
    member?.implementation !== implementation || physical === undefined || !rustGenericCallableSignaturesMatch(carrier, physical)) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
      "rust.backend.generic-callable-construction", "A generic callable requires one sealed native implementation and environment."));
    return undefined;
  }
  const emission = requireRustEmissionContext(context, member, "member", implementation.declaration);
  const nativeEnvironment = requireRustNativeCaptureEnvironment(emission,
    { kind: "generic", definition, implementation, member }, context);
  const stateType = rustTypeFromSelectedNativeCarrierInContext(nativeEnvironment.stateCarrier, context);
  if (stateType.kind !== "named") return failRustPlannerInvariant(
    "A sealed generic callable environment requires its selected native named state.", node);
  const fieldName = (index: number): string => {
    const path = nativeEnvironment.slotPaths[index];
    if (path?.length !== 1 || path[0] === undefined) return failRustPlannerInvariant(
      "A generic callable creation requires its exact selected native capture field.", node);
    return path[0];
  };
  const fields: { name: string; value: RustExpr }[] = [];
  for (const [index, capture] of implementation.captures.entries()) {
    const binding = context.input.program.records.sourceBinding.get(capture.reference);
    const source = binding === undefined ? undefined : rustSourceBindingPath(context, binding);
    if (source === undefined) return undefined;
    fields.push({ name: fieldName(index), value: planRustCaptureValue(node, capture, source, capture.storage, context) });
  }
  const receivers = planRustCapturedReceiverFields(node, implementation.receiverFields, context, context,
    { staticStorage: false, offset: implementation.captures.length });
  if (receivers === undefined) return undefined;
  const whole = planRustCapturedReceivers(node, implementation.receivers, context, context,
    { staticStorage: false, offset: implementation.captures.length + implementation.receiverFields.length });
  if (whole === undefined) return undefined;
  const receiverBindings = [...receivers.bindings, ...whole.bindings];
  for (const [index, binding] of receiverBindings.entries()) fields.push({
    name: fieldName(implementation.captures.length + index), value: { kind: "path", path: binding.name },
  });
  if (definition.signature.environmentParameters.length + environment.parameters.length > 0) {
    fields.push({ name: "marker", value: { kind: "path", path: "core::marker::PhantomData" } });
  }
  const state: RustExpr = { kind: "struct-literal", path: stateType.path, fields };
  if (nativeEnvironment.constructor !== null) registerAliasFromPath(context, nativeEnvironment.constructor);
  const value: RustExpr = { kind: "associated-call", owner, method: member.variantName,
    args: [nativeEnvironment.constructor === null ? state
      : { kind: "call", path: nativeEnvironment.constructor, args: [state] }],
  };
  return receiverBindings.length === 0 ? value : rustValueBlock(receiverBindings, value);
}
