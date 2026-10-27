import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustObjectRepresentation } from "../../../target-model/records/objects/object-representation.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { requireRustCarrierRead } from "../types/carrier-reads.js";
import { rustProjectObjectStateField, rustProjectObjectStateBinding, rustProjectObjectStatePath, rustProjectObjectDirectPath } from "./project-objects.js";

export function readRustProjectObjectIndex(
  receiver: RustExpr,
  storageName: string,
  key: RustExpr,
  resultCarrier: TargetTypeRef,
  representation: RustObjectRepresentation,
  context: RustPlanContext,
): RustExpr {
  if (representation.kind === "value") {
    return rustProjectObjectValueRead({
      kind: "index",
      receiver: rustProjectObjectDirectPath(receiver, storageName),
      index: key,
    }, resultCarrier, context);
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
    receiverMode: "ref",
    args: [{
      kind: "closure",
      params: [{ name: rustProjectObjectStateBinding, byRefCopy: false }],
      body: requireRustCarrierRead(resultCarrier, context).copy
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
    receiverMode: "ref",
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
    receiverMode: "ref",
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
    receiverMode: "ref",
    args: [{
      kind: "closure",
      params: [{ name: rustProjectObjectStateBinding, byRefCopy: false }],
      body,
    }],
  };
}

function rustProjectObjectValueRead(field: RustExpr, resultCarrier: TargetTypeRef, context: RustPlanContext): RustExpr {
  return requireRustCarrierRead(resultCarrier, context).copy ? field
    : { kind: "method-call", receiver: field, method: "clone", args: [] };
}
