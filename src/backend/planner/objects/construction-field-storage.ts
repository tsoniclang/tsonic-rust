import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustAdmittedConstruction } from "../../../target-model/records/construction.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustValueFieldLocation } from "./value-fields.js";
import { createRustFrameBindingValue, initializeOrWriteRustFrameBindingValue, initializeRustFrameBindingValue, rustFrameBindingLocalLocation } from "../bindings/frame-storage.js";
import { createRustCapturedField, createRustDeferredFieldOwner, initializeRustCapturedField,
  initializeOrWriteRustCapturedField, rustCapturedFieldLocation, rustCapturedFieldStorage } from "./captured-fields.js";

export interface RustConstructionFieldStorage {
  readonly deferred: boolean;
  readonly mutable: boolean;
  readonly retainedFieldOwner: boolean;
  create(value: RustExpr): RustExpr;
  createDeferred(): RustExpr | undefined;
  initialize(owner: RustExpr, value: RustExpr): RustExpr;
  initializeOrWrite(owner: RustExpr, value: RustExpr): RustExpr | undefined;
  location(owner: RustExpr): RustValueFieldLocation | undefined;
}

export function rustConstructionFieldStorage(
  declaration: Node, carrier: TargetTypeRef, context: RustPlanContext, plan: RustAdmittedConstruction,
): RustConstructionFieldStorage {
  const binding = context.input.program.records.frameBindingDeclaration.get(declaration);
  if (binding !== undefined) return {
    deferred: binding.initialization === "deferred", mutable: binding.storage === "value" &&
      plan.unpublishedMutations.has(declaration), retainedFieldOwner: false,
    create: value => createRustFrameBindingValue(binding, value),
    createDeferred: () => ({ kind: "call", path: "core::cell::OnceCell::new", args: [] }),
    initialize: (owner, value) => initializeRustFrameBindingValue(binding, owner, value),
    initializeOrWrite: (owner, value) => initializeOrWriteRustFrameBindingValue(binding, owner, value, context),
    location: owner => rustFrameBindingLocalLocation(binding, owner, context),
  };
  const storage = rustCapturedFieldStorage(declaration, context);
  // A plain construction local needs `mut` only when the source writes the field again while the object is
  // unpublished, or mutates the field's content in place while it is still the local (an access through `this`
  // before publication). Content mutated after publication goes through the published object, not the local.
  const dispatch = context.input.program.records.projectFieldDispatch.get(declaration);
  const mutable = storage === undefined && (plan.unpublishedMutations.has(declaration) || dispatch === undefined ||
    dispatch.mutableContent && plan.unpublishedAccesses.has(declaration));
  return {
    deferred: storage?.initialization === "deferred", mutable, retainedFieldOwner: storage !== undefined,
    create: value => createRustCapturedField(storage, value),
    createDeferred: () => storage?.initialization === "deferred" ? createRustDeferredFieldOwner() : undefined,
    initialize: (owner, value) => initializeRustCapturedField(storage, owner, value),
    initializeOrWrite: (owner, value) => storage === undefined ? undefined : initializeOrWriteRustCapturedField(storage, owner, value, context),
    location: owner => storage === undefined ? undefined : rustCapturedFieldLocation(storage, owner, carrier, context),
  };
}
