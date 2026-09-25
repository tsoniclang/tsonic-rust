import type { RustItem, RustSourceFileModel } from "../../target-ast/nodes.js";
import type { RustAttribute } from "../../target-ast/attributes.js";

export interface RustAttributedModule {
  readonly model: RustSourceFileModel;
  readonly attributes: readonly RustAttribute[];
}

export function inlineRustAttributedModules(
  model: RustSourceFileModel,
  moduleName: string,
  modules: ReadonlyMap<string, RustAttributedModule>,
): RustSourceFileModel {
  return { ...model, items: model.items.map((item): RustItem => {
    if (item.kind !== "mod-decl") return item;
    const name = moduleName.length === 0 ? item.name : `${moduleName}::${item.name}`;
    const selected = modules.get(name);
    if (selected === undefined) return item;
    if (item.body !== undefined) throw new Error(`Attributed module '${name}' already has a different body owner.`);
    return { ...item, attrs: [...selected.attributes, ...(item.attrs ?? [])],
      body: inlineRustAttributedModules(selected.model, name, modules) };
  }) };
}
