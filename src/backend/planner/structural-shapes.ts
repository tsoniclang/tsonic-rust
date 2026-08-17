import type { TargetDiagnostic } from "@tsonic/target-api";
import type { RustTranslationContext } from "../../translate/context.js";
import {
  createRustSourceFile,
} from "../rust-ast/nodes.js";
import type {
  RustItem,
  RustSourceFileModel,
  RustStructField,
  RustType,
  RustTypeParameter,
} from "../rust-ast/nodes.js";
import { rustLintAttributes } from "../rust-ast/lint-policy.js";
import { rustPascalCaseIdentifier } from "../../common/rust-identifiers.js";
import {
  rustRuntimeAliasImports,
} from "./plan-context.js";
import {
  rustTypeFromCarrierInContext,
} from "./render-types.js";
import {
  rustOptionTargetType,
  rustStructuralPropertyGetterStorageCarrier,
  rustStructuralPropertySetterStorageCarrier,
  rustStructuralPropertyValueCarrier,
  rustStructuralMethodStorageCarrier,
} from "../../source/rust-target-types.js";

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
    const typeParams: readonly RustTypeParameter[] = definition.typeParameterNames.map((name) => ({
      name,
      bounds: [],
    }));
    const aliasTypeArguments: readonly RustType[] = definition.typeParameterNames.map((name) => ({
      kind: "named",
      path: name,
    }));
    const callableAliases: RustItem[] = [];
    const fields: RustStructField[] = [];
    for (const field of definition.fields) {
      const methodStorageCarrier = field.method === true
        ? rustStructuralMethodStorageCarrier(
            definition.carrier,
            field.carrier,
            field.presence,
          )
        : undefined;
      const storageCarrier = field.method === true ? methodStorageCarrier : field.carrier;
      if (storageCarrier === undefined) {
        diagnostics.push({
          code: "RUST_STRUCTURAL_SHAPE_METHOD_TYPE_MISSING",
          category: "error",
          source: "tsonic-rust",
          message: `Structural shape '${definition.targetName}' has a method without one exact runtime-callable storage carrier.`,
          evidence: ["target.capability=rust.backend.structural-shapes.methods"],
        });
        return undefined;
      }
      const renderedStorageType = rustTypeFromCarrierInContext(storageCarrier, context);
      if (renderedStorageType === undefined) {
        diagnostics.push({
          code: "RUST_STRUCTURAL_SHAPE_FIELD_TYPE_MISSING",
          category: "error",
          source: "tsonic-rust",
          message: `Structural shape '${definition.targetName}' has a field without an exact renderable Rust carrier.`,
          evidence: ["target.capability=rust.backend.structural-shapes"],
        });
        return undefined;
      }
      if (field.storage === "stored") {
        const type = field.method === true
          ? structuralCallableAlias(
              callableAliases,
              `${definition.targetName}${rustPascalCaseIdentifier(field.sourceName)}Method`,
              typeParams,
              aliasTypeArguments,
              renderedStorageType,
            )
          : renderedStorageType;
        fields.push({
          name: field.targetName,
          type,
          visibility: "public",
        });
        continue;
      }
      if (field.method === true || field.property === undefined) {
        diagnostics.push({
          code: "RUST_STRUCTURAL_SHAPE_PROPERTY_STORAGE_INVALID",
          category: "error",
          source: "tsonic-rust",
          message: `Structural shape '${definition.targetName}' has contradictory property storage metadata.`,
          evidence: ["target.capability=rust.backend.structural-shapes.properties"],
        });
        return undefined;
      }
      const valueCarrier = rustStructuralPropertyValueCarrier(
        field.carrier,
        field.presence,
      );
      const storedCarrier = valueCarrier === undefined
        ? undefined
        : rustOptionTargetType(valueCarrier);
      const getterCarrier = rustStructuralPropertyGetterStorageCarrier(
        definition.carrier,
        field.carrier,
        field.presence,
      );
      const setterCarrier = field.readonly
        ? undefined
        : rustStructuralPropertySetterStorageCarrier(
            definition.carrier,
            field.carrier,
            field.presence,
          );
      const storedType = rustTypeFromCarrierInContext(storedCarrier, context);
      const getterType = rustTypeFromCarrierInContext(getterCarrier, context);
      const setterType = setterCarrier === undefined
        ? undefined
        : rustTypeFromCarrierInContext(setterCarrier, context);
      if (storedType === undefined || getterType === undefined ||
        (!field.readonly && setterType === undefined)) {
        diagnostics.push({
          code: "RUST_STRUCTURAL_SHAPE_PROPERTY_TYPE_MISSING",
          category: "error",
          source: "tsonic-rust",
          message: `Structural shape '${definition.targetName}' has property dispatch without exact renderable value and callable carriers.`,
          evidence: ["target.capability=rust.backend.structural-shapes.properties"],
        });
        return undefined;
      }
      usedAliases.add("rt");
      fields.push({
        name: field.targetName,
        type: storedType,
        visibility: "public",
      });
      const getterAlias = structuralCallableAlias(
        callableAliases,
        `${definition.targetName}${rustPascalCaseIdentifier(field.sourceName)}Getter`,
        typeParams,
        aliasTypeArguments,
        getterType,
      );
      fields.push({
        name: field.property.getterTargetName,
        type: getterAlias,
        visibility: "public",
      });
      if (field.property.setterTargetName !== undefined) {
        if (setterType === undefined) {
          diagnostics.push({
            code: "RUST_STRUCTURAL_SHAPE_PROPERTY_TYPE_MISSING",
            category: "error",
            source: "tsonic-rust",
            message: `Structural shape '${definition.targetName}' has writable property dispatch without one exact setter carrier.`,
            evidence: ["target.capability=rust.backend.structural-shapes.properties"],
          });
          return undefined;
        }
        const setterAlias = structuralCallableAlias(
          callableAliases,
          `${definition.targetName}${rustPascalCaseIdentifier(field.sourceName)}Setter`,
          typeParams,
          aliasTypeArguments,
          setterType,
        );
        fields.push({
          name: field.property.setterTargetName,
          type: setterAlias,
          visibility: "public",
        });
      }
    }
    structs.push(...callableAliases);
    structs.push({
      kind: "struct",
      name: definition.targetName,
      visibility: "public",
      attrs: [rustLintAttributes.deadCode],
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

function structuralCallableAlias(
  aliases: RustItem[],
  name: string,
  typeParams: readonly RustTypeParameter[],
  typeArguments: readonly RustType[],
  target: RustType,
): RustType {
  aliases.push({
    kind: "type-alias",
    name,
    visibility: "public",
    ...(typeParams.length === 0 ? {} : { typeParams }),
    target,
  });
  return {
    kind: "named",
    path: name,
    ...(typeArguments.length === 0 ? {} : { typeArguments }),
  };
}
