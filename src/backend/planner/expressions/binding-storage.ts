import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import type { RustExpr, RustType } from "../../target-ast/syntax/nodes.js";
import type { Node } from "@tsonic/tsts";
import type { RustNativeBindingStorage, RustNativeStorageBinding, RustPhysicalEmissionContext }
  from "../../../target-model/records/physical-emission-contexts.js";
import type { RustFrameCallableDefinition } from "../../../analysis/callables/frame-values.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { registerAliasFromPath } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { rustTypeFromSelectedNativeCarrierInContext } from "../types/render.js";
import { planRustNativeMemoryCall } from "./native-memory.js";

export type RustInlineBindingStorage = "cell" | "borrow-cell";

export function requireRustNativeStorageBinding(declaration: Node, context: RustPlanContext): RustNativeStorageBinding {
  const selected = context.emissionContext?.nativeBindings.find(row => row.declaration === declaration);
  if (selected === undefined)
    return failRustPlannerInvariant("A native binding requires its one completed storage in the exact selected emission context.", declaration);
  return selected;
}

export function requireRustNativeBindingStorage(declaration: Node, context: RustPlanContext): RustNativeBindingStorage {
  return requireRustNativeStorageBinding(declaration, context).storage;
}

export function requireRustNativeFrameStorage(definition: RustFrameCallableDefinition, emission: RustPhysicalEmissionContext | undefined) {
  const selected = emission?.nativeBindings.find(row => row.owner.kind === "frame" &&
    row.owner.declaration === definition.activation.ownerDeclaration);
  if (selected?.owner.kind !== "frame") return failRustPlannerInvariant(
    "A native frame requires its completed original owner and constructor in the exact physical context.", definition.activation.ownerDeclaration);
  return { carrier: selected.owner.frameCarrier, holderCarrier: selected.storage.holderCarrier,
    constructor: selected.storage.ownerConstructor };
}

export function rustNativeBindingSlotType(storage: RustNativeBindingStorage, context: RustPlanContext): RustType {
  return rustTypeFromSelectedNativeCarrierInContext(storage.slotCarrier, context);
}

export function createRustNativeBindingValue(storage: RustNativeBindingStorage, value: RustExpr,
  context: RustPlanContext, includeOwner: boolean): RustExpr | undefined {
  const payload = createRustNativeBindingPayload(storage, value, context);
  if (payload === undefined) return undefined;
  if (storage.slotConstructor !== null) registerAliasFromPath(context, storage.slotConstructor);
  if (includeOwner && storage.ownerConstructor !== null) registerAliasFromPath(context, storage.ownerConstructor);
  const slot: RustExpr = storage.slotConstructor === null ? payload
    : { kind: "call", path: storage.slotConstructor, args: [payload] };
  return !includeOwner || storage.ownerConstructor === null ? slot
    : { kind: "call", path: storage.ownerConstructor, args: [slot] };
}

export function createRustNativeBindingPayload(storage: RustNativeBindingStorage, value: RustExpr,
  context: RustPlanContext): RustExpr | undefined {
  if (storage.nativeAllocation !== null)
    return planRustNativeMemoryCall("allocate_native_location", value, storage.nativeAllocation, context);
  if (storage.valueConstructor !== null) registerAliasFromPath(context, storage.valueConstructor);
  return storage.valueConstructor === null ? value : { kind: "call", path: storage.valueConstructor, args: [value] };
}

export interface RustBindingStorageOperations {
  readonly read: (receiver: RustExpr) => RustExpr;
  readonly borrowedRead: (receiver: RustExpr) => RustExpr;
  readonly write: (receiver: RustExpr, value: RustExpr) => RustExpr;
}

export function rustBindingStorageOperations(storage: "location" | RustInlineBindingStorage, copyPayload = false): RustBindingStorageOperations {
  const call = (receiver: RustExpr, method: string, args: readonly RustExpr[] = []): RustExpr =>
    ({ kind: "method-call", receiver: receiver.kind === "reference" ? receiver.expr : receiver, method, args });
  if (storage === "borrow-cell") {
    return {
      borrowedRead: receiver => call(receiver, "borrow"),
      read: receiver => (rustValueBlock([
        { name: "owner", value: { kind: "reference", expr: receiver } },
        { name: "borrowed", value: call({ kind: "path", path: "owner" }, "borrow") },
      ], copyPayload
        ? { kind: "dereference", pointer: { kind: "path", path: "borrowed" } }
        : call({ kind: "path", path: "borrowed" }, "clone"))),
      write: (receiver, value) => ({ kind: "block", body: { statements: [{ kind: "let", name: "_", mutable: false,
        init: call(receiver, "replace", [value]) }] } }),
    };
  }
  return {
    borrowedRead: receiver => call(receiver, storage === "cell" ? "get" : "load"),
    read: receiver => call(receiver, storage === "cell" ? "get" : "load"),
    write: (receiver, value) => call(receiver, storage === "cell" ? "set" : "store", [value]),
  };
}
