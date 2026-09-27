import type { Node } from "@tsonic/tsts";
import { rustHiddenAttribute } from "../../target-ast/attributes.js";
import { createRustSourceFile, type RustItem } from "../../target-ast/nodes.js";
import { rustItemsReferenceModuleAlias } from "../../target-ast/inspection/source-module-usage.js";
import type { RustPlanContext } from "../program/plan-context.js";

export function planRustAuthoredStructScope(
  declaration: Node,
  item: Extract<RustItem, { readonly kind: "struct" }>,
  context: RustPlanContext,
): RustItem {
  const scope = context.input.program.names.scopeForDeclaration(declaration);
  if (scope === undefined) return item;
  return {
    kind: "mod-decl",
    name: scope,
    visibility: item.visibility,
    attrs: [rustHiddenAttribute],
    body: createRustSourceFile([
      {
        ...item,
        fields: item.fields.map(field => field.visibility === "private"
          ? { ...field, visibility: "parent" }
          : field),
      },
    ]),
  };
}

export function completeRustAuthoredStructScopes(
  items: readonly RustItem[],
  scopes: ReadonlySet<string>,
): readonly RustItem[] {
  if (scopes.size === 0) return items;
  const parentNames = new Set(items.flatMap(item => {
    switch (item.kind) {
      case "function":
      case "const":
      case "thread-local":
      case "struct":
      case "enum":
      case "trait":
      case "type-alias":
      case "mod-decl": return [item.name];
      case "use": return [item.alias ?? item.path.split("::").pop()!];
      case "impl":
      case "extern-crate":
      case "macro-invocation": return [];
    }
  }));
  return items.map(item => {
    if (item.kind !== "mod-decl" || !scopes.has(item.name)) return item;
    const declaration = item.body?.items[0];
    if (item.body?.items.length !== 1 || declaration?.kind !== "struct") {
      throw new Error("Authored type scope must contain its one planned struct declaration.");
    }
    const boundNames = new Set([declaration.name,
      ...declaration.generics.parameters.filter(parameter => parameter.kind !== "lifetime")
        .map(parameter => parameter.name)]);
    const imports: RustItem[] = [...parentNames].filter(name => !boundNames.has(name) &&
      rustItemsReferenceModuleAlias([declaration], name))
      .map(name => ({ kind: "use", path: `super::${name}` }));
    return { ...item, body: { ...item.body, items: [...imports, declaration] } };
  });
}
