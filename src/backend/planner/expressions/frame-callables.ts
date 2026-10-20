import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../../invariants.js";
import { rustFrameCallableTypes, type RustFrameCallableTypes } from "../types/frame-callables.js";
import { projectRustFrameOwnerData, rustFrameOwnerReference, type RustLiveFrameOwner } from "../program/frame-owners.js";
import { planRustCaptureValue } from "./typed-locations.js";
import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planRustReceiverFieldOwners, planRustReceiverOwners } from "./receiver-captures.js";

function planFrameEntry(
  node: Node, carrier: TargetTypeRef, context: RustPlanContext,
): { readonly bindings: readonly { readonly name: string; readonly value: RustExpr }[];
  readonly entry: RustExpr } | undefined {
  const types = rustFrameCallableTypes(carrier, context);
  const implementation = context.input.program.records.frameImplementation.get(node);
  const owner = context.frameOwners?.get(types.definition);
  const emission = context.input.program.records.frameDeclaration.get(types.definition);
  if (types.entryType.kind !== "named" || owner === undefined || implementation === undefined || implementation.independent || emission === undefined || context.syntheticNames === undefined)
    failRustPlannerInvariant("An admitted native frame callback requires its exact entry, payload and authored activation phase.", node);
  const identity = allocateRustSyntheticName(context.syntheticNames, "frame_entry_identity");
  const counterName = emission.counterName;
  if (owner.kind === "live" && counterName === undefined) {
    failRustPlannerInvariant("An admitted live callback requires its exact retained activation counter.", node);
  }
  const allocated: RustExpr | undefined = owner.kind === "construction"
    ? { kind: "method-call", receiver: owner.counter, method: "allocate", args: [] }
    : projectRustFrameOwnerData(owner, data => ({ kind: "method-call",
      receiver: { kind: "field", receiver: data, name: counterName! }, method: "allocate", args: [] }));
  if (allocated === undefined) return undefined;
  const values = implementation.captures.map(capture => {
    const name = context.input.program.records.sourceName.get(capture.declaration);
    return name === undefined ? undefined : planRustCaptureValue(node, capture, name, capture.storage, context);
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
  const hasPayload = emission.payloads.get(implementation);
  if (hasPayload === undefined || hasPayload && module === undefined)
    failRustPlannerInvariant("An admitted frame entry requires its selected native payload and source module.", node);
  const state: RustExpr | undefined = !hasPayload ? undefined : {
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

export function rustIndependentFrameConstruction(
  node: Node, carrier: TargetTypeRef, context: RustPlanContext,
): { readonly carrier: TargetTypeRef; wrap(value: RustExpr): RustExpr } | undefined {
  const implementation = context.input.program.records.frameImplementation.get(node);
  if (implementation?.independent !== true) return undefined;
  const types = rustFrameCallableTypes(carrier, context);
  const independent = context.input.program.records.frameType.get(carrier)?.independentCarrier;
  if (independent === undefined) failRustPlannerInvariant("An admitted independent frame entry requires its native callable type.", node);
  return { carrier: independent,
    wrap: value => ({ kind: "associated-call", owner: types.rootType, method: "from_independent", args: [value] }) };
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
  const types = rustFrameCallableTypes(carrier, context);
  const owner = context.frameOwners?.get(types.definition);
  if (owner?.kind !== "live") {
    failRustPlannerInvariant("An admitted owning callback must publish from its exact live activation.", node);
  }
  const planned = planFrameEntry(node, carrier, context);
  return planned === undefined ? undefined
    : rustValueBlock(planned.bindings, publishRustFrameCallable(types, owner, planned.entry));
}

export function publishRustFrameCallable(
  types: RustFrameCallableTypes, owner: RustLiveFrameOwner, entry: RustExpr,
  ownedPublication?: { readonly entryName: string },
): RustExpr {
  const retained: RustExpr = ownedPublication !== undefined ? owner.expression
    : { kind: "call", path: "alloc::rc::Rc::clone", args: [rustFrameOwnerReference(owner)] };
  const selectedEntry: RustExpr = ownedPublication === undefined ? entry : { kind: "path", path: ownedPublication.entryName };
  const publication: RustExpr = types.entry.hasIndependent
    ? { kind: "associated-call", owner: types.rootType, method: "from_entry",
      args: [selectedEntry, { kind: "closure", params: [], body: retained }] }
    : { kind: "associated-call", owner: types.rootType, method: "from_frame", args: [retained, selectedEntry] };
  return ownedPublication === undefined ? publication
    : rustValueBlock([{ name: ownedPublication.entryName, value: entry }], publication);
}
