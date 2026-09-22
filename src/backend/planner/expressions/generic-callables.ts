import type { Node } from "@tsonic/tsts";
import { rustSourceBindingFactKey } from "../../../analysis/facts/keys.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import { rustGenericCallableImplementationPath } from "../declarations/generic-callables.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { diagnosticInput, rustSourceBindingPath } from "../program/plan-context.js";
import { requireRustCarrierRequirements } from "../types/generic-requirements.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { planRustCaptureValue } from "./typed-locations.js";

export function planRustGenericCallableValue(
  node: Node, carrier: TargetTypeRef, context: RustPlanContext,
): RustExpr | undefined {
  const plan = context.input.program.callableValues.generic;
  const implementation = plan.implementationFor(node);
  const definition = plan.definitionFor(carrier);
  const rendered = rustTypeFromCarrierInContext(carrier, context);
  const owner = rendered?.kind === "named" ? rendered : undefined;
  const path = implementation === undefined ? undefined
    : rustGenericCallableImplementationPath(implementation, implementation.stateName, context);
  if (implementation === undefined || definition === undefined || owner === undefined || path === undefined) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
      "rust.backend.generic-callable-construction", "A generic callable requires one sealed native implementation and environment."));
    return undefined;
  }
  const fields: { name: string; value: RustExpr }[] = [];
  for (const [index, capture] of implementation.captures.entries()) {
    const binding = context.input.program.facts.getFact(capture.reference, rustSourceBindingFactKey);
    const source = binding === undefined ? undefined : rustSourceBindingPath(context, binding);
    const move = context.input.program.valueLifetimes.canMoveCapture(node, capture.declaration);
    if (source === undefined || !requireRustCarrierRequirements(capture.carrier,
      move ? [] : ["clone"], capture.reference, { ...context, callableDeclaration: node })) return undefined;
    fields.push({ name: `capture_${index}`, value: planRustCaptureValue(capture.reference, source, capture.storage, move, context) });
  }
  if (definition.signature.environmentParameters.length > 0) {
    fields.push({ name: "marker", value: { kind: "path", path: "core::marker::PhantomData" } });
  }
  const state: RustExpr = { kind: "struct-literal", path, fields };
  return { kind: "associated-call", owner, method: implementation.variantName,
    args: [definition.storage === "shared" ? { kind: "call", path: "alloc::rc::Rc::new", args: [state] } : state],
  };
}
