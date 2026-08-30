import type { RustFoundation } from "../../../target-model/foundation/model.js";
import {
  createRustSourceFile,
  type RustItem,
  type RustSourceFileModel,
} from "../../target-ast/nodes.js";

export function applyRustFoundationImports(
  model: RustSourceFileModel,
  foundation: RustFoundation,
): RustSourceFileModel {
  if (foundation !== "alloc") {
    return model;
  }
  const imports = new Set<string>();
  const inspect = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(inspect);
      return;
    }
    if (value === null || typeof value !== "object") {
      return;
    }
    const record = value as Readonly<Record<string, unknown>>;
    if (record.kind === "string" || record.kind === "owned-string-from-borrowed-str") {
      imports.add("alloc::string::String");
    }
    if (record.kind === "string-concat" || record.kind === "format-write") {
      imports.add("alloc::format");
    }
    if (record.kind === "vec-literal") {
      imports.add("alloc::vec");
    }
    if (typeof record.path === "string") {
      if (record.path === "String" || record.path.startsWith("String::")) {
        imports.add("alloc::string::String");
      }
      if (record.path === "Vec" || record.path.startsWith("Vec::")) {
        imports.add("alloc::vec::Vec");
      }
    }
    Object.values(record).forEach(inspect);
  };
  inspect(model);
  if (imports.size === 0) {
    return model;
  }
  const existing = new Set(model.items.flatMap((item) =>
    item.kind === "use" && item.alias === undefined ? [item.path] : []));
  const added = [...imports]
    .filter((path) => !existing.has(path))
    .sort((left, right) => left.localeCompare(right, "en"))
    .map((path): RustItem => ({ kind: "use", path }));
  return added.length === 0
    ? model
    : createRustSourceFile(
        [...added, ...model.items],
        model.innerAttrs ?? [],
      );
}
