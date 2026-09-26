import { canonicalItemId, canonicalItemPath } from "../rustdoc-items.js";
import { requireArray, requireInnerRecord, requireRecord, requireString } from "../rustdoc-schema.js";
import type { RustdocDocument } from "../rustdoc-schema.js";
import type { RustCompilerDependency, RustCompilerMacroExport, RustCompilerMacroKind } from "../model.js";

export function normalizeMacro(
  document: RustdocDocument,
  item: Readonly<Record<string, unknown>>,
  dependency: RustCompilerDependency,
  name: string,
  targetPath: readonly string[],
): RustCompilerMacroExport {
  const inner = requireRecord(item.inner, `Rust macro '${name}' inner`);
  if (Object.keys(inner).length !== 1) throw new Error(`Rust macro '${name}' has conflicting item kinds.`);
  let macroKind: RustCompilerMacroKind;
  let helpers: readonly string[];
  if (Object.prototype.hasOwnProperty.call(inner, "macro")) {
    requireString(inner.macro, `Rust declarative macro '${name}' definition`);
    macroKind = "declarative";
    helpers = Object.freeze([]);
  } else {
    const macro = requireInnerRecord(item, "proc_macro", `Rust procedural macro '${name}'`);
    const category = requireString(macro.kind, `Rust procedural macro '${name}' kind`);
    switch (category) {
      case "bang": macroKind = "function"; break;
      case "attr": macroKind = "attribute"; break;
      case "derive": macroKind = "derive"; break;
      default: throw new Error(`Rust procedural macro '${name}' has unsupported compiler kind '${category}'.`);
    }
    helpers = Object.freeze(requireArray(macro.helpers, `Rust procedural macro '${name}' helpers`)
      .map(value => requireString(value, `Rust procedural macro '${name}' helper`)));
    if (helpers.some(helper => helper.length === 0) ||
      macroKind !== "derive" && helpers.length !== 0) {
      throw new Error(`Rust procedural macro '${name}' has invalid helper metadata.`);
    }
  }
  const canonicalPath = document.paths[String(item.id)] === undefined ? undefined : canonicalItemPath(document, item);
  return Object.freeze({
    kind: "macro", id: canonicalItemId(dependency, item), name, macroKind, helpers,
    targetPath: Object.freeze([...targetPath]),
    ...(canonicalPath === undefined ? {} : { canonicalPath: Object.freeze([...canonicalPath]) }),
  });
}
