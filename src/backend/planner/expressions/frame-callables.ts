import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { diagnosticInput } from "../program/plan-context.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { rustFrameCallableTypes } from "../types/frame-callables.js";
import { rustFrameOwnerReference } from "../program/frame-owners.js";
import { planRustCaptureValue } from "./typed-locations.js";
import { rustValueBlock } from "../../target-ast/value-block.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";

function planFrameEntry(
  node: Node, carrier: TargetTypeRef, context: RustPlanContext,
): { readonly bindings: readonly { readonly name: string; readonly value: RustExpr }[];
  readonly entry: RustExpr; readonly owner: RustExpr } | undefined {
  const types = rustFrameCallableTypes(carrier, context);
  const implementation = context.input.program.callableValues.frames.implementationFor(node);
  const owner = types === undefined ? undefined : context.frameOwners?.get(types.definition);
  if (types === undefined || types.entryType.kind !== "named" || owner === undefined ||
    implementation === undefined || !types.entry.implementations.includes(implementation) || context.syntheticNames === undefined) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node), "rust.backend.frame-callable-construction",
      "A native frame callback requires its exact entry definition and live authored activation owner."));
    return undefined;
  }
  const identity = allocateRustSyntheticName(context.syntheticNames, "frame_entry_identity");
  const values = implementation.captures.map(capture => {
    const name = context.input.program.names.nameForDeclaration(capture.declaration);
    return name === undefined ? undefined : planRustCaptureValue(capture.reference, name, capture.storage, false, context);
  });
  if (values.some(value => value === undefined)) return undefined;
  const module = context.moduleNameByFileName.get(types.definition.ownerFileName);
  const state: RustExpr | undefined = (values.length === 0 && types.definition.environmentParameters.length === 0) || module === undefined ? undefined : {
    kind: "struct-literal", path: `crate::${module}::${implementation.stateName}`,
    fields: [...(values as RustExpr[]).map((value, index) => ({ name: `capture_${index}`, value })),
      ...(types.definition.environmentParameters.length === 0 ? [] : [{ name: "marker", value: { kind: "path" as const, path: "core::marker::PhantomData" } }])],
  };
  const payload = state === undefined ? [] : [implementation.copy ? state
    : { kind: "call" as const, path: "alloc::rc::Rc::new", args: [state] }];
  context.usedAliases?.add("rt");
  return { bindings: [{ name: identity, value: { kind: "method-call",
    receiver: { kind: "field", receiver: owner.expression, name: "counter" }, method: "allocate", args: [] } }],
    entry: { kind: "call", path: `${types.entryType.path}::${implementation.variantName}`,
      args: [{ kind: "path", path: identity }, ...payload] }, owner: rustFrameOwnerReference(owner) };
}

export function planRustFrameCallableEntry(
  node: Node, carrier: TargetTypeRef, context: RustPlanContext,
): RustExpr | undefined {
  const planned = planFrameEntry(node, carrier, context);
  return planned === undefined ? undefined : rustValueBlock(planned.bindings, planned.entry);
}

export function planRustFrameCallableValue(
  node: Node, carrier: TargetTypeRef, context: RustPlanContext,
): RustExpr | undefined {
  const planned = planFrameEntry(node, carrier, context);
  return planned === undefined ? undefined : rustValueBlock(planned.bindings,
    { kind: "call", path: "rt::FrameCallable::from_frame", args: [
      { kind: "call", path: "alloc::rc::Rc::clone", args: [planned.owner] }, planned.entry,
    ] });
}
