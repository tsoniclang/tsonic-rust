import type { AstReader } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustTypedLocationOperands } from "../../../target-model/records/storage/typed-location-operands.js";
import { rustSourceLocationTargetType, rustOptionTargetType, rustSourcePrimitiveTargetType, rustUnitTargetType } from "../../../target-model/types/index.js";
import { rustLocationCallbackCarrier } from "../../types/callables/location-callbacks.js";

export function selectRustTypedLocationCallSignature(
  operation: RustTypedLocationOperands, pointee: TargetTypeRef, ast: AstReader, identity?: TargetTypeRef,
): { readonly parameters: readonly TargetTypeRef[]; readonly result: TargetTypeRef; readonly generics: readonly TargetTypeRef[] } | undefined {
  const location = rustSourceLocationTargetType(pointee);
  const optional = rustOptionTargetType(location);
  const unit = rustUnitTargetType();
  let parameters: readonly TargetTypeRef[] = operation.operation === "address-of" || operation.operation === "allocate" ? [pointee]
    : operation.operation === "load" ? [location] : operation.operation === "store" ? [location, pointee]
      : operation.operation === "hash-pointer" ? [optional] : [optional, optional];
  if (operation.operation === "bind-pointer") {
    if (identity === undefined) return undefined;
    parameters = [identity, rustLocationCallbackCarrier(operation.readExpression, [], pointee, ast),
      rustLocationCallbackCarrier(operation.writeExpression, [pointee], unit, ast)];
  } else if (operation.operation === "project-pointer" || operation.operation === "view-pointer") {
    const source = rustSourceLocationTargetType(operation.sourcePointeeCarrier);
    const read = operation.operation === "project-pointer" ? operation.fromSourceExpression : operation.readExpression;
    const write = operation.operation === "project-pointer" ? operation.toSourceExpression : operation.writeExpression;
    parameters = [operation.optional ? rustOptionTargetType(source) : source,
      rustLocationCallbackCarrier(read, operation.operation === "project-pointer" ? [operation.sourcePointeeCarrier] : [], pointee, ast),
      rustLocationCallbackCarrier(write, [pointee], operation.operation === "project-pointer" ? operation.sourcePointeeCarrier : unit, ast)];
  }
  const result = operation.operation === "load" ? pointee : operation.operation === "store" ? unit
    : operation.operation === "equal-pointer" ? rustSourcePrimitiveTargetType("bool")
      : operation.operation === "hash-pointer" ? rustSourcePrimitiveTargetType("float64")
        : (operation.operation === "project-pointer" || operation.operation === "view-pointer") && operation.optional ? optional : location;
  const generics = operation.operation === "project-pointer" || operation.operation === "view-pointer" ? [operation.sourcePointeeCarrier, pointee] : [pointee];
  return Object.freeze({ parameters: Object.freeze(parameters), result, generics: Object.freeze(generics) });
}
