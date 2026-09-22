import type { RustSourceFileModel } from "../nodes.js";
import { exposeRustSignatureTypes, rustPublicSignatureTypeNames } from "./source-style.js";

export function closeRustModuleTypeVisibility(
  input: ReadonlyMap<string, RustSourceFileModel>,
): ReadonlyMap<string, RustSourceFileModel> {
  const models = new Map(input);
  const required = new Set<string>();
  for (;;) {
    const before = required.size;
    for (const model of models.values()) {
      for (const name of rustPublicSignatureTypeNames(model)) required.add(name);
    }
    if (required.size === before) return models;
    for (const [moduleName, model] of models) {
      const prefix = `crate::${moduleName}::`;
      const names = new Set([...required].filter(name => name.startsWith(prefix))
        .map(name => name.slice(prefix.length)));
      models.set(moduleName, exposeRustSignatureTypes(model, names));
    }
  }
}
