import type { TargetTypeRef } from "../../policy/types.js";
import type { RustAssignmentOperator } from "../../common/rust-syntax.js";
import { isRustCopyCarrier } from "../../source/rust-target-types.js";
import type { RustExpr, RustType } from "../rust-ast/nodes.js";

export const rustProjectObjectStateField = "__tsonic_state";

const rustProjectObjectStateBinding = "state";

export function rustProjectObjectType(fieldTypes: readonly RustType[]): RustType {
  return {
    kind: "named",
    path: "rt::ObjectHandle",
    typeArguments: [{ kind: "tuple", elements: fieldTypes }],
  };
}

export function createRustProjectObject(
  typePath: string,
  values: readonly RustExpr[],
): RustExpr {
  return {
    kind: "struct-literal",
    path: typePath,
    fields: [{
      name: rustProjectObjectStateField,
      value: {
        kind: "call",
        path: "rt::ObjectHandle::new",
        args: [{ kind: "tuple-literal", elements: values }],
      },
    }],
  };
}

export function readRustProjectObjectField(
  receiver: RustExpr,
  storageIndex: number,
  resultCarrier: TargetTypeRef,
): RustExpr {
  const field: RustExpr = {
    kind: "field",
    receiver: { kind: "path", path: rustProjectObjectStateBinding },
    name: String(storageIndex),
  };
  return {
    kind: "method-call",
    receiver: {
      kind: "field",
      receiver,
      name: rustProjectObjectStateField,
    },
    method: "with",
    args: [{
      kind: "closure",
      params: [{ name: rustProjectObjectStateBinding, byRefCopy: false }],
      body: isRustCopyCarrier(resultCarrier)
        ? field
        : { kind: "method-call", receiver: field, method: "clone", args: [] },
    }],
  };
}

export function writeRustProjectObjectField(
  receiver: RustExpr,
  storageIndex: number,
  operator: RustAssignmentOperator,
  value: RustExpr,
): RustExpr {
  return {
    kind: "method-call",
    receiver: {
      kind: "field",
      receiver,
      name: rustProjectObjectStateField,
    },
    method: "with_mut",
    args: [{
      kind: "closure",
      params: [{ name: rustProjectObjectStateBinding, byRefCopy: false }],
      body: {
        kind: "assignment",
        operator,
        target: {
          kind: "field",
          receiver: { kind: "path", path: rustProjectObjectStateBinding },
          name: String(storageIndex),
        },
        value,
      },
    }],
  };
}
