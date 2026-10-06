import { rustValueBlock } from "../../target-ast/value-block.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustAssignmentOperator } from "../../../target-model/syntax/tokens.js";
import { isRustCopyCarrier } from "../../../target-model/types/index.js";
import type { RustExpr, RustType } from "../../target-ast/nodes.js";
import type { RustObjectRepresentation } from "../../../analysis/project-types/object-representation.js";
import type { RustPlannedProjectFieldDispatchRole } from "./project-field-dispatch.js";
import type { RustCapturedFieldStorage } from "../../../target-model/types/field-storage.js";
import { rustCapturedFieldLocation, writeRustCapturedFieldFromStorage } from "./captured-fields.js";

export const rustProjectObjectStateField = "state";
export const rustProjectObjectIdentityField = "identity";
export const rustProjectObjectDispatchField = "dispatch";

const rustProjectObjectStateBinding = "state";

export function enterRustProjectObjectMutableState(
  receiver: RustExpr,
  stateName: string,
  body: RustExpr,
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
      params: [{ name: stateName, byRefCopy: false }],
      body,
    }],
  };
}

export function rustProjectObjectType(
  stateType: RustType,
  representation: RustObjectRepresentation,
  contextType?: RustType,
): RustType | undefined {
  const path = rustSharedObjectCarrierPath(representation);
  if (path === undefined) {
    return undefined;
  }
  return {
    kind: "named",
    path,
    genericArguments: [{ kind: "type", type: stateType },
      ...(contextType === undefined ? [] : [{ kind: "type" as const, type: contextType }])],
  };
}

export function rustProjectObjectSharedStateType(
  stateType: RustType,
  representation: RustObjectRepresentation,
  contextType?: RustType,
): RustType | undefined {
  const paths = rustProjectObjectOwnerPaths(representation);
  return paths === undefined ? undefined : { kind: "named", path: paths.state,
    genericArguments: [{ kind: "type", type: stateType },
      ...(contextType === undefined ? [] : [{ kind: "type" as const, type: contextType }])] };
}

export function createRustProjectObject(
  typePath: string,
  statePath: string,
  fields: readonly { readonly name: string; readonly value: RustExpr }[],
  representation: RustObjectRepresentation,
  contextValue?: RustExpr,
  identity?: RustExpr,
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
        path: `${carrierPath}::${identity !== undefined ? "with_context_and_identity" : contextValue === undefined ? "new" : "with_context"}`,
        args: [{ kind: "struct-literal", path: statePath, fields },
          ...(identity !== undefined ? [contextValue ?? { kind: "tuple-literal" as const, elements: [] }, identity]
            : contextValue === undefined ? [] : [contextValue])],
      },
    }],
  };
}

export function createRustStructuralObject(
  statePath: string,
  fields: readonly { readonly name: string; readonly value: RustExpr }[],
  identity?: RustExpr,
): RustExpr {
  return {
    kind: "call",
    path: identity === undefined ? "rt::ObjectHandle::new" : "rt::ObjectHandle::with_identity",
    args: [{ kind: "struct-literal", path: statePath, fields }, ...(identity === undefined ? [] : [identity])],
  };
}

export function readRustProjectObjectField(
  receiver: RustExpr,
  storagePath: string | readonly string[],
  resultCarrier: TargetTypeRef,
  representation: RustObjectRepresentation,
  captureStorage?: RustCapturedFieldStorage,
  projection: readonly string[] = [],
): RustExpr {
  return withRustProjectStoredField(receiver, storagePath, representation, field => captureStorage !== undefined
    ? rustCapturedFieldLocation(captureStorage, field, resultCarrier, projection, resultCarrier).read
    : isRustCopyCarrier(resultCarrier) ? field : { kind: "method-call", receiver: field, method: "clone", args: [] });
}

export function readRustProjectObjectFieldOwner(
  receiver: RustExpr, storagePath: string | readonly string[], representation: RustObjectRepresentation,
  captureStorage: RustCapturedFieldStorage, borrowed = false,
): RustExpr {
  if (borrowed && representation.kind === "value") return { kind: "reference", expr: rustProjectObjectDirectPath(receiver, storagePath) };
  return withRustProjectStoredField(receiver, storagePath, representation,
    field => captureStorage.kind === "copy" ? field : ({ kind: "method-call", receiver: field, method: "clone", args: [] }));
}

export function withRustProjectStoredField(
  receiver: RustExpr,
  storagePath: string | readonly string[],
  representation: RustObjectRepresentation,
  project: (field: RustExpr) => RustExpr,
): RustExpr;
export function withRustProjectStoredField(
  receiver: RustExpr,
  storagePath: string | readonly string[],
  representation: RustObjectRepresentation,
  project: (field: RustExpr) => RustExpr | undefined,
): RustExpr | undefined;
export function withRustProjectStoredField(
  receiver: RustExpr, storagePath: string | readonly string[], representation: RustObjectRepresentation,
  project: (field: RustExpr) => RustExpr | undefined,
): RustExpr | undefined {
  if (representation.kind === "value") {
    const field = rustProjectObjectDirectPath(receiver, storagePath);
    return project(field);
  }
  const field = rustProjectObjectStatePath(storagePath);
  const selected = project(field);
  if (selected === undefined) return undefined;
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
      body: selected,
    }],
  };
}

export function readRustStructuralObjectField(
  receiver: RustExpr,
  storagePath: string | readonly string[],
  resultCarrier: TargetTypeRef,
  copy = isRustCopyCarrier(resultCarrier),
): RustExpr {
  const field = rustStructuralObjectStatePath(storagePath);
  return {
    kind: "method-call",
    receiver,
    method: "with",
    args: [{
      kind: "closure",
      params: [{ name: rustProjectObjectStateBinding, byRefCopy: false }],
      body: copy
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
  captureStorage?: RustCapturedFieldStorage,
  projection: readonly string[] = [],
): RustExpr | undefined {
  if (captureStorage !== undefined) {
    if (operator !== "=") return undefined;
    if (captureStorage.kind === "shared") return undefined;
    return writeRustCapturedFieldFromStorage(captureStorage,
      project => withRustProjectStoredField(receiver, storagePath, representation, project), value,
      representation.kind !== "value" && representation.kind !== "shared-immutable", projection);
  }
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

export function readRustProjectPrivateField(
  receiver: RustExpr,
  storagePath: readonly string[],
  accessor: string,
  representation: RustObjectRepresentation,
): RustExpr | undefined {
  if (storagePath.length === 0) {
    return undefined;
  }
  const ownerPath = storagePath.slice(0, -1);
  const read = (owner: RustExpr): RustExpr => ({
    kind: "method-call",
    receiver: owner,
    method: accessor,
    args: [],
  });
  if (representation.kind === "value") {
    return read(rustProjectObjectDirectPath(receiver, ownerPath));
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
      body: read(rustProjectObjectStatePath(ownerPath)),
    }],
  };
}

export function writeRustProjectPrivateField(
  receiver: RustExpr,
  storagePath: readonly string[],
  accessor: string,
  value: RustExpr,
  representation: RustObjectRepresentation,
): RustExpr | undefined {
  if (storagePath.length === 0 || representation.kind === "shared-immutable") {
    return undefined;
  }
  const ownerPath = storagePath.slice(0, -1);
  const write = (owner: RustExpr): RustExpr => ({
    kind: "method-call",
    receiver: owner,
    method: accessor,
    args: [value],
  });
  if (representation.kind === "value") {
    return write(rustProjectObjectDirectPath(receiver, ownerPath));
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
      body: write(rustProjectObjectStatePath(ownerPath)),
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
      index: key,
    }, resultCarrier);
  }
  const value: RustExpr = {
    kind: "index",
    receiver: rustProjectObjectStatePath(storageName),
    index: key,
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

export function copyRustProjectObjectIndexStorage(
  receiver: RustExpr,
  storageName: string,
  destination: RustExpr,
  representation: RustObjectRepresentation,
): RustExpr {
  const copy = (source: RustExpr): RustExpr => ({
    kind: "call",
    path: "rt::record::extend_entries",
    args: [{ kind: "reference", mutable: true, expr: destination }, { kind: "reference", expr: source }],
  });
  if (representation.kind === "value") {
    return copy(rustProjectObjectDirectPath(receiver, storageName));
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
      body: copy(rustProjectObjectStatePath(storageName)),
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
      receiverMode: "mut-ref",
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
            receiverMode: "mut-ref",
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
  return rustProjectObjectOwnerPaths(representation)?.owner;
}

function rustProjectObjectOwnerPaths(
  representation: RustObjectRepresentation,
): { readonly owner: "rt::ObjectHandle" | "rt::ObjectRef";
  readonly state: "rt::ObjectHandleState" | "rt::ObjectRefState" } | undefined {
  switch (representation.kind) {
    case "shared-immutable":
      return { owner: "rt::ObjectRef", state: "rt::ObjectRefState" };
    case "shared-mutable":
    case "closed-hierarchy":
    case "open-hierarchy":
      return { owner: "rt::ObjectHandle", state: "rt::ObjectHandleState" };
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
  role: RustPlannedProjectFieldDispatchRole = { selfMode: "ref", fallible: false },
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
    ? {
        kind: "try",
        expr: call,
        resultErrorType: role.resultErrorType,
        operandErrorType: role.operandErrorType,
      }
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
    readonly read: RustPlannedProjectFieldDispatchRole;
    readonly write: RustPlannedProjectFieldDispatchRole;
  } = {
    read: { selfMode: "ref", fallible: false },
    write: { selfMode: "ref", fallible: false },
  },
): RustExpr {
  const selectedReceiver: RustExpr = { kind: "path", path: receiverBinding };
  const selectedValue = operator === "="
    ? value
    : {
        kind: "binary" as const,
        operator: operator.slice(0, -1) as "+" | "-" | "*" | "/" | "%",
        left: readRustProjectDispatchedField(selectedReceiver, readSlot, roles.read),
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
  return rustValueBlock([{ name: receiverBinding, value: receiver.kind === "reference"
    ? receiver : { kind: "reference", expr: receiver } }], roles.write.fallible
      ? {
          kind: "try",
          expr: writeCall,
          resultErrorType: roles.write.resultErrorType,
          operandErrorType: roles.write.operandErrorType,
        }
      : writeCall);
}
