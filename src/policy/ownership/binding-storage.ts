import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustNamedTargetType } from "../../target-model/types/carriers/native.js";
import type { RustNativeBindingStorage } from "../../target-model/records/physical-emission-contexts.js";

export type RustNativeBindingStorageInput = {
  readonly payloadCarrier: TargetTypeRef;
} & (
  | { readonly kind: "binding"; readonly storage: "value" | "cell" | "borrow-cell" | "location";
      readonly initialization: "ready" | "deferred" }
  | { readonly kind: "frame"; readonly storage: "value" | "cell" | "borrow-cell" | "location";
      readonly initialization: "ready" | "deferred"; readonly ownerCarrier: TargetTypeRef;
      readonly ownerConstructor: string | null }
  | { readonly kind: "captured-field"; readonly storage: "shared" | "cell" | "borrow-cell";
      readonly initialization: "ready" | "deferred" }
  | { readonly kind: "captured-field"; readonly storage: "copy"; readonly initialization: "ready" }
  | { readonly kind: "module"; readonly initialization: "ready" | "deferred" }
);

export function selectRustNativeBindingStorage(input: RustNativeBindingStorageInput): RustNativeBindingStorage {
  const payloadCarrier = input.payloadCarrier;
  const kind = input.kind === "module" ? "module-cell"
    : input.storage === "copy" || input.storage === "shared" ? "value" : input.storage;
  const shared = input.kind === "captured-field" && input.storage !== "copy";
  const valueCarrier = kind === "cell" ? named("rust.core.cell.Cell", "core::cell::Cell", [payloadCarrier])
    : kind === "borrow-cell" ? named("rust.core.cell.RefCell", "core::cell::RefCell", [payloadCarrier])
    : kind === "location" ? named("rust.runtime.Location", "rt::Location", [payloadCarrier,
      named("rust.core.convert.Infallible", "core::convert::Infallible", [])])
    : kind === "module-cell" ? named("rust.runtime.ModuleCell", "rt::ModuleCell", [payloadCarrier]) : payloadCarrier;
  const deferred = input.initialization === "deferred" && input.kind !== "module" &&
    (input.kind === "frame" || kind !== "location");
  const slotCarrier = deferred ? named("rust.core.cell.OnceCell", "core::cell::OnceCell", [valueCarrier]) : valueCarrier;
  const holderCarrier = input.kind === "frame" ? input.ownerCarrier
    : shared ? named("rust.alloc.rc.Rc", "alloc::rc::Rc", [slotCarrier]) : slotCarrier;
  const requirements: RustNativeBindingStorage["requirements"] = Object.freeze(kind === "location" || kind === "module-cell"
    ? ["clone", "static"] : kind === "cell" ? ["copy"] : []);
  return Object.freeze({
    kind, initialization: input.initialization, payloadCarrier, valueCarrier, slotCarrier, holderCarrier,
    valueConstructor: kind === "cell" ? "core::cell::Cell::new" : kind === "borrow-cell" ? "core::cell::RefCell::new"
      : kind === "location" ? "rt::Location::allocate" : kind === "module-cell" ? "rt::ModuleCell::initialized" : null,
    slotConstructor: deferred ? "core::cell::OnceCell::from" : null,
    deferredConstructor: deferred ? "core::cell::OnceCell::new"
      : input.initialization === "deferred" && kind === "location" ? "rt::Location::uninitialized"
      : input.initialization === "deferred" && kind === "module-cell" ? "rt::ModuleCell::new" : null,
    ownerConstructor: input.kind === "frame" ? input.ownerConstructor : shared ? "alloc::rc::Rc::new" : null, requirements,
  });
}

function named(id: string, path: string, arguments_: readonly TargetTypeRef[]): TargetTypeRef {
  return Object.freeze(rustNamedTargetType(id, path,
    Object.freeze(arguments_.map(type => Object.freeze({ kind: "type" as const, type }))),
    [], undefined, [], undefined, []));
}
