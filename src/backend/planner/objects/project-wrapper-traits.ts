import { rustSelfParameter } from "../declarations/callables/self-parameter.js";
import { rustProjectObjectStateField } from "./project-objects.js";
import { emptyRustGenerics } from "../../target-ast/nodes.js";
import type { RustExpr, RustGenerics, RustImplFunction, RustItem, RustType } from "../../target-ast/nodes.js";

export function rustProjectCloneImplementation(
  target: RustType,
  generics: RustGenerics,
  fields: readonly string[],
): RustItem {
  return {
    kind: "impl", target, generics, trait: { kind: "named", path: "Clone" },
    members: [{ kind: "function",
      name: "clone", visibility: "private", generics: emptyRustGenerics,
      selfParam: rustSelfParameter("ref"), params: [], returnType: { kind: "named", path: "Self" },
      body: { statements: [{ kind: "tail", expr: {
        kind: "struct-literal", path: "Self", fields: fields.map(name => ({
          name, value: { kind: "method-call", receiver: {
            kind: "field", receiver: { kind: "path", path: "self" }, name,
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
    rustProjectCloneImplementation(target, generics, [rustProjectObjectStateField]),
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
