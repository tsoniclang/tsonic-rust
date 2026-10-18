import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import type { Node } from "@tsonic/tsts";

import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { diagnosticInput, registerAliasFromPath, requireRustCallableBodyContext, rustSourceBindingPath } from "../program/plan-context.js";
import { failRustPlannerInvariant, missingFactDiagnostic } from "../diagnostics.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { rustCallableConstructionType } from "./fundamentals.js";
import { planRustCaptureValue } from "./typed-locations.js";
import { rustSuspendedCallableStateType } from "../types/suspended-callables.js";
import { planRustCapturedReceiverFields, planRustCapturedReceivers } from "./receiver-captures.js";
import { requireRustNativeCaptureEnvironment } from "./binding-storage.js";
import { rustTypeFromSelectedNativeCarrierInContext } from "../types/render.js";

export function planRustSuspendedCallableConstruction(node: Node, context: RustPlanContext): RustExpr | undefined {
  const implementation = context.input.program.callableValues.suspended.implementationFor(node);
  const carrier = implementation === undefined ? undefined :
    context.input.program.callableValues.nativeProducers.physicalFor(node, implementation.carrier);
  const ownerType = carrier === undefined ? undefined : rustCallableConstructionType(carrier, context);
  if (implementation === undefined || ownerType === undefined || context.syntheticNames === undefined) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
      "rust.backend.suspended-callable-state", "A suspended callable has no sealed native state declaration."));
    return undefined;
  }
  const emission = requireRustCallableBodyContext(context, node);
  const environment = requireRustNativeCaptureEnvironment(emission, { kind: "suspended", implementation }, context);
  const stateType = rustSuspendedCallableStateType(environment, context);
  const holder = rustTypeFromSelectedNativeCarrierInContext(environment.holderCarrier, context);
  if (holder.kind !== "named" || environment.constructor === null) return failRustPlannerInvariant(
    "A suspended callable requires its exact selected native cyclic holder and constructor.", node);
  const separator = environment.constructor.lastIndexOf("::");
  if (separator <= 0) return failRustPlannerInvariant("A native cyclic callable constructor lost its selected method path.", node);
  const method = environment.constructor.slice(separator + 2);
  registerAliasFromPath(context, environment.constructor);
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
      kind: "associated-call", owner: holder,
      method, args: [{
        kind: "closure", params: [{ name: weakName, byRefCopy: false }], move: true,
        body: { kind: "struct-literal", path: stateType.path, fields: [{ name: "state", value: {
          kind: "tuple-literal", elements: bindings.map(binding => ({ kind: "path", path: binding.name })),
        } }, { name: "owner", value: { kind: "method-call", receiver: { kind: "path", path: weakName }, method: "clone", args: [] } }] },
      }],
    }],
  });
}
