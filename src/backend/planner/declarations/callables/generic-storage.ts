import type { RustGenericCallableDefinition } from "../../../../analysis/callables/generic-values.js";
import { emptyRustGenerics, type RustExpr, type RustGenerics, type RustItem, type RustType } from "../../../target-ast/nodes.js";
import { rustSelfParameter } from "./self-parameter.js";

export function genericCallableStorageItems(
  definition: RustGenericCallableDefinition,
  generics: RustGenerics,
  target: RustType,
  variants: Extract<RustItem, { readonly kind: "enum" }>["variants"],
): readonly RustItem[] {
  const receiver: RustExpr = { kind: "path", path: "self" };
  const clone: RustExpr = definition.storage === "value"
    ? { kind: "dereference", pointer: receiver }
    : { kind: "match", expression: receiver, arms: definition.implementations.map(implementation => ({
        pattern: { kind: "tuple-variant", path: `Self::${implementation.variantName}`,
          elements: [{ kind: "binding", name: "environment" }] },
        expression: { kind: "call", path: `Self::${implementation.variantName}`,
          args: [{ kind: "method-call", receiver: { kind: "path", path: "environment" }, method: "clone", args: [] }] },
      })) };
  const items: RustItem[] = [{ kind: "enum", name: definition.targetName, visibility: "public",
    generics, variants },
  { kind: "impl", trait: { kind: "named", path: "Clone" }, target, generics, functions: [{
    name: "clone", visibility: "private", selfParam: rustSelfParameter("ref"), generics: emptyRustGenerics,
    params: [], returnType: { kind: "named", path: "Self" }, body: { statements: [{ kind: "tail", expr: clone }] },
  }] }];
  if (definition.storage === "value") {
    items.push({ kind: "impl", trait: { kind: "named", path: "Copy" }, target, generics, functions: [] });
    return items;
  }
  const equality: RustExpr = { kind: "match", expression: { kind: "tuple-literal", elements: [
    receiver, { kind: "path", path: "other" },
  ] }, arms: [
    ...definition.implementations.map(implementation => ({
      pattern: { kind: "tuple" as const, elements: ["left", "right"].map(name => ({
        kind: "tuple-variant" as const, path: `Self::${implementation.variantName}`,
        elements: [{ kind: "binding" as const, name }],
      })) },
      expression: { kind: "call" as const, path: "alloc::rc::Rc::ptr_eq",
        args: ["left", "right"].map(path => ({ kind: "path" as const, path })) },
    })),
    ...(definition.implementations.length > 1 ? [{ pattern: { kind: "wildcard" as const },
      expression: { kind: "bool-literal" as const, value: false } }] : []),
  ] };
  items.push({ kind: "impl", trait: { kind: "named", path: "PartialEq" }, target, generics, functions: [{
    name: "eq", visibility: "private", selfParam: rustSelfParameter("ref"), generics: emptyRustGenerics,
    params: [{ name: "other", type: { kind: "reference", referent: { kind: "named", path: "Self" }, mutable: false } }],
    returnType: { kind: "primitive", name: "bool" }, body: { statements: [{ kind: "tail", expr: equality }] },
  }] }, { kind: "impl", trait: { kind: "named", path: "Eq" }, target, generics, functions: [] });
  return items;
}

export function genericCallableCopyStateItems(
  target: RustType, generics: RustGenerics,
): readonly RustItem[] {
  return [{ kind: "impl", trait: { kind: "named", path: "Copy" }, target, generics, functions: [] },
    { kind: "impl", trait: { kind: "named", path: "Clone" }, target, generics, functions: [{
      name: "clone", visibility: "private", selfParam: rustSelfParameter("ref"), generics: emptyRustGenerics,
      params: [], returnType: { kind: "named", path: "Self" }, body: { statements: [{ kind: "tail",
        expr: { kind: "dereference", pointer: { kind: "path", path: "self" } } }] },
    }] }];
}
