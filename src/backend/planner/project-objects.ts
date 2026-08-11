import type { TargetTypeRef } from "../../policy/types.js";
import type { RustAssignmentOperator } from "../../common/rust-syntax.js";
import { isRustCopyCarrier } from "../../source/rust-target-types.js";
import type { RustExpr, RustType } from "../rust-ast/nodes.js";

export const rustProjectObjectStateField = "__tsonic_state";
export const rustProjectObjectIdentityField = "__tsonic_identity";
export const rustProjectObjectDispatchField = "__tsonic_dispatch";

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
  storagePath: number | readonly number[],
  resultCarrier: TargetTypeRef,
): RustExpr {
  const field = rustProjectObjectStatePath(storagePath);
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
  storagePath: number | readonly number[],
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
        target: rustProjectObjectStatePath(storagePath),
        value,
      },
    }],
  };
}

function rustProjectObjectStatePath(
  storagePath: number | readonly number[],
): RustExpr {
  const path = typeof storagePath === "number" ? [storagePath] : storagePath;
  return path.reduce<RustExpr>(
    (receiver, index) => ({ kind: "field", receiver, name: String(index) }),
    { kind: "path", path: rustProjectObjectStateBinding },
  );
}

export function readRustProjectDispatchedField(
  receiver: RustExpr,
  readSlot: string,
): RustExpr {
  return {
    kind: "method-call",
    receiver: {
      kind: "method-call",
      receiver: {
        kind: "field",
        receiver,
        name: rustProjectObjectDispatchField,
      },
      method: "clone",
      args: [],
    },
    method: readSlot,
    args: [],
  };
}

export function writeRustProjectDispatchedField(
  receiver: RustExpr,
  receiverBinding: string,
  readSlot: string,
  writeSlot: string,
  operator: RustAssignmentOperator,
  value: RustExpr,
): RustExpr {
  const selectedReceiver: RustExpr = { kind: "path", path: receiverBinding };
  const selectedValue = operator === "="
    ? value
    : {
        kind: "binary" as const,
        operator: operator.slice(0, -1) as "+" | "-" | "*" | "/" | "%",
        left: readRustProjectDispatchedField(selectedReceiver, readSlot),
        right: value,
      };
  return {
    kind: "block",
    bindings: [{ name: receiverBinding, value: receiver }],
    value: {
      kind: "method-call",
      receiver: {
        kind: "method-call",
        receiver: {
          kind: "field",
          receiver: selectedReceiver,
          name: rustProjectObjectDispatchField,
        },
        method: "clone",
        args: [],
      },
      method: writeSlot,
      args: [selectedValue],
    },
  };
}
