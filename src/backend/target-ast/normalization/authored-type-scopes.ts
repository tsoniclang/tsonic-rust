import { failRustPlannerInvariant } from "../../invariants.js";
import type { RustItem } from "../syntax/nodes.js";
import { rustItemsReferenceModuleAlias } from "../inspection/source-module-usage.js";

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
      case "extern-crate": return [];
    }
  }));
  return items.map(item => {
    if (item.kind !== "mod-decl" || !scopes.has(item.name)) return item;
    const declaration = item.body?.items[0];
    if (item.body?.items.length !== 1 || declaration?.kind !== "struct") {
      failRustPlannerInvariant("Authored type scope must contain its one planned struct declaration.");
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
