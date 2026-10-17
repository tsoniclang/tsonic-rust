import { rustSelfParameter } from "../declarations/callables/self-parameter.js";
import { rustProjectObjectStateField } from "../../../target-model/types/field-storage.js";
import { emptyRustGenerics } from "../../target-ast/syntax/nodes.js";
import type { RustExpr, RustGenerics, RustImplFunction, RustItem, RustType } from "../../target-ast/syntax/nodes.js";

export function rustProjectCloneImplementation(
  target: RustType,
  generics: RustGenerics,
  fields: readonly { readonly name: string; readonly copy: boolean; readonly requirement?: RustType }[],
): RustItem {
  return {
    kind: "impl", target, generics: { ...generics, wherePredicates: [...generics.wherePredicates,
      ...fields.flatMap(field => field.requirement === undefined ? [] : [{ kind: "type" as const, type: field.requirement,
        bounds: [{ kind: "trait" as const, path: "Clone" }] }])] },
    trait: { kind: "named", path: "Clone" },
    members: [{ kind: "function",
      name: "clone", visibility: "private", generics: emptyRustGenerics,
      selfParam: rustSelfParameter("ref"), params: [], returnType: { kind: "named", path: "Self" },
      body: { statements: [{ kind: "tail", expr: {
        kind: "struct-literal", path: "Self", fields: fields.map(field => ({
          name: field.name, value: field.copy ? { kind: "field", receiver: { kind: "path", path: "self" }, name: field.name }
            : { kind: "method-call", receiver: {
              kind: "field", receiver: { kind: "path", path: "self" }, name: field.name,
            }, method: "clone", args: [] },
        })),
      } }] },
    }],
  };
}

export function rustProjectWrapperTraits(
  target: RustType,
  name: string,
  generics: RustGenerics,
): readonly RustItem[] {
  const field = (receiver: string): RustExpr => ({
    kind: "field", receiver: { kind: "path", path: receiver }, name: rustProjectObjectStateField,
  });
  const reference = (expression: RustExpr): RustExpr => ({ kind: "reference", expr: expression });
  const implementation = (trait: string, method: RustImplFunction): RustItem => ({
    kind: "impl", target, generics, trait: { kind: "named", path: trait }, members: [method],
  });
  return [
    rustProjectCloneImplementation(target, generics, [{ name: rustProjectObjectStateField, copy: false }]),
    implementation("core::fmt::Debug", { kind: "function",
      name: "fmt", visibility: "private", generics: emptyRustGenerics,
      selfParam: rustSelfParameter("ref"), params: [{ name: "formatter", type: {
        kind: "reference", mutable: true, referent: {
          kind: "named", path: "core::fmt::Formatter",
          genericArguments: [{ kind: "lifetime", lifetime: { kind: "placeholder" } }],
        },
      } }], returnType: { kind: "named", path: "core::fmt::Result" },
      body: { statements: [{ kind: "tail", expr: {
        kind: "method-call", receiver: {
          kind: "method-call", receiver: {
            kind: "method-call", receiver: { kind: "path", path: "formatter" },
            method: "debug_struct", args: [{ kind: "str-literal", value: name }],
          }, method: "field", args: [
            { kind: "str-literal", value: rustProjectObjectStateField }, reference(field("self")),
          ],
        }, method: "finish", args: [],
      } }] },
    }),
    implementation("PartialEq", { kind: "function",
      name: "eq", visibility: "private", generics: emptyRustGenerics,
      selfParam: rustSelfParameter("ref"), params: [{ name: "other", type: {
        kind: "reference", mutable: false, referent: { kind: "named", path: "Self" },
      } }], returnType: { kind: "primitive", name: "bool" },
      body: { statements: [{ kind: "tail", expr: {
        kind: "binary", operator: "==", left: field("self"), right: field("other"),
      } }] },
    }),
  ];
}
