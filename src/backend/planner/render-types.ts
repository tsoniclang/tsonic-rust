import type { TargetTypeRef } from "@tsonic/tsts";
import type { RustType } from "../rust-ast/nodes.js";
import { rustPrimitiveTypeName, rustStringTargetId } from "../../source/rust-target-types.js";

export function rustTypeFromCarrier(carrier: TargetTypeRef | undefined): RustType | undefined {
  if (carrier === undefined) {
    return undefined;
  }
  if (carrier.kind === "source-primitive") {
    const name = rustPrimitiveTypeName(carrier.name);
    return name === undefined ? undefined : { kind: "primitive", name };
  }
  if (carrier.kind === "target-named" && carrier.id === rustStringTargetId) {
    return { kind: "string" };
  }
  if (carrier.kind === "tuple" && carrier.elements.length === 0) {
    return { kind: "unit" };
  }
  return undefined;
}

export function isFloatCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "source-primitive" && (carrier.name === "float32" || carrier.name === "float64");
}
