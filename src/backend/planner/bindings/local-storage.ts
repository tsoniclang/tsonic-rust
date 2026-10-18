import type { Node } from "@tsonic/tsts";
import { Node_Initializer } from "@tsonic/target-api/source";
import type { RustBindingStorageFact } from "../../../target-model/records/operation-selections.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustExpr, RustStmt, RustType } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { diagnosticInput } from "../program/plan-context.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { createRustNativeBindingValue, requireRustNativeBindingStorage, rustNativeBindingSlotType }
  from "../expressions/binding-storage.js";
import { planRustValueFieldInput } from "../objects/value-fields.js";

export function planRustLocalBindingStorage(
  declaration: Node, name: string, carrier: TargetTypeRef,
  value: RustExpr | undefined, storage: RustBindingStorageFact | undefined, context: RustPlanContext,
): { readonly kind: "binding"; readonly type: RustType | undefined; readonly value: RustExpr | undefined }
  | { readonly kind: "store"; readonly statement: RustStmt } | undefined {
  const prepared = context.bindingLocations?.get(declaration);
  if (prepared !== undefined) {
    if (value === undefined) return undefined;
    const initializer = Node_Initializer(context.input.program.source.ast, declaration);
    const input = initializer === undefined ? undefined : planRustValueFieldInput(prepared, initializer, context, () => value);
    const initialization = input === undefined ? undefined : prepared.initialize?.(input, context);
    return initialization === undefined ? undefined : { kind: "store", statement: { kind: "expr", expr: initialization } };
  }
  const native = requireRustNativeBindingStorage(declaration, context);
  if (storage === undefined) return { kind: "binding", type: rustNativeBindingSlotType(native, context), value };
  if (!rustTargetTypeRefEquals(carrier, storage.valueCarrier) || value === undefined) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, declaration),
      "rust.backend.binding-storage-carrier", "Native binding storage requires its exact carrier and initializer."));
    return undefined;
  }
  if (storage.storage === "location" && storage.initialization === "deferred") return { kind: "store", statement: {
    kind: "expr", expr: { kind: "method-call", receiver: { kind: "path", path: name }, method: "store", args: [value] },
  } };
  const nativeValue = createRustNativeBindingValue(native, value, context, false);
  return nativeValue === undefined ? undefined
    : { kind: "binding", type: rustNativeBindingSlotType(native, context), value: nativeValue };
}
