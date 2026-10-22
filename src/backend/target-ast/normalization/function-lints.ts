import type { RustAttribute } from "../syntax/attributes.js";
import type { RustImplFunction, RustItem } from "../syntax/nodes.js";
import { rustItemsReferenceModuleAlias } from "../syntax/module-references.js";
import { rustLintAttributes } from "./lint-policy.js";

// Function-level lint expectations decided from the printed signature alone (syntax only): a checked signature with
// more than seven arguments, a generic parameter that only the source contract uses (a type predicate or an erased
// callable bound), an inherent `to_string`, and an authored public `next(&mut self)` iterator method.

type RustFunctionShape = Pick<RustImplFunction, "attrs" | "params" | "generics" | "name" | "visibility" | "returnType" | "body"> &
  { readonly selfParam?: RustImplFunction["selfParam"] };

function appendRustLint(attrs: readonly RustAttribute[] | undefined, lint: RustAttribute): readonly RustAttribute[] {
  return attrs?.includes(lint) === true ? attrs : [...attrs ?? [], lint];
}

function hasErasedGenericParameter(fn: RustFunctionShape): boolean {
  const usage = { ...fn, kind: "function" } as RustItem;
  return fn.generics.parameters.some(parameter => parameter.kind === "type" && !rustItemsReferenceModuleAlias([usage], parameter.name));
}

export function rustPublicDeclaredTypeNames(items: readonly RustItem[]): ReadonlySet<string> {
  return new Set(items.flatMap(item => item.kind === "mod-decl" && item.body !== undefined
    ? [...rustPublicDeclaredTypeNames(item.body.items)].map(name => `${item.name}::${name}`)
    : (item.kind === "struct" || item.kind === "trait" || item.kind === "enum" || item.kind === "type-alias") &&
      item.visibility === "public" ? [item.name] : []));
}

export function applyRustFreeFunctionLints<Fn extends RustFunctionShape>(fn: Fn): Fn {
  let attrs = fn.attrs;
  if (fn.params.length > 7) attrs = appendRustLint(attrs, rustLintAttributes.tooManyArguments);
  if (fn.visibility !== "public" && hasErasedGenericParameter(fn)) attrs = appendRustLint(attrs, rustLintAttributes.unusedTypeParameters);
  return attrs === fn.attrs ? fn : { ...fn, attrs };
}

export function applyRustInherentMethodLints<Fn extends RustFunctionShape>(fn: Fn, publicOwner: boolean): Fn {
  let attrs = fn.attrs;
  if (!(publicOwner && fn.visibility === "public") && hasErasedGenericParameter(fn))
    attrs = appendRustLint(attrs, rustLintAttributes.unusedTypeParameters);
  if (fn.params.length + (fn.selfParam === undefined ? 0 : 1) > 7) attrs = appendRustLint(attrs, rustLintAttributes.tooManyArguments);
  if (fn.name === "to_string" && fn.selfParam !== undefined && fn.params.length === 0 && fn.returnType?.kind === "string")
    attrs = appendRustLint(attrs, rustLintAttributes.inherentToString);
  if (publicOwner && fn.visibility === "public" && fn.name === "next" && fn.selfParam?.kind === "reference" && fn.selfParam.mutable &&
    fn.params.length === 0) attrs = appendRustLint(attrs, rustLintAttributes.shouldImplementTrait);
  return attrs === fn.attrs ? fn : { ...fn, attrs };
}

export function applyRustTraitFunctionLints<Fn extends Pick<RustFunctionShape, "attrs" | "params"> & { readonly selfParam?: unknown }>(fn: Fn): Fn {
  return fn.params.length + (fn.selfParam === undefined ? 0 : 1) > 7
    ? { ...fn, attrs: appendRustLint(fn.attrs, rustLintAttributes.tooManyArguments) } : fn;
}
