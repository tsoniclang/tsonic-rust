import type { TargetTypeRef } from "../../policy/types.js";
import type { RustAssignmentOperator } from "../../common/rust-syntax.js";
import { isRustCopyCarrier } from "../../source/rust-target-types.js";
import type { RustExpr, RustType } from "../rust-ast/nodes.js";

export const rustProjectObjectStateField = "state";
export const rustProjectObjectIdentityField = "identity";
export const rustProjectObjectDispatchField = "dispatch";

const rustProjectObjectStateBinding = "state";

export function rustProjectObjectType(stateType: RustType): RustType {
  return {
    kind: "named",
    path: "rt::ObjectHandle",
    typeArguments: [stateType],
  };
}

export function createRustProjectObject(
  typePath: string,
  statePath: string,
  fields: readonly { readonly name: string; readonly value: RustExpr }[],
): RustExpr {
  return {
    kind: "struct-literal",
    path: typePath,
    fields: [{
      name: rustProjectObjectStateField,
      value: {
        kind: "call",
        path: "rt::ObjectHandle::new",
        args: [{ kind: "struct-literal", path: statePath, fields }],
      },
    }],
  };
}

export function createRustStructuralObject(
  statePath: string,
  fields: readonly { readonly name: string; readonly value: RustExpr }[],
): RustExpr {
  return {
    kind: "call",
    path: "rt::ObjectHandle::new",
    args: [{ kind: "struct-literal", path: statePath, fields }],
  };
}

export function readRustProjectObjectField(
  receiver: RustExpr,
  storagePath: string | readonly string[],
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

export function readRustStructuralObjectField(
  receiver: RustExpr,
  storagePath: string | readonly string[],
  resultCarrier: TargetTypeRef,
): RustExpr {
  const field = rustStructuralObjectStatePath(storagePath);
  return {
    kind: "method-call",
    receiver,
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
  storagePath: string | readonly string[],
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

export function readRustProjectMethodOverride(
  receiver: RustExpr,
  storagePath: string | readonly string[],
): RustExpr {
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
      body: {
        kind: "method-call",
        receiver: rustProjectObjectStatePath(storagePath),
        method: "clone",
        args: [],
      },
    }],
  };
}

export function writeRustProjectMethodOverride(
  receiver: RustExpr,
  storagePath: string | readonly string[],
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
        operator: "=",
        target: rustProjectObjectStatePath(storagePath),
        value: { kind: "call", path: "Some", args: [value] },
      },
    }],
  };
}

export function readRustProjectObjectIndex(
  receiver: RustExpr,
  storageName: string,
  key: RustExpr,
  resultCarrier: TargetTypeRef,
): RustExpr {
  const value: RustExpr = {
    kind: "index",
    receiver: rustProjectObjectStatePath(storageName),
    index: { kind: "reference", expr: key },
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
        ? value
        : { kind: "method-call", receiver: value, method: "clone", args: [] },
    }],
  };
}

export function readRustProjectObjectIndexStorage(
  receiver: RustExpr,
  storageName: string,
): RustExpr {
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
      body: {
        kind: "method-call",
        receiver: rustProjectObjectStatePath(storageName),
        method: "clone",
        args: [],
      },
    }],
  };
}

export function writeRustProjectObjectIndex(
  receiver: RustExpr,
  storageName: string,
  key: RustExpr,
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
      kind: "closure-block",
      params: [{ name: rustProjectObjectStateBinding, mutable: false }],
      move: false,
      async: false,
      body: {
        statements: [{
          kind: "let",
          name: "_",
          mutable: false,
          init: {
            kind: "method-call",
            receiver: rustProjectObjectStatePath(storageName),
            method: "insert",
            args: [key, value],
          },
        }],
      },
    }],
  };
}

export function mutateRustProjectObjectIndex(
  receiver: RustExpr,
  storageName: string,
  key: RustExpr,
  mutation: (value: RustExpr) => RustExpr | undefined,
): RustExpr | undefined {
  const location: RustExpr = {
    kind: "dereference",
    pointer: {
      kind: "method-call",
      receiver: {
        kind: "method-call",
        receiver: rustProjectObjectStatePath(storageName),
        method: "get_mut",
        args: [{ kind: "reference", expr: key }],
      },
      method: "expect",
      args: [{ kind: "str-literal", value: "selected index key must exist" }],
    },
  };
  const body = mutation(location);
  return body === undefined
    ? undefined
    : {
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
          body,
        }],
      };
}

export function writeRustStructuralObjectField(
  receiver: RustExpr,
  storagePath: string | readonly string[],
  operator: RustAssignmentOperator,
  value: RustExpr,
): RustExpr {
  return {
    kind: "method-call",
    receiver,
    method: "with_mut",
    args: [{
      kind: "closure",
      params: [{ name: rustProjectObjectStateBinding, byRefCopy: false }],
      body: {
        kind: "assignment",
        operator,
        target: rustStructuralObjectStatePath(storagePath),
        value,
      },
    }],
  };
}

export function mutateRustProjectObjectField(
  receiver: RustExpr,
  storagePath: string | readonly string[],
  mutation: (field: RustExpr) => RustExpr | undefined,
): RustExpr | undefined {
  const body = mutation(rustProjectObjectStatePath(storagePath));
  if (body === undefined) {
    return undefined;
  }
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
      body,
    }],
  };
}

export function mutateRustStructuralObjectField(
  receiver: RustExpr,
  storagePath: string | readonly string[],
  mutation: (field: RustExpr) => RustExpr | undefined,
): RustExpr | undefined {
  const body = mutation(rustStructuralObjectStatePath(storagePath));
  return body === undefined
    ? undefined
    : {
        kind: "method-call",
        receiver,
        method: "with_mut",
        args: [{
          kind: "closure",
          params: [{ name: rustProjectObjectStateBinding, byRefCopy: false }],
          body,
        }],
      };
}

function rustProjectObjectStatePath(
  storagePath: string | readonly string[],
): RustExpr {
  const path = typeof storagePath === "string" ? [storagePath] : storagePath;
  return path.reduce<RustExpr>(
    (receiver, name) => ({ kind: "field", receiver, name }),
    { kind: "path", path: rustProjectObjectStateBinding },
  );
}

function rustStructuralObjectStatePath(
  storagePath: string | readonly string[],
): RustExpr {
  const path = typeof storagePath === "string" ? [storagePath] : storagePath;
  return path.reduce<RustExpr>(
    (receiver, name) => ({ kind: "field", receiver, name }),
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
      kind: "field",
      receiver,
      name: rustProjectObjectDispatchField,
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
        kind: "field",
        receiver: selectedReceiver,
        name: rustProjectObjectDispatchField,
      },
      method: writeSlot,
      args: [selectedValue],
    },
  };
}
