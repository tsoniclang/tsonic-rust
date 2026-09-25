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

export function rustBindingStorageOperations(storage: "location" | RustInlineBindingStorage): RustBindingStorageOperations {
  const call = (receiver: RustExpr, method: string, args: readonly RustExpr[] = []): RustExpr =>
    ({ kind: "method-call", receiver, method, args });
  if (storage === "borrow-cell") {
    return {
      read: receiver => ({ kind: "block", bindings: [{ name: "value", value: call(call(receiver, "borrow"), "clone") }],
        value: { kind: "path", path: "value" } }),
      write: (receiver, value) => ({ kind: "assignment", operator: "=",
        target: { kind: "dereference", pointer: call(receiver, "borrow_mut") }, value }),
    };
  }
  return {
    read: receiver => call(receiver, storage === "cell" ? "get" : "load"),
    write: (receiver, value) => call(receiver, storage === "cell" ? "set" : "store", [value]),
  };
}
