import type { RustGenericCallablePhysicalDefinition } from "../../../../target-model/records/callables/generic-callables.js";
import { emptyRustGenerics, type RustExpr, type RustGenerics, type RustItem, type RustType } from "../../../target-ast/syntax/nodes.js";
import { rustSelfParameter } from "./self-parameter.js";
import { rustCallableIdentityPredicate } from "../../../target-ast/syntax/callable-identities.js";
import type { RustGenericCallableIdentitySelection } from "../../../../target-model/records/callables/generic-callables.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";

export function genericCallableStorageItems(
  definition: RustGenericCallablePhysicalDefinition,
  generics: RustGenerics,
  target: RustType,
  variants: Extract<RustItem, { readonly kind: "enum" }>["variants"],
  identity: RustGenericCallableIdentitySelection | undefined,
): readonly RustItem[] {
  const receiver: RustExpr = { kind: "path", path: "self" };
  const clone: RustExpr = definition.copy
    ? { kind: "dereference", pointer: receiver }
    : { kind: "match", expression: receiver, arms: definition.members.map(member => ({
        pattern: { kind: "tuple-variant", path: `Self::${member.variantName}`,
          elements: [{ kind: "binding", name: "environment" }] },
        expression: { kind: "call", path: `Self::${member.variantName}`,
          args: [member.implementation.storage === "value"
            ? { kind: "dereference", pointer: { kind: "path", path: "environment" } }
            : { kind: "method-call", receiver: { kind: "path", path: "environment" }, method: "clone", args: [] }] },
      })) };
  const items: RustItem[] = [{ kind: "enum", name: definition.targetName, visibility: "public",
    generics, variants },
  { kind: "impl", trait: { kind: "named", path: "Clone" }, target, generics, members: [{ kind: "function",
    name: "clone", visibility: "private", selfParam: rustSelfParameter("ref"), generics: emptyRustGenerics,
    params: [], returnType: { kind: "named", path: "Self" }, body: { statements: [{ kind: "tail", expr: clone }] },
  }] }];
  if (definition.copy) {
    items.push({ kind: "impl", trait: { kind: "named", path: "Copy" }, target, generics, members: [] });
  }
  if (!definition.identityObserved) return items;
  if (identity?.left !== definition || identity.right !== definition)
    failRustPlannerInvariant("An observed native callable family requires its exact admitted identity comparison.");
  const equality: RustExpr = { kind: "match", expression: { kind: "tuple-literal", elements: [
    receiver, { kind: "path", path: "other" },
  ] }, arms: [
    ...identity.pairs.map(pair => ({
      pattern: { kind: "tuple" as const, elements: ([["left", pair.left], ["right", pair.right]] as const).map(([name, member]) => ({
        kind: "tuple-variant" as const, path: `Self::${member.variantName}`,
        elements: [pair.kind === "declaration"
          ? { kind: "wildcard" as const } : { kind: "binding" as const, name }],
      })) },
      expression: rustCallableIdentityPredicate(pair.kind,
        { kind: "path", path: "left" }, { kind: "path", path: "right" }),
    })),
    ...(!identity.exhaustive ? [{ pattern: { kind: "wildcard" as const },
      expression: { kind: "bool-literal" as const, value: false } }] : []),
  ] };
  items.push({ kind: "impl", trait: { kind: "named", path: "PartialEq" }, target, generics, members: [{ kind: "function",
    name: "eq", visibility: "private", selfParam: rustSelfParameter("ref"), generics: emptyRustGenerics,
    params: [{ name: "other", type: { kind: "reference", referent: { kind: "named", path: "Self" }, mutable: false } }],
    returnType: { kind: "primitive", name: "bool" }, body: { statements: [{ kind: "tail", expr: equality }] },
  }] }, { kind: "impl", trait: { kind: "named", path: "Eq" }, target, generics, members: [] });
  return items;
}

export function genericCallableCopyStateItems(
  target: RustType, generics: RustGenerics,
): readonly RustItem[] {
  return [{ kind: "impl", trait: { kind: "named", path: "Copy" }, target, generics, members: [] },
    { kind: "impl", trait: { kind: "named", path: "Clone" }, target, generics, members: [{ kind: "function",
      name: "clone", visibility: "private", selfParam: rustSelfParameter("ref"), generics: emptyRustGenerics,
      params: [], returnType: { kind: "named", path: "Self" }, body: { statements: [{ kind: "tail",
        expr: { kind: "dereference", pointer: { kind: "path", path: "self" } } }] },
    }] }];
}
