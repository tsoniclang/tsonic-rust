import type { TargetTypeRef } from "../../../policy/types/model.js";
import type { RustAssignmentOperator } from "../../model/syntax.js";
import { isRustCopyCarrier } from "../../../policy/types/target-types.js";
import type { RustErrorDomain, RustExpr, RustType } from "../../rust-ast/nodes.js";
import type { RustObjectRepresentation } from "../../../analysis/project-types/object-representation.js";

export const rustProjectObjectStateField = "state";
export const rustProjectObjectIdentityField = "identity";
export const rustProjectObjectDispatchField = "dispatch";

const rustProjectObjectStateBinding = "state";

export function rustProjectObjectType(
  stateType: RustType,
  representation: RustObjectRepresentation,
): RustType | undefined {
  const path = rustSharedObjectCarrierPath(representation);
  if (path === undefined) {
    return undefined;
  }
  return {
    kind: "named",
    path,
    typeArguments: [stateType],
  };
}

export function createRustProjectObject(
  typePath: string,
  statePath: string,
  fields: readonly { readonly name: string; readonly value: RustExpr }[],
  representation: RustObjectRepresentation,
): RustExpr {
  if (representation.kind === "value") {
    return { kind: "struct-literal", path: typePath, fields };
  }
  const carrierPath = rustSharedObjectCarrierPath(representation);
  if (carrierPath === undefined) {
    throw new Error("Polymorphic project objects require their dedicated construction planner.");
  }
  return {
    kind: "struct-literal",
    path: typePath,
    fields: [{
      name: rustProjectObjectStateField,
      value: {
        kind: "call",
        path: `${carrierPath}::new`,
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
  representation: RustObjectRepresentation,
): RustExpr {
  if (representation.kind === "value") {
    return rustProjectObjectValueRead(
      rustProjectObjectDirectPath(receiver, storagePath),
      resultCarrier,
    );
  }
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
  representation: RustObjectRepresentation,
): RustExpr | undefined {
  if (representation.kind === "value") {
    return {
      kind: "assignment",
      operator,
      target: rustProjectObjectDirectPath(receiver, storagePath),
      value,
    };
  }
  if (representation.kind === "shared-immutable") {
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
  representation: RustObjectRepresentation,
): RustExpr {
  if (representation.kind === "value") {
    return {
      kind: "method-call",
      receiver: rustProjectObjectDirectPath(receiver, storagePath),
      method: "clone",
      args: [],
    };
  }
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
  representation: RustObjectRepresentation,
): RustExpr | undefined {
  if (representation.kind === "value") {
    return {
      kind: "assignment",
      operator: "=",
      target: rustProjectObjectDirectPath(receiver, storagePath),
      value: { kind: "call", path: "Some", args: [value] },
    };
  }
  if (representation.kind === "shared-immutable") {
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
  representation: RustObjectRepresentation,
): RustExpr {
  if (representation.kind === "value") {
    return rustProjectObjectValueRead({
      kind: "index",
      receiver: rustProjectObjectDirectPath(receiver, storageName),
      index: { kind: "reference", expr: key },
    }, resultCarrier);
  }
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
  representation: RustObjectRepresentation,
): RustExpr {
  if (representation.kind === "value") {
    return {
      kind: "method-call",
      receiver: rustProjectObjectDirectPath(receiver, storageName),
      method: "clone",
      args: [],
    };
  }
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
  representation: RustObjectRepresentation,
): RustExpr | undefined {
  if (representation.kind === "value") {
    return {
      kind: "method-call",
      receiver: rustProjectObjectDirectPath(receiver, storageName),
      method: "insert",
      args: [key, value],
    };
  }
  if (representation.kind === "shared-immutable") {
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
  representation: RustObjectRepresentation,
): RustExpr | undefined {
  if (representation.kind === "shared-immutable") {
    return undefined;
  }
  const storage = representation.kind === "value"
    ? rustProjectObjectDirectPath(receiver, storageName)
    : rustProjectObjectStatePath(storageName);
  const location: RustExpr = {
    kind: "dereference",
    pointer: {
      kind: "method-call",
      receiver: {
        kind: "method-call",
        receiver: storage,
        method: "get_mut",
        args: [{ kind: "reference", expr: key }],
      },
      method: "expect",
      args: [{ kind: "str-literal", value: "selected index key must exist" }],
    },
  };
  const body = mutation(location);
  if (body === undefined || representation.kind === "value") {
    return body;
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
  representation: RustObjectRepresentation,
): RustExpr | undefined {
  if (representation.kind === "shared-immutable") {
    return undefined;
  }
  const body = mutation(representation.kind === "value"
    ? rustProjectObjectDirectPath(receiver, storagePath)
    : rustProjectObjectStatePath(storagePath));
  if (body === undefined || representation.kind === "value") {
    return body;
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

function rustProjectObjectDirectPath(
  receiver: RustExpr,
  storagePath: string | readonly string[],
): RustExpr {
  const path = typeof storagePath === "string" ? [storagePath] : storagePath;
  return path.reduce<RustExpr>(
    (current, name) => ({ kind: "field", receiver: current, name }),
    receiver,
  );
}

function rustProjectObjectValueRead(
  field: RustExpr,
  resultCarrier: TargetTypeRef,
): RustExpr {
  return isRustCopyCarrier(resultCarrier)
    ? field
    : { kind: "method-call", receiver: field, method: "clone", args: [] };
}

function rustSharedObjectCarrierPath(
  representation: RustObjectRepresentation,
): "rt::ObjectHandle" | "rt::ObjectRef" | undefined {
  switch (representation.kind) {
    case "shared-immutable":
      return "rt::ObjectRef";
    case "shared-mutable":
    case "closed-hierarchy":
    case "open-hierarchy":
      return "rt::ObjectHandle";
    case "value":
      return undefined;
  }
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
  role: {
    readonly selfMode: "ref" | "rc";
    readonly fallible: boolean;
    readonly errorDomain: RustErrorDomain;
  } = { selfMode: "ref", fallible: false, errorDomain: "runtime" },
): RustExpr {
  const dispatch: RustExpr = {
    kind: "field",
    receiver,
    name: rustProjectObjectDispatchField,
  };
  const call: RustExpr = {
    kind: "method-call",
    receiver: role.selfMode === "rc"
      ? { kind: "method-call", receiver: dispatch, method: "clone", args: [] }
      : dispatch,
    method: readSlot,
    args: [],
  };
  return role.fallible
    ? { kind: "try", expr: call, errorDomain: role.errorDomain }
    : call;
}

export function writeRustProjectDispatchedField(
  receiver: RustExpr,
  receiverBinding: string,
  readSlot: string,
  writeSlot: string,
  operator: RustAssignmentOperator,
  value: RustExpr,
  roles: {
    readonly read: {
      readonly selfMode: "ref" | "rc";
      readonly fallible: boolean;
    };
    readonly write: {
      readonly selfMode: "ref" | "rc";
      readonly fallible: boolean;
    };
    readonly errorDomain: RustErrorDomain;
  } = {
    read: { selfMode: "ref", fallible: false },
    write: { selfMode: "ref", fallible: false },
    errorDomain: "runtime",
  },
): RustExpr {
  const selectedReceiver: RustExpr = { kind: "path", path: receiverBinding };
  const selectedValue = operator === "="
    ? value
    : {
        kind: "binary" as const,
        operator: operator.slice(0, -1) as "+" | "-" | "*" | "/" | "%",
        left: readRustProjectDispatchedField(selectedReceiver, readSlot, {
          ...roles.read,
          errorDomain: roles.errorDomain,
        }),
        right: value,
      };
  const dispatch: RustExpr = {
    kind: "field",
    receiver: selectedReceiver,
    name: rustProjectObjectDispatchField,
  };
  const writeCall: RustExpr = {
    kind: "method-call",
    receiver: roles.write.selfMode === "rc"
      ? { kind: "method-call", receiver: dispatch, method: "clone", args: [] }
      : dispatch,
    method: writeSlot,
    args: [selectedValue],
  };
  return {
    kind: "block",
    bindings: [{ name: receiverBinding, value: receiver }],
    value: roles.write.fallible
      ? { kind: "try", expr: writeCall, errorDomain: roles.errorDomain }
      : writeCall,
  };
}
