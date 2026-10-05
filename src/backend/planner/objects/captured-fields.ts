import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustCapturedFieldStorage } from "../../../target-model/types/field-storage.js";
import { isRustCopyCarrier } from "../../../target-model/types/index.js";
import { rustCapturedFieldStorageFactKey, validatedRustCapturedFieldStorageFact } from "../../../analysis/facts/receiver-captures.js";
import type { RustExpr, RustType } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustInlineBindingStorageType, rustBindingStorageOperations } from "../expressions/binding-storage.js";
import type { RustValueFieldLocation } from "./value-fields.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { diagnosticInput } from "../program/plan-context.js";

export function rustCapturedFieldStorage(declaration: Node, context: RustPlanContext): RustCapturedFieldStorage | undefined {
  const fact = context.input.program.facts.getFact(declaration, rustCapturedFieldStorageFactKey);
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

export function rustCapturedFieldType(storage: RustCapturedFieldStorage | undefined, type: RustType): RustType {
  if (storage === undefined || storage.kind === "copy") return type;
  const payload = storage.kind === "shared" ? type : rustInlineBindingStorageType(storage.kind, type);
  const owner = storage.initialization === "ready" ? payload : { kind: "named" as const, path: "core::cell::OnceCell",
    genericArguments: [{ kind: "type" as const, type: payload }] };
  return { kind: "named", path: "alloc::rc::Rc", genericArguments: [{ kind: "type", type: owner }] };
}

export function createRustCapturedField(storage: RustCapturedFieldStorage | undefined, value: RustExpr): RustExpr {
  if (storage === undefined || storage.kind === "copy") return value;
  const payload = createRustCapturedFieldPayload(storage, value);
  return { kind: "call", path: "alloc::rc::Rc::new", args: [storage.initialization === "ready" ? payload
    : { kind: "call", path: "core::cell::OnceCell::from", args: [payload] }] };
}

export function createRustDeferredFieldOwner(): RustExpr {
  return { kind: "call", path: "alloc::rc::Rc::new", args: [{ kind: "call", path: "core::cell::OnceCell::new", args: [] }] };
}

export function initializeRustCapturedField(storage: RustCapturedFieldStorage | undefined, owner: RustExpr, value: RustExpr): RustExpr {
  if (storage?.initialization !== "deferred") return { kind: "assignment", operator: "=", target: owner,
    value: createRustCapturedField(storage, value) };
  return { kind: "macro-invocation", path: "assert", delimiter: "parentheses", args: [{
    kind: "method-call", receiver: { kind: "method-call", receiver: owner, method: "set",
      args: [createRustCapturedFieldPayload(storage, value)] }, method: "is_ok", args: [],
  }, { kind: "str-literal", value: "captured field initialized twice" }] };
}

export function initializeOrWriteRustCapturedField(storage: RustCapturedFieldStorage, owner: RustExpr, value: RustExpr): RustExpr | undefined {
  if (storage.initialization !== "deferred" || storage.kind === "shared" || storage.kind === "copy") return undefined;
  const updated = rustBindingStorageOperations(storage.kind).write({ kind: "path", path: "initialized" }, { kind: "path", path: "value" });
  return { kind: "block", body: { statements: [
    { kind: "let", name: "value", mutable: false, init: value },
    { kind: "expr", expr: { kind: "match", expression: { kind: "method-call", receiver: owner, method: "get", args: [] }, arms: [
      { pattern: { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name: "initialized" }] }, expression: updated },
      { pattern: { kind: "path", path: "None" }, expression: initializeRustCapturedField(storage, owner, { kind: "path", path: "value" }) },
    ] } },
  ] } };
}

function createRustCapturedFieldPayload(storage: RustCapturedFieldStorage, value: RustExpr): RustExpr {
  return storage.kind === "shared" || storage.kind === "copy" ? value : { kind: "associated-call", owner: { kind: "named",
    path: storage.kind === "cell" ? "core::cell::Cell" : "core::cell::RefCell" }, method: "new", args: [value] };
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
  const borrowed: RustExpr = storage.kind === "borrow-cell" ? { kind: "method-call", receiver: payload, method: "borrow", args: [] }
    : storage.kind === "cell" ? { kind: "method-call", receiver: payload, method: "get", args: [] } : payload;
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
