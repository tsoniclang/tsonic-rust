import { rustValueBlock } from "../../target-ast/value-block.js";
import type { RustExpr, RustType } from "../../target-ast/nodes.js";

export type RustInlineBindingStorage = "cell" | "borrow-cell";

export interface RustBindingStorageOperations {
  readonly read: (receiver: RustExpr) => RustExpr;
  readonly write: (receiver: RustExpr, value: RustExpr) => RustExpr;
}

export function rustInlineBindingStoragePath(storage: RustInlineBindingStorage): string {
  return storage === "cell" ? "core::cell::Cell" : "core::cell::RefCell";
}

export function rustInlineBindingStorageType(storage: RustInlineBindingStorage, value: RustType): RustType {
  return { kind: "named", path: rustInlineBindingStoragePath(storage),
    genericArguments: [{ kind: "type", type: value }] };
}

export function rustBindingStorageOperations(storage: "location" | RustInlineBindingStorage, copyPayload = false): RustBindingStorageOperations {
  const call = (receiver: RustExpr, method: string, args: readonly RustExpr[] = []): RustExpr =>
    ({ kind: "method-call", receiver: receiver.kind === "reference" ? receiver.expr : receiver, method, args });
  if (storage === "borrow-cell") {
    return {
      read: receiver => (rustValueBlock([{ name: "borrowed", value: call(receiver, "borrow") }], copyPayload
        ? { kind: "dereference", pointer: { kind: "path", path: "borrowed" } }
        : call({ kind: "path", path: "borrowed" }, "clone"))),
      write: (receiver, value) => ({ kind: "block", body: { statements: [{ kind: "let", name: "_", mutable: false,
        init: call(receiver, "replace", [value]) }] } }),
    };
  }
  return {
    read: receiver => call(receiver, storage === "cell" ? "get" : "load"),
    write: (receiver, value) => call(receiver, storage === "cell" ? "set" : "store", [value]),
  };
}
