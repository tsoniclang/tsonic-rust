import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustCapturedFieldStorage } from "../../../target-model/types/field-storage.js";
import type { RustNativeBindingStorage } from "../../../target-model/records/physical-emission-contexts.js";
import { isRustCopyCarrier } from "../../../target-model/types/index.js";

import { validatedRustCapturedFieldStorageFact } from "../../../analysis/storage/receiver-captures.js";
import type { RustExpr, RustType } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustBindingStorageOperations, createRustNativeBindingPayload, createRustNativeBindingValue }
  from "../expressions/binding-storage.js";
import type { RustValueFieldLocation } from "./value-fields.js";
import { missingFactDiagnostic, failRustPlannerInvariant } from "../diagnostics.js";
import { rustTypeFromSelectedNativeCarrierInContext } from "../types/render.js";
import { diagnosticInput } from "../program/plan-context.js";
import { initializeOrWriteRustDeferredStorage, initializeRustDeferredStorage } from "../bindings/deferred-storage.js";

export function rustCapturedFieldStorage(declaration: Node, context: RustPlanContext): RustCapturedFieldStorage | undefined {
  const fact = context.input.program.records.capturedFieldStorage.get(declaration);
  const captures = context.input.program.objectRepresentations.receiverCaptures;
  const demanded = captures.isCaptured(declaration);
  if (!demanded && fact === undefined) return undefined;
  const validated = validatedRustCapturedFieldStorageFact(declaration, context.input.program);
  if (validated === undefined) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, declaration),
      "rust.backend.captured-field-storage", "A live field owner requires its exact canonical declaration-carrier storage fact."));
    return undefined;
  }
  return validated.storage;
}

export function rustCapturedFieldType(storage: RustNativeBindingStorage, context: RustPlanContext): RustType {
  return rustTypeFromSelectedNativeCarrierInContext(storage.holderCarrier, context);
}

export function createRustCapturedField(storage: RustNativeBindingStorage, value: RustExpr, context: RustPlanContext): RustExpr {
  return createRustNativeBindingValue(storage, value, context, true)
    ?? failRustPlannerInvariant("A completed native captured field requires its original renderable construction.");
}

export function createRustDeferredFieldOwner(storage: RustNativeBindingStorage): RustExpr {
  if (storage.ownerConstructor === null || storage.deferredConstructor === null)
    return failRustPlannerInvariant("A completed deferred captured field requires its exact owner and slot constructors.");
  return { kind: "call", path: storage.ownerConstructor,
    args: [{ kind: "call", path: storage.deferredConstructor, args: [] }] };
}

export function initializeRustCapturedField(storage: RustNativeBindingStorage, owner: RustExpr, value: RustExpr,
  context: RustPlanContext): RustExpr {
  if (storage.initialization !== "deferred") return { kind: "assignment", operator: "=", target: owner,
    value: createRustCapturedField(storage, value, context) };
  return initializeRustDeferredStorage(owner, createRustCapturedFieldPayload(storage, value, context), "captured field initialized twice");
}

export function initializeOrWriteRustCapturedField(storage: RustNativeBindingStorage, owner: RustExpr, value: RustExpr,
  context: RustPlanContext): RustExpr | undefined {
  if (storage.initialization !== "deferred" || storage.kind !== "cell" && storage.kind !== "borrow-cell") return undefined;
  return initializeOrWriteRustDeferredStorage(owner, value, context,
    selected => createRustCapturedFieldPayload(storage, selected, context), rustBindingStorageOperations(storage.kind).write,
    "captured field initialized twice", false);
}

function createRustCapturedFieldPayload(storage: RustNativeBindingStorage, value: RustExpr, context: RustPlanContext): RustExpr {
  return createRustNativeBindingPayload(storage, value, context)
    ?? failRustPlannerInvariant("A completed native captured field requires its original payload constructor.");
}

function rustCapturedFieldPayload(storage: RustCapturedFieldStorage, owner: RustExpr): RustExpr {
  return storage.initialization === "ready" ? owner : { kind: "method-call", receiver: {
    kind: "method-call", receiver: owner, method: "get", args: [],
  }, method: "expect", args: [{ kind: "str-literal", value: "captured field is not initialized" }] };
}

export function readRustCapturedField(storage: RustCapturedFieldStorage, owner: RustExpr, carrier: TargetTypeRef): RustExpr {
  if (storage.kind === "copy") return owner;
  const payload = rustCapturedFieldPayload(storage, owner);
  if (storage.kind !== "shared") return rustBindingStorageOperations(storage.kind, isRustCopyCarrier(carrier)).read(payload);
  const reference: RustExpr = storage.initialization === "deferred" ? payload
    : { kind: "method-call", receiver: payload, method: "as_ref", args: [] };
  return isRustCopyCarrier(carrier) ? { kind: "dereference", pointer: reference }
    : { kind: "method-call", receiver: reference,
      method: "clone", args: [] };
}

export function rustCapturedFieldLocation(
  storage: RustCapturedFieldStorage, owner: RustExpr, carrier: TargetTypeRef,
  projection: readonly string[] = [], resultCarrier: TargetTypeRef = carrier,
): RustValueFieldLocation & { readonly withRead: NonNullable<RustValueFieldLocation["withRead"]> } {
  const payload = rustCapturedFieldPayload(storage, owner);
  const project = (root: RustExpr): RustExpr => projection.reduce<RustExpr>((receiver, name) => ({ kind: "field", receiver, name }), root);
  const borrowed: RustExpr = storage.kind === "borrow-cell" || storage.kind === "cell"
    ? rustBindingStorageOperations(storage.kind).borrowedRead(payload) : payload;
  const selected = project(borrowed);
  return { bindings: [], read: projection.length === 0 ? readRustCapturedField(storage, owner, carrier)
      : isRustCopyCarrier(resultCarrier) ? selected : { kind: "method-call", receiver: selected, method: "clone", args: [] },
    write: value => writeRustCapturedField(storage, owner, value, projection),
    project: (names, selectedCarrier) => rustCapturedFieldLocation(storage, owner, carrier, [...projection, ...names], selectedCarrier),
    withRead: apply => apply(project(borrowed)),
  };
}

export function writeRustCapturedField(
  storage: RustCapturedFieldStorage, owner: RustExpr, value: RustExpr, projection: readonly string[] = [],
): RustExpr | undefined {
  if (storage.kind === "shared" || storage.kind === "copy") return undefined;
  const payload = rustCapturedFieldPayload(storage, owner);
  if (projection.length === 0) return rustBindingStorageOperations(storage.kind).write(payload, value);
  if (storage.kind === "borrow-cell") return { kind: "block", body: { statements: [
    { kind: "let", name: "selected", mutable: false, init: { kind: "tuple-literal", elements: [
      { kind: "reference", expr: payload }, value,
    ] } },
    { kind: "let", name: "_", mutable: false, init: { kind: "block", body: { statements: [
      { kind: "let", name: "borrowed", mutable: true,
        init: { kind: "method-call", receiver: { kind: "field", receiver: { kind: "path", path: "selected" }, name: "0" }, method: "borrow_mut", args: [] } },
      { kind: "tail", expr: { kind: "call", path: "core::mem::replace", args: [
        { kind: "reference", mutable: true, expr: projection.reduce<RustExpr>((receiver, name) =>
          ({ kind: "field", receiver, name }), { kind: "path", path: "borrowed" }) },
        { kind: "field", receiver: { kind: "path", path: "selected" }, name: "1" },
      ] } },
    ] } } },
  ] } };
  const target: RustExpr = { kind: "path", path: "captured_value" };
  return { kind: "block", body: { statements: [
    { kind: "let", name: "selected", mutable: false, init: { kind: "tuple-literal", elements: [
      { kind: "reference", expr: payload }, value,
    ] } },
    { kind: "let", name: "captured_value", mutable: true,
      init: { kind: "method-call", receiver: { kind: "field", receiver: { kind: "path", path: "selected" }, name: "0" }, method: "get", args: [] } },
    { kind: "assign", target: projection.reduce<RustExpr>((receiver, name) => ({ kind: "field", receiver, name }), target), operator: "=",
      value: { kind: "field", receiver: { kind: "path", path: "selected" }, name: "1" } },
    { kind: "expr", expr: { kind: "method-call", receiver: { kind: "field", receiver: { kind: "path", path: "selected" }, name: "0" }, method: "set",
      args: [{ kind: "path", path: "captured_value" }] } },
  ] } };
}

export function writeRustCapturedFieldFromStorage(
  storage: RustCapturedFieldStorage,
  withOwner: (project: (owner: RustExpr) => RustExpr | undefined) => RustExpr | undefined,
  value: RustExpr,
  releaseBorrow: boolean,
  projection: readonly string[] = [],
): RustExpr | undefined {
  if (storage.kind === "shared" || storage.kind === "copy") return undefined;
  if (storage.kind === "borrow-cell" && releaseBorrow) {
    const owner = withOwner(selected => ({ kind: "method-call", receiver: selected, method: "clone", args: [] }));
    return owner === undefined ? undefined : writeRustCapturedField(storage, owner, value, projection);
  }
  return withOwner(owner => writeRustCapturedField(storage, owner, value, projection));
}
