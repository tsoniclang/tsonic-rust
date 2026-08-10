import type { TargetTypeRef } from "../../policy/types.js";
import { registerAliasFromPath } from "./plan-context.js";
import type { RustType } from "../rust-ast/nodes.js";
import { rustSourceTypeCarrierValue } from "../../source/rust-facts/keys.js";
import {
  rustJsArrayTargetId,
  rustJsDateTargetId,
  rustJsMapTargetId,
  rustJsSetTargetId,
  rustJsValueTargetId,
  rustFixedArrayCarrierValue,
  rustOptionTargetId,
  rustNamedTypeCarrierValue,
  rustPrimitiveTypeName,
  rustStringTargetId,
  rustIsizeTargetId,
  rustUsizeTargetId,
} from "../../source/rust-target-types.js";

const namedCarrierPaths: Readonly<Record<string, string>> = {
  [rustOptionTargetId]: "Option",
  [rustJsValueTargetId]: "js_abi::JsValue",
  [rustJsArrayTargetId]: "js_abi::JsArray",
  [rustJsMapTargetId]: "js_abi::JsMap",
  [rustJsSetTargetId]: "js_abi::JsSet",
  [rustJsDateTargetId]: "js_abi::JsDate",
  "rust.js.JsRegExp": "js_abi::JsRegExp",
  "rust.js.JsRegExpMatch": "js_abi::JsRegExpMatch",
};

export const rustStrRefType: RustType = { kind: "str-ref" };

export function rustTypeFromCarrier(
  carrier: TargetTypeRef | undefined,
  resolveSourceTypePath?: (value: { readonly fileName: string; readonly typeName: string }) => string | undefined,
): RustType | undefined {
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
  if (carrier.kind === "target-named" && carrier.id === rustUsizeTargetId) {
    return { kind: "primitive", name: "usize" };
  }
  if (carrier.kind === "target-named" && carrier.id === rustIsizeTargetId) {
    return { kind: "primitive", name: "isize" };
  }
  if (carrier.kind === "target-named") {
    const path = namedCarrierPaths[carrier.id];
    if (path === undefined) {
      return undefined;
    }
    const typeArguments = (carrier.typeArguments ?? []).map((argument) => rustTypeFromCarrier(argument, resolveSourceTypePath));
    if (typeArguments.some((argument) => argument === undefined)) {
      return undefined;
    }
    return {
      kind: "named",
      path,
      ...(typeArguments.length === 0 ? {} : { typeArguments: typeArguments as RustType[] }),
    };
  }
  if (carrier.kind === "type-parameter") {
    return { kind: "named", path: carrier.name };
  }
  if (carrier.kind === "pointer" && carrier.pointee.kind === "target-named" && carrier.pointee.id === rustStringTargetId && carrier.mutability === "const") {
    return rustStrRefType;
  }
  if (carrier.kind === "pointer" && carrier.pointee.kind === "array") {
    const element = rustTypeFromCarrier(carrier.pointee.element, resolveSourceTypePath);
    return element === undefined ? undefined : { kind: "slice-ref", element, mutable: carrier.mutability === "mut" };
  }
  const fixedArray = rustFixedArrayCarrierValue(carrier);
  if (fixedArray !== undefined) {
    const element = rustTypeFromCarrier(fixedArray.element, resolveSourceTypePath);
    return element === undefined ? undefined : { kind: "fixed-array", element, length: fixedArray.length };
  }
  const namedType = rustNamedTypeCarrierValue(carrier);
  if (namedType !== undefined) {
    const typeArguments = namedType.typeArguments.map((argument) =>
      rustTypeFromCarrier(argument, resolveSourceTypePath));
    return typeArguments.some((argument) => argument === undefined)
      ? undefined
      : {
          kind: "named",
          path: namedType.path,
          ...(typeArguments.length === 0 ? {} : { typeArguments: typeArguments as RustType[] }),
        };
  }
  if (carrier.kind === "array") {
    const element = rustTypeFromCarrier(carrier.element, resolveSourceTypePath);
    return element === undefined ? undefined : { kind: "named", path: "Vec", typeArguments: [element] };
  }
  if (carrier.kind === "tuple") {
    if (carrier.elements.length === 0) {
      return { kind: "unit" };
    }
    const elements = carrier.elements.map((element) => rustTypeFromCarrier(element, resolveSourceTypePath));
    if (elements.some((element) => element === undefined)) {
      return undefined;
    }
    return { kind: "tuple", elements: elements as RustType[] };
  }
  if (resolveSourceTypePath !== undefined) {
    const value = rustSourceTypeCarrierValue(carrier);
    if (value !== undefined) {
      const path = resolveSourceTypePath(value);
      return path === undefined ? undefined : { kind: "named", path };
    }
  }
  return undefined;
}

export function isFloatCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "source-primitive" && (carrier.name === "float32" || carrier.name === "float64");
}

export function rustTypeFromCarrierInContext(
  carrier: TargetTypeRef | undefined,
  context: {
    readonly moduleName: string;
    readonly moduleNameByFileName: ReadonlyMap<string, string>;
    readonly usedAliases?: Set<string>;
  },
): RustType | undefined {
  const rendered = rustTypeFromCarrier(carrier, (value) => {
    const moduleName = context.moduleNameByFileName.get(value.fileName);
    if (moduleName === undefined) {
      return undefined;
    }
    return moduleName === context.moduleName ? value.typeName : `crate::${moduleName}::${value.typeName}`;
  });
  collectAliasesFromRustType(rendered, (path) => {
    registerAliasFromPath(context, path);
  });
  return rendered;
}

export function collectAliasesFromRustType(
  type: RustType | undefined,
  register: (path: string) => void,
): void {
  if (type === undefined) {
    return;
  }
  if (type.kind === "named") {
    register(type.path);
    for (const argument of type.typeArguments ?? []) {
      collectAliasesFromRustType(argument, register);
    }
    return;
  }
  if (type.kind === "slice-ref") {
    collectAliasesFromRustType(type.element, register);
    return;
  }
  if (type.kind === "fixed-array") {
    collectAliasesFromRustType(type.element, register);
    return;
  }
  if (type.kind === "tuple") {
    for (const element of type.elements) {
      collectAliasesFromRustType(element, register);
    }
  }
}
