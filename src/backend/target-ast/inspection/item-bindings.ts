import type { RustItem } from "../syntax/nodes.js";

export function rustItemBindingNames(item: RustItem): readonly string[] {
  if ("name" in item) return [item.name];
  if (item.kind !== "use") return [];
  const name = item.alias ?? item.path.split("::").at(-1);
  return name === undefined ? [] : [name];
}
