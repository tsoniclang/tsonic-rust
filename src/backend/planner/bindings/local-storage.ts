import type { Node } from "@tsonic/tsts";
import { Node_Initializer } from "@tsonic/target-api/source";
import type { RustBindingStorageFact } from "../../../target-model/records/operations/operation-selections.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustExpr, RustStmt, RustType } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustLocationTargetType } from "../../../target-model/types/index.js";

import { rustInlineBindingStoragePath, rustInlineBindingStorageType } from "../expressions/binding-storage.js";
import { planRustNativeAllocation } from "../expressions/native-memory.js";
import { requireRustLocationValueCarrier } from "../types/generic-requirements.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { planRustValueFieldInput } from "../objects/value-fields.js";

export function planRustLocalBindingStorage(
  declaration: Node, name: string, carrier: TargetTypeRef, type: RustType | undefined,
  value: RustExpr | undefined, storage: RustBindingStorageFact | undefined, context: RustPlanContext,
): { readonly kind: "binding"; readonly type: RustType | undefined; readonly value: RustExpr | undefined }
  | { readonly kind: "store"; readonly statement: RustStmt } | undefined {
  const prepared = context.bindingLocations?.get(declaration);
  if (prepared !== undefined) {
    if (value === undefined) failRustPlannerInvariant("An admitted prepared binding requires its native initializer.", declaration);
    const initializer = Node_Initializer(context.input.program.source.ast, declaration);
    const input = initializer === undefined ? undefined : planRustValueFieldInput(prepared, initializer, context, () => value);
    const initialization = input === undefined ? undefined : prepared.initialize?.(input, context);
    if (initialization === undefined) failRustPlannerInvariant("An admitted prepared binding requires its native storage initialization.", declaration);
    return { kind: "store", statement: { kind: "expr", expr: initialization } };
  }
  if (storage === undefined) return { kind: "binding", type, value };
  if (!rustTargetTypeRefEquals(carrier, storage.valueCarrier) || value === undefined) {
    failRustPlannerInvariant("Native binding storage requires its exact carrier and initializer.", declaration);
  }
  if (storage.storage !== "location") {
    if (type === undefined || storage.initialization !== undefined) failRustPlannerInvariant("An admitted inline binding requires its native storage type and initialization contract.", declaration);
    return { kind: "binding", type: rustInlineBindingStorageType(storage.storage, type),
      value: { kind: "call", path: `${rustInlineBindingStoragePath(storage.storage)}::new`, args: [value] } };
  }
  if (!requireRustLocationValueCarrier(storage.valueCarrier, declaration, context)) failRustPlannerInvariant("An admitted binding requires its native location value carrier.", declaration);
  context.usedAliases?.add("rt");
  if (storage.initialization === "deferred") return { kind: "store", statement: {
    kind: "expr", expr: { kind: "method-call", receiver: { kind: "path", path: name }, method: "store", args: [value] },
  } };
  const nativeType = rustTypeFromCarrierInContext(rustLocationTargetType(storage.valueCarrier), context);
  const nativeValue = context.input.program.records.nativeBacking.get(declaration) === undefined
    ? { kind: "call" as const, path: "rt::Location::allocate", args: [value] }
    : planRustNativeAllocation(declaration, value, context);
  if (nativeType === undefined || nativeValue === undefined) failRustPlannerInvariant("An admitted native binding requires its rendered location type and initialization.", declaration);
  return { kind: "binding", type: nativeType, value: nativeValue };
}
