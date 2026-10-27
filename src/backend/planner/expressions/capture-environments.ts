import { requireRustCaptureOwnership } from "./typed-locations.js";
import type { Node } from "@tsonic/tsts";
import type { RustClosureCaptureFact } from "../../../target-model/records/operations/operation-selections.js";

import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustCapturedBinding, RustPlanContext } from "../program/plan-context.js";
import { rustSourceBindingPath } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { requireRustCarrierRequirements } from "../types/generic-requirements.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planRustCaptureValue } from "./typed-locations.js";

export function planRustCapturedEnvironment(
  owner: Node, captures: RustClosureCaptureFact["captures"], context: RustPlanContext,
  options: { readonly staticStorage: boolean; readonly mutableValueCapture: boolean; readonly sharedStateName?: string },
): { readonly bindings: readonly { readonly name: string; readonly value: RustExpr }[];
  readonly capturedBindings: readonly RustCapturedBinding[] } | undefined {
  const bindings: { readonly name: string; readonly value: RustExpr }[] = [];
  const capturedBindings = [...(context.capturedBindings ?? [])];
  for (const [index, capture] of captures.entries()) {
    const move = capture.storage === "cell" || capture.storage === "borrow-cell" ||
      (requireRustCaptureOwnership(owner, capture.declaration, context).read.kind !== "clone");
    if (context.syntheticNames === undefined) failRustPlannerInvariant("An admitted native environment requires its hygienic name scope.", owner);
    if (!requireRustCarrierRequirements(capture.carrier,
      [...(move ? [] : ["clone" as const]), ...(options.staticStorage ? ["static" as const] : [])],
      capture.reference, context)) return undefined;
    const binding = context.input.program.records.sourceBinding.get(capture.reference);
    const selected = context.input.program.records.captureEnvironment.get(owner, capture.reference);
    if (binding === undefined || selected === undefined) failRustPlannerInvariant("An admitted environment requires its exact captured source binding.", capture.reference);
    const sourceName = selected.name;
    const sourcePath = selected.lexicalBinding ?? rustSourceBindingPath(context, binding);
    if (sourcePath === undefined) failRustPlannerInvariant("An admitted captured binding requires its exact native path.", capture.reference);
    if (capture.mutable === true) {
      if (capture.storage !== "value" || !options.mutableValueCapture) {
        failRustPlannerInvariant("An admitted mutable capture requires its exact owning native callable contract.", owner);
      }
      capturedBindings.push({ declaration: capture.declaration, expression: { kind: "path", path: sourcePath },
        referent: undefined, storage: "value", valueCarrier: capture.carrier });
      continue;
    }
    const name = allocateRustSyntheticName(context.syntheticNames, `capture_${sourceName}`);
    if (options.sharedStateName === undefined)
      bindings.push({ name, value: planRustCaptureValue(owner, capture, sourcePath, capture.storage, context) });
    const referent: RustExpr | undefined = options.sharedStateName === undefined ? undefined : {
      kind: "field", receiver: {
          kind: "field", receiver: { kind: "path", path: options.sharedStateName }, name: "state",
        }, name: String(index),
    };
    capturedBindings.push({ declaration: capture.declaration, referent,
      expression: referent === undefined ? { kind: "path", path: name } : { kind: "reference", expr: referent },
      storage: capture.storage, valueCarrier: capture.carrier,
      ...(options.sharedStateName === undefined ? {} : { borrowed: "shared" as const }) });
  }
  return { bindings, capturedBindings };
}
