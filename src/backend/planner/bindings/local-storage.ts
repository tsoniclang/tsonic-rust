import type { Node } from "@tsonic/tsts";
import { Node_Initializer } from "@tsonic/target-api/source";
import type { RustBindingStorageFact } from "../../../analysis/facts/operations/keys.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustExpr, RustStmt, RustType } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { diagnosticInput } from "../program/plan-context.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustLocationTargetType } from "../../../target-model/types/index.js";
import { rustNativeBackingKey } from "../../../target-model/operations/native-memory.js";
import { rustInlineBindingStoragePath, rustInlineBindingStorageType } from "../expressions/binding-storage.js";
import { planRustNativeAllocation } from "../expressions/native-memory.js";
import { requireRustLocationValueCarrier } from "../types/generic-requirements.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";

export function planRustLocalBindingStorage(
  declaration: Node, name: string, carrier: TargetTypeRef, type: RustType | undefined,
  value: RustExpr | undefined, storage: RustBindingStorageFact | undefined, context: RustPlanContext,
): { readonly kind: "binding"; readonly type: RustType | undefined; readonly value: RustExpr | undefined }
  | { readonly kind: "store"; readonly statement: RustStmt } | undefined {
  const prepared = context.bindingLocations?.get(declaration);
  if (prepared !== undefined) {
    if (value === undefined) return undefined;
    const initializer = Node_Initializer(context.input.program.source.ast, declaration);
    const input = prepared.writeInput === undefined ? value : initializer === undefined ? undefined
      : prepared.writeInput(initializer, value, context);
    const initialization = input === undefined ? undefined : prepared.initialize?.(input, context);
    return initialization === undefined ? undefined : { kind: "store", statement: { kind: "expr", expr: initialization } };
  }
  if (storage === undefined) return { kind: "binding", type, value };
  if (!rustTargetTypeRefEquals(carrier, storage.valueCarrier) || value === undefined) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, declaration),
      "rust.backend.binding-storage-carrier", "Native binding storage requires its exact carrier and initializer."));
    return undefined;
  }
  if (storage.storage !== "location") {
    if (type === undefined || storage.initialization !== undefined) return undefined;
    return { kind: "binding", type: rustInlineBindingStorageType(storage.storage, type),
      value: { kind: "call", path: `${rustInlineBindingStoragePath(storage.storage)}::new`, args: [value] } };
  }
  if (!requireRustLocationValueCarrier(storage.valueCarrier, declaration, context)) return undefined;
  context.usedAliases?.add("rt");
  if (storage.initialization === "deferred") return { kind: "store", statement: {
    kind: "expr", expr: { kind: "method-call", receiver: { kind: "path", path: name }, method: "store", args: [value] },
  } };
  const nativeType = rustTypeFromCarrierInContext(rustLocationTargetType(storage.valueCarrier), context);
  const nativeValue = context.input.program.facts.getFact(declaration, rustNativeBackingKey) === undefined
    ? { kind: "call" as const, path: "rt::Location::allocate", args: [value] }
    : planRustNativeAllocation(declaration, value, context);
  return nativeType === undefined || nativeValue === undefined ? undefined
    : { kind: "binding", type: nativeType, value: nativeValue };
}
