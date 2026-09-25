import { rustSelfParameter } from "../declarations/callables/self-parameter.js";
import type { RustExpr, RustGenerics, RustItem, RustType } from "../../target-ast/nodes.js";
import { emptyRustGenerics } from "../../target-ast/nodes.js";

export function rustProjectObjectIdentityImplementation(
  target: RustType,
  generics: RustGenerics,
  identity: RustExpr,
  identityKey?: RustExpr,
): RustItem {
  return {
    kind: "impl",
    generics,
    trait: { kind: "named", path: "rt::ObjectIdentityCarrier" },
    target,
    functions: [{
      name: "object_identity",
      visibility: "private",
      generics: emptyRustGenerics,
      selfParam: rustSelfParameter("ref"),
      params: [],
      returnType: {
        kind: "reference",
        mutable: false,
        referent: { kind: "named", path: "rt::ObjectIdentity" },
      },
      body: { statements: [{ kind: "tail", expr: identity }] },
    }, ...(identityKey === undefined ? [] : [{
      name: "object_identity_key",
      visibility: "private" as const,
      generics: emptyRustGenerics,
      selfParam: rustSelfParameter("ref"),
      params: [],
      returnType: { kind: "primitive" as const, name: "usize" as const },
      body: { statements: [{ kind: "tail" as const, expr: identityKey }] },
    }])],
  };
}
