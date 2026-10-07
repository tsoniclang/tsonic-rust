import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { diagnosticInput } from "../program/plan-context.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { rustFrameCallableTypes } from "../types/frame-callables.js";
import { projectRustFrameOwnerData, rustFrameOwnerReference } from "../program/frame-owners.js";
import { planRustCaptureValue } from "./typed-locations.js";
import { rustValueBlock } from "../../target-ast/value-block.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planRustReceiverFieldOwners, planRustReceiverOwners, validateRustCapturedReceiverFields,
  validateRustCapturedReceivers } from "./receiver-captures.js";

function planFrameEntry(
  node: Node, carrier: TargetTypeRef, context: RustPlanContext,
): { readonly bindings: readonly { readonly name: string; readonly value: RustExpr }[];
  readonly entry: RustExpr } | undefined {
  const types = rustFrameCallableTypes(carrier, context);
  const implementation = context.input.program.callableValues.frames.implementationFor(node);
  const owner = types === undefined ? undefined : context.frameOwners?.get(types.definition);
  if (types === undefined || types.entryType.kind !== "named" || owner === undefined ||
    implementation === undefined || !types.entry.implementations.includes(implementation) || context.syntheticNames === undefined) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node), "rust.backend.frame-callable-construction",
      "A native frame callback requires its exact entry definition and authored activation phase."));
    return undefined;
  }
  const identity = allocateRustSyntheticName(context.syntheticNames, "frame_entry_identity");
  const allocated: RustExpr | undefined = owner.kind === "construction"
    ? { kind: "method-call", receiver: owner.counter, method: "allocate", args: [] }
    : projectRustFrameOwnerData(owner, data => ({ kind: "method-call",
      receiver: { kind: "field", receiver: data, name: types.definition.counterName }, method: "allocate", args: [] }));
  if (allocated === undefined) return undefined;
  if (!validateRustCapturedReceiverFields(node, implementation.capture.receiverFields, context) ||
    !validateRustCapturedReceivers(node, implementation.capture.receivers, context)) return undefined;
  const values = implementation.captures.map(capture => {
    const name = context.input.program.names.nameForDeclaration(capture.declaration);
    const move = context.input.program.valueLifetimes.canMoveCapture(node, capture.declaration);
    return name === undefined ? undefined : planRustCaptureValue(capture.reference, name, capture.storage, move, context);
  });
  if (values.some(value => value === undefined)) return undefined;
  const fields = planRustReceiverFieldOwners(implementation.receiverFields, context, context,
    { staticStorage: false, offset: values.length });
  const receivers = fields === undefined ? undefined : planRustReceiverOwners(node, implementation.receivers, context, fields.context,
    { staticStorage: false, offset: values.length + implementation.receiverFields.length });
  if (fields === undefined || receivers === undefined) return undefined;
  const receiverBindings = [...fields.bindings, ...receivers.bindings];
  values.push(...receiverBindings.map(binding => ({ kind: "path" as const, path: binding.name })));
  const module = context.moduleNameByFileName.get(types.definition.ownerFileName);
  const state: RustExpr | undefined = (values.length === 0 && types.definition.environmentParameters.length === 0) || module === undefined ? undefined : {
    kind: "struct-literal", path: `crate::${module}::${implementation.stateName}`,
    fields: [...(values as RustExpr[]).map((value, index) => ({ name: `capture_${index}`, value })),
      ...(types.definition.environmentParameters.length === 0 ? [] : [{ name: "marker", value: { kind: "path" as const, path: "core::marker::PhantomData" } }])],
  };
  const payload = state === undefined ? [] : [implementation.copy ? state
    : { kind: "call" as const, path: "alloc::rc::Rc::new", args: [state] }];
  context.usedAliases?.add("rt");
  return { bindings: [{ name: identity, value: allocated }, ...receiverBindings],
    entry: { kind: "call", path: `${types.entryType.path}::${implementation.variantName}`,
      args: [{ kind: "path", path: identity }, ...payload] } };
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
  const definition = context.input.program.callableValues.frames.definitionFor(carrier);
  const owner = definition === undefined ? undefined : context.frameOwners?.get(definition);
  if (owner?.kind !== "live") {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node), "rust.backend.frame-callable-publication",
      "An owning callback can be published only from its exact live activation."));
    return undefined;
  }
  const planned = planFrameEntry(node, carrier, context);
  return planned === undefined ? undefined : rustValueBlock(planned.bindings,
    { kind: "call", path: "rt::FrameCallable::from_frame", args: [
      { kind: "call", path: "alloc::rc::Rc::clone", args: [rustFrameOwnerReference(owner)] }, planned.entry,
    ] });
}
