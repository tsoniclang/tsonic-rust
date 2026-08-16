import type { TargetDiagnostic } from "@tsonic/target-api";
import type { RustTranslationContext } from "../../translate/context.js";
import {
  createRustSourceFile,
} from "../rust-ast/nodes.js";
import type {
  RustItem,
  RustSourceFileModel,
  RustStructField,
  RustTypeParameter,
} from "../rust-ast/nodes.js";
import {
  rustRuntimeAliasImports,
} from "./plan-context.js";
import {
  rustTypeFromCarrierInContext,
} from "./render-types.js";

export function planRustStructuralShapeModule(
  input: RustTranslationContext,
  moduleNameByFileName: ReadonlyMap<string, string>,
  structuralShapesModuleName: string,
  diagnostics: TargetDiagnostic[],
): RustSourceFileModel | undefined {
  if (input.structuralShapes.definitions.length === 0) {
    return undefined;
  }
  const usedAliases = new Set<string>();
  const context = {
    input,
    moduleName: structuralShapesModuleName,
    moduleNameByFileName,
    structuralShapesModuleName,
    usedAliases,
  };
  const structs: RustItem[] = [];
  for (const definition of input.structuralShapes.definitions) {
    const fields: RustStructField[] = [];
    for (const field of definition.fields) {
      const type = rustTypeFromCarrierInContext(field.carrier, context);
      if (type === undefined) {
        diagnostics.push({
          code: "RUST_STRUCTURAL_SHAPE_FIELD_TYPE_MISSING",
          category: "error",
          source: "tsonic-rust",
          message: `Structural shape '${definition.targetName}' has a field without an exact renderable Rust carrier.`,
          evidence: ["target.capability=rust.backend.structural-shapes"],
        });
        return undefined;
      }
      fields.push({
        name: field.targetName,
        type,
        visibility: "public",
      });
    }
    const typeParams: readonly RustTypeParameter[] = definition.typeParameterNames.map((name) => ({
      name,
      bounds: [],
    }));
    structs.push({
      kind: "struct",
      name: definition.targetName,
      visibility: "public",
      attrs: ["#[allow(dead_code)]"],
      derives: [],
      ...(typeParams.length === 0 ? {} : { typeParams }),
      fields,
    });
  }
  const uses: RustItem[] = [...usedAliases]
    .sort((left, right) => left.localeCompare(right, "en"))
    .flatMap((alias) => {
      const entry = rustRuntimeAliasImports.get(alias);
      return entry === undefined
        ? []
        : [{ kind: "use" as const, path: entry.path, alias: entry.alias }];
    });
  return createRustSourceFile([...uses, ...structs]);
}
