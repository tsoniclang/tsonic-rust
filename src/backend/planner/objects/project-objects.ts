import { failRustPlannerInvariant } from "../diagnostics.js";
import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import { rustPropagateLocalError } from "../program/fallible-boundaries.js";
import { cloneRustExpression } from "../../target-ast/syntax/expressions.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustAssignmentOperator } from "../../../target-model/syntax/tokens.js";
import { requireRustCarrierRead } from "../types/carrier-reads.js";
import type { RustExpr, RustType } from "../../target-ast/syntax/nodes.js";
import type { RustObjectRepresentation } from "../../../target-model/records/objects/object-representation.js";
import type { RustPlannedProjectFieldDispatchRole } from "./project-field-dispatch.js";
import type { RustCapturedFieldStorage } from "../../../target-model/types/field-storage.js";
import { rustCapturedFieldLocation, writeRustCapturedFieldFromStorage } from "./captured-fields.js";
import type { RustPlanContext } from "../program/plan-context.js";

export const rustProjectObjectStateField = "state";
export const rustProjectObjectIdentityField = "identity";
export const rustProjectObjectDispatchField = "dispatch";

export const rustProjectObjectStateBinding = "state";

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
    receiverMode: "ref",
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
    failRustPlannerInvariant("Polymorphic project objects require their dedicated construction planner.");
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
  context: RustPlanContext,
  captureStorage?: RustCapturedFieldStorage,
  projection: readonly string[] = [],
): RustExpr {
  return withRustProjectStoredField(receiver, storagePath, representation, field => captureStorage !== undefined
    ? rustCapturedFieldLocation(captureStorage, field, resultCarrier, context, projection, resultCarrier).read
    : requireRustCarrierRead(resultCarrier, context).copy ? field : { kind: "method-call", receiver: field, method: "clone", args: [] });
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
    receiverMode: "ref",
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
  context: RustPlanContext,
): RustExpr {
  const field = rustStructuralObjectStatePath(storagePath);
  return {
    kind: "method-call",
    receiver,
    method: "with",
    receiverMode: "ref",
    args: [{
      kind: "closure",
      params: [{ name: rustProjectObjectStateBinding, byRefCopy: false }],
      body: requireRustCarrierRead(resultCarrier, context).copy
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
    receiverMode: "ref",
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
    receiverMode: "ref",
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
    receiverMode: "ref",
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
    receiverMode: "ref",
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
    receiverMode: "ref",
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
    receiverMode: "ref",
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
    receiverMode: "ref",
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
        receiverMode: "ref",
        args: [{
          kind: "closure",
          params: [{ name: rustProjectObjectStateBinding, byRefCopy: false }],
          body,
        }],
      };
}

export function rustProjectObjectStatePath(
  storagePath: string | readonly string[],
): RustExpr {
  const path = typeof storagePath === "string" ? [storagePath] : storagePath;
  return path.reduce<RustExpr>(
    (receiver, name) => ({ kind: "field", receiver, name }),
    { kind: "path", path: rustProjectObjectStateBinding },
  );
}

export function rustProjectObjectDirectPath(
  receiver: RustExpr,
  storagePath: string | readonly string[],
): RustExpr {
  const path = typeof storagePath === "string" ? [storagePath] : storagePath;
  return path.reduce<RustExpr>(
    (current, name) => ({ kind: "field", receiver: current, name }),
    receiver,
  );
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
): RustExpr | undefined {
  const dispatch: RustExpr = {
    kind: "field",
    receiver,
    name: rustProjectObjectDispatchField,
  };
  const call: RustExpr = {
    kind: "method-call",
    receiver: role.selfMode === "rc"
      ? cloneRustExpression(dispatch)
      : dispatch,
    receiverMode: role.selfMode === "rc" ? "value" : "ref",
    method: readSlot,
    args: [],
  };
  return role.fallible
    ? rustPropagateLocalError(role.region, role.operandErrorType, call)
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
): RustExpr | undefined {
  const selectedReceiver: RustExpr = { kind: "path", path: receiverBinding };
  const read = operator === "=" ? undefined : readRustProjectDispatchedField(selectedReceiver, readSlot, roles.read);
  if (operator !== "=" && read === undefined) return undefined;
  const selectedValue = operator === "="
    ? value
    : {
        kind: "binary" as const,
        operator: operator.slice(0, -1) as "+" | "-" | "*" | "/" | "%",
        left: read!,
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
      ? cloneRustExpression(dispatch)
      : dispatch,
    receiverMode: roles.write.selfMode === "rc" ? "value" : "ref",
    method: writeSlot,
    args: [selectedValue],
  };
  const write = roles.write.fallible
    ? rustPropagateLocalError(roles.write.region, roles.write.operandErrorType, writeCall) : writeCall;
  const borrowedReceiver: RustExpr = receiver.kind === "reference" && receiver.mutable !== true
    ? receiver : { kind: "reference", expr: receiver };
  return write === undefined ? undefined : rustValueBlock([{ name: receiverBinding, value: borrowedReceiver }], write);
}
