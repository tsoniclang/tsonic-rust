import type { TargetTypeRef } from "@tsonic/tsts";
import type { RustType } from "../rust-ast/nodes.js";
import {
  rustJsArrayTargetId,
  rustJsDateTargetId,
  rustJsMapTargetId,
  rustJsSetTargetId,
  rustJsValueTargetId,
  rustOptionTargetId,
  rustPrimitiveTypeName,
  rustStringTargetId,
} from "../../source/rust-target-types.js";

const namedCarrierPaths: Readonly<Record<string, string>> = {
  [rustOptionTargetId]: "Option",
  [rustJsValueTargetId]: "js_abi::JsValue",
  [rustJsArrayTargetId]: "js_abi::JsArray",
  [rustJsMapTargetId]: "js_abi::JsMap",
  [rustJsSetTargetId]: "js_abi::JsSet",
  [rustJsDateTargetId]: "js_abi::JsDate",
};

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
  if (carrier.kind === "target-named") {
    const path = namedCarrierPaths[carrier.id];
    if (path === undefined) {
      return undefined;
    }
    const typeArguments = (carrier.typeArguments ?? []).map(rustTypeFromCarrier);
    if (typeArguments.some((argument) => argument === undefined)) {
      return undefined;
    }
    return {
      kind: "named",
      path,
      ...(typeArguments.length === 0 ? {} : { typeArguments: typeArguments as RustType[] }),
    };
  }
  if (carrier.kind === "pointer" && carrier.pointee.kind === "array") {
    const element = rustTypeFromCarrier(carrier.pointee.element);
    return element === undefined ? undefined : { kind: "slice-ref", element, mutable: carrier.mutability === "mut" };
  }
  if (carrier.kind === "array") {
    const element = rustTypeFromCarrier(carrier.element);
    return element === undefined ? undefined : { kind: "named", path: "Vec", typeArguments: [element] };
  }
  if (carrier.kind === "tuple" && carrier.elements.length === 0) {
    return { kind: "unit" };
  }
  return undefined;
}

export function isFloatCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "source-primitive" && (carrier.name === "float32" || carrier.name === "float64");
}
