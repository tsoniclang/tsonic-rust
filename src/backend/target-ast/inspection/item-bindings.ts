import type { RustItem } from "../syntax/nodes.js";

export function rustItemBindingNames(item: RustItem): readonly string[] {
  if ("name" in item) return [item.name];
  if (item.kind !== "use") return [];
  const segments = item.path.split("::");
  const name = item.alias ?? segments[segments.length - 1];
  return name === undefined ? [] : [name];
}
