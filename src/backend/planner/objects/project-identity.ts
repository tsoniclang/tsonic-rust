import { rustSelfParameter } from "../declarations/callables/self-parameter.js";
import type { RustExpr, RustGenerics, RustItem, RustType } from "../../target-ast/nodes.js";
import { emptyRustGenerics } from "../../target-ast/nodes.js";
import { planCheckedNativeProjectionImplementation } from "./checked-project-projections.js";
import { rustProjectObjectStateField } from "./project-objects.js";

export function rustProjectStateIdentityImplementation(target: RustType, generics: RustGenerics): RustItem {
  return rustProjectObjectIdentityImplementation(target, generics, {
    kind: "method-call",
    receiver: { kind: "field", receiver: { kind: "path", path: "self" }, name: rustProjectObjectStateField },
    method: "object_identity",
    args: [],
  });
}

export function rustProjectObjectIdentityImplementation(
  target: RustType,
  generics: RustGenerics,
  identity: RustExpr,
  identityKey?: RustExpr,
  projectionTypes: readonly RustType[] = [],
): RustItem {
  return {
    kind: "impl",
    generics,
    trait: { kind: "named", path: "rt::ObjectIdentityCarrier" },
    target,
    members: [...(projectionTypes.length === 0 ? [] : [
      planCheckedNativeProjectionImplementation("project_native", [{
        kind: "named", path: "Option", genericArguments: [{ kind: "type", type: {
          kind: "named", path: "alloc::rc::Rc", genericArguments: [{
            kind: "type", type: { kind: "named", path: "Self" },
          }],
        } }],
      }, ...projectionTypes]),
    ]), { kind: "function",
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
    }, ...(identityKey === undefined ? [] : [{ kind: "function" as const,
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
