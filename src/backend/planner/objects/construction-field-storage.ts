import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustProjectConstructionPlan } from "../../../analysis/project-types/construction-plan.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustValueFieldLocation } from "./value-fields.js";
import { createRustFrameBindingValue, initializeOrWriteRustFrameBindingValue, initializeRustFrameBindingValue, rustFrameBindingLocalLocation } from "../bindings/frame-storage.js";
import { createRustCapturedField, createRustDeferredFieldOwner, initializeRustCapturedField,
  initializeOrWriteRustCapturedField, rustCapturedFieldLocation, rustCapturedFieldStorage } from "./captured-fields.js";
import { requireRustNativeBindingStorage } from "../expressions/binding-storage.js";

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
  declaration: Node, carrier: TargetTypeRef, context: RustPlanContext, plan: RustProjectConstructionPlan,
): RustConstructionFieldStorage {
  const binding = context.input.program.callableValues.frames.bindingFor(declaration);
  const native = requireRustNativeBindingStorage(declaration, context);
  if (binding !== undefined) return {
    deferred: binding.initialization === "deferred", mutable: binding.storage === "value" &&
      plan.mutatesUnpublishedField(declaration), retainedFieldOwner: false,
    create: value => createRustFrameBindingValue(binding, value, context),
    createDeferred: () => native.deferredConstructor === null ? undefined
      : { kind: "call", path: native.deferredConstructor, args: [] },
    initialize: (owner, value) => initializeRustFrameBindingValue(binding, owner, value, context),
    initializeOrWrite: (owner, value) => initializeOrWriteRustFrameBindingValue(binding, owner, value, context),
    location: owner => rustFrameBindingLocalLocation(binding, owner, context),
  };
  const storage = rustCapturedFieldStorage(declaration, context);
  return {
    deferred: storage?.initialization === "deferred", mutable: storage === undefined, retainedFieldOwner: storage !== undefined,
    create: value => createRustCapturedField(native, value, context),
    createDeferred: () => storage?.initialization === "deferred" ? createRustDeferredFieldOwner(native) : undefined,
    initialize: (owner, value) => initializeRustCapturedField(native, owner, value, context),
    initializeOrWrite: (owner, value) => storage === undefined ? undefined : initializeOrWriteRustCapturedField(native, owner, value, context),
    location: owner => storage === undefined ? undefined : rustCapturedFieldLocation(storage, owner, carrier),
  };
}
