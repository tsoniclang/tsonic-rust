import type { RustStructuralEmissionPolicyInput } from "../../model/structural-emission.js";
import type { RustConstructorShapeEmission, RustStructuralFieldEmission, RustStructuralShapeEmission } from "../../../target-model/records/structural-emission.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustCallableProtocol, rustLocationTargetType, rustOptionTargetType, rustProgramErrorTargetType, rustUnitTargetType, rustStructuralObjectCarrierValue, rustStructuralPropertyValueCarrier } from "../../../target-model/types/index.js";
import { rustStructuralPropertyGetterStorageCarrier, rustStructuralPropertySetterStorageCarrier } from "./member-storage.js";
import { rustRuntimeNativeMethodTargetType, rustRuntimeRecordFieldTargetType } from "../../../target-model/types/carriers/runtime-carriers.js";
import { rustPascalCaseIdentifier } from "../../../target-model/names/identifiers.js";
import type { RustStructuralMethodPayload } from "../../../target-model/records/structural-shapes.js";
import { rustNamedTargetType } from "../../../target-model/types/carriers/native.js";
import { rustTypeGenericArguments } from "../../../target-model/types/generic-arguments.js";

export function selectRustStructuralMethodContextCarrier(
  payload: RustStructuralMethodPayload, receiverFieldIdentities: readonly boolean[],
): TargetTypeRef {
  const named = (path: string, carrier: TargetTypeRef): TargetTypeRef => rustNamedTargetType(path, path, rustTypeGenericArguments([carrier]));
  return Object.freeze({ kind: "tuple", elements: Object.freeze([
    ...payload.captures.map(capture => capture.storage === "value" ? capture.storageCarrier
      : capture.storage === "location" ? rustLocationTargetType(capture.storageCarrier)
        : named(capture.storage === "cell" ? "core::cell::Cell" : "core::cell::RefCell", capture.storageCarrier)),
    ...payload.receiverFields.map((capture, index) => {
      const storage = capture.storage;
      let carrier = capture.storageCarrier;
      if (storage !== undefined && storage.kind !== "copy") {
        if (storage.kind !== "shared") carrier = named(storage.kind === "cell" ? "core::cell::Cell" : "core::cell::RefCell", carrier);
        if (storage.initialization === "deferred") carrier = named("core::cell::OnceCell", carrier);
        carrier = named("alloc::rc::Rc", carrier);
      }
      return !receiverFieldIdentities[index] ? carrier : Object.freeze({ kind: "tuple" as const,
        elements: Object.freeze([rustNamedTargetType("rust.runtime.ObjectIdentity", "rt::ObjectIdentity"), carrier]) });
    }),
    ...payload.receivers.map(capture => capture.storageCarrier),
  ]) });
}

export function selectRustStructuralMethodExposure(input: {
  readonly writes: "none" | "present" | "unresolved";
  readonly boundary: "none" | "export-only" | "opaque";
  readonly extracted: boolean;
  readonly implementations: number;
  readonly presence: "required" | "optional";
}): "fixed" | "stored" {
  return input.presence === "required" && input.writes === "none" && input.boundary !== "opaque" && !input.extracted && input.implementations === 1
    ? "fixed" : "stored";
}

export type RustStructuralEmissionSelection = { readonly kind: "selected"; readonly value: RustStructuralShapeEmission } |
  { readonly kind: "unsupported"; readonly code: string; readonly message: string; readonly capability: string };

export function selectRustStructuralEmission(input: RustStructuralEmissionPolicyInput): RustStructuralEmissionSelection {
  const { definition } = input;
  const reject = (code: string, message: string, capability: string): RustStructuralEmissionSelection => ({ kind: "unsupported", code, message, capability });
  if (definition.dispatchName !== undefined) {
    const members: RustConstructorShapeEmission["members"][number][] = [];
    const callable = (name: string, carrier: TargetTypeRef, construction: boolean): boolean => {
      const protocol = rustCallableProtocol(carrier);
      if (protocol === undefined) return false;
      members.push(Object.freeze({ name, parameters: protocol.parameters, result: protocol.result,
        selfMode: construction || definition.construction === undefined ? "rc" : "ref", field: undefined }));
      return true;
    };
    let valid = definition.construction === undefined || callable(definition.construction.targetName, definition.construction.carrier, true);
    for (const [index, field] of definition.fields.entries()) {
      if (field.method) valid = callable(field.targetName, field.carrier, false) && valid;
      else if (field.property === undefined) valid = false;
      else {
        members.push(Object.freeze({ name: field.property.getterTargetName, parameters: Object.freeze([]), result: field.carrier,
          selfMode: field.property.selfMode, field: Object.freeze({ index, role: "getter" as const }) }));
        if (field.property.setterTargetName !== undefined) members.push(Object.freeze({ name: field.property.setterTargetName,
          parameters: Object.freeze([field.carrier]), result: rustUnitTargetType(), selfMode: field.property.selfMode,
          field: Object.freeze({ index, role: "setter" as const }) }));
      }
    }
    const bases = rustStructuralObjectCarrierValue(definition.carrier)?.bases;
    if (!valid || bases === undefined) return reject("RUST_STRUCTURAL_CONSTRUCTOR_TYPE_MISSING",
      "A constructor interface requires exact native dispatch signatures and property storage.", "rust.class-value.constructor");
    const lifetimes = definition.genericParameters.flatMap(parameter => parameter.kind === "lifetime" ? [parameter.lifetime] : []);
    return { kind: "selected", value: Object.freeze({ dispatch: Object.freeze({ members: Object.freeze(members), lifetime: lifetimes.length === 1 ? lifetimes[0] : undefined }),
      bases, fields: Object.freeze([]), derives: Object.freeze([]) }) };
  }
  const fields: RustStructuralFieldEmission[] = [];
  for (const field of definition.fields) {
    if (field.methodPlan?.kind === "fixed") {
      if (field.methodPlan.payload === undefined) return reject("RUST_STRUCTURAL_METHOD_ENVIRONMENT_MISSING",
        `Structural shape '${definition.targetName}' has a fixed method without its completed native capture environment.`, "rust.backend.structural-shapes.methods");
      continue;
    }
    const storage = field.method === true ? field.methodPlan?.carrier : field.nativeLayout === undefined ? field.carrier : rustLocationTargetType(field.carrier);
    if (storage === undefined) return reject("RUST_STRUCTURAL_SHAPE_METHOD_TYPE_MISSING",
      `Structural shape '${definition.targetName}' has a method without one exact runtime-callable storage carrier.`, "rust.backend.structural-shapes.methods");
    const protocol = field.methodPlan?.kind === "native-dispatch" ? rustCallableProtocol(field.carrier) : undefined;
    const callable = field.methodPlan?.kind === "native-dispatch" ? protocol === undefined ? undefined
      : rustRuntimeNativeMethodTargetType(protocol.parameters, protocol.result, rustProgramErrorTargetType()) : storage;
    const directMethod = field.method === true && field.methodPlan?.kind !== "native-dispatch";
    const carrier = callable === undefined ? undefined : field.storage === "bound" && !directMethod
      ? rustRuntimeRecordFieldTargetType(callable, rustProgramErrorTargetType()) : callable;
    if (carrier === undefined) return reject("RUST_STRUCTURAL_SHAPE_FIELD_TYPE_MISSING",
      `Structural shape '${definition.targetName}' has a field without an exact renderable Rust carrier.`, "rust.backend.structural-shapes");
    if (field.storage === "stored" || field.storage === "bound") {
      fields.push(Object.freeze({ field, carrier, methodAlias: directMethod ? `${definition.targetName}${rustPascalCaseIdentifier(field.sourceName)}Method` : undefined, property: undefined }));
      continue;
    }
    if (field.method === true && field.methodPlan?.receiver !== "independent" || field.property === undefined) return reject("RUST_STRUCTURAL_SHAPE_PROPERTY_STORAGE_INVALID",
      `Structural shape '${definition.targetName}' has contradictory property storage metadata.`, "rust.backend.structural-shapes.properties");
    const value = rustStructuralPropertyValueCarrier(field.carrier, field.presence);
    const getter = rustStructuralPropertyGetterStorageCarrier(definition.carrier, field.carrier, field.presence);
    const setter = field.readonly ? undefined : rustStructuralPropertySetterStorageCarrier(definition.carrier, field.carrier, field.presence);
    if (value === undefined || getter === undefined || !field.readonly && setter === undefined) return reject("RUST_STRUCTURAL_SHAPE_PROPERTY_TYPE_MISSING",
      `Structural shape '${definition.targetName}' has property dispatch without exact renderable value and callable carriers.`, "rust.backend.structural-shapes.properties");
    if (field.property.setterTargetName !== undefined && setter === undefined) return reject("RUST_STRUCTURAL_SHAPE_PROPERTY_TYPE_MISSING",
      `Structural shape '${definition.targetName}' has writable property dispatch without one exact setter carrier.`, "rust.backend.structural-shapes.properties");
    fields.push(Object.freeze({ field, carrier, methodAlias: undefined, property: Object.freeze({ stored: rustOptionTargetType(value), getter, setter,
      getterAlias: `${definition.targetName}${rustPascalCaseIdentifier(field.sourceName)}Getter`, setterAlias: `${definition.targetName}${rustPascalCaseIdentifier(field.sourceName)}Setter` }) }));
  }
  const derives: ("Clone" | "Copy" | "Default")[] = [];
  if (input.clone) derives.push("Clone");
  if (input.copy) derives.push("Copy");
  if (input.default) derives.push("Default");
  return { kind: "selected", value: Object.freeze({ dispatch: undefined, bases: Object.freeze([]), fields: Object.freeze(fields), derives: Object.freeze(derives) }) };
}
