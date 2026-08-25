import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustPlanningContext } from "../context.js";
import {
  createRustSourceFile,
} from "../../target-ast/nodes.js";
import type {
  RustItem,
  RustSourceFileModel,
  RustStructField,
  RustType,
  RustGenericArgument,
  RustGenerics,
  RustVisibility,
} from "../../target-ast/nodes.js";
import { rustLintAttributes } from "../../target-ast/normalization/lint-policy.js";
import { rustPascalCaseIdentifier } from "../../../target-model/names/identifiers.js";
import {
  rustRuntimeAliasImports,
} from "../program/plan-context.js";
import {
  rustTypeFromCarrierInContext,
  rustAstGenericArgumentFromSemanticInContext,
  rustAstGenericsFromSemanticInContext,
} from "../types/render.js";
import {
  rustOptionTargetType,
  rustStructuralPropertyGetterStorageCarrier,
  rustStructuralPropertySetterStorageCarrier,
  rustStructuralPropertyValueCarrier,
  rustStructuralMethodStorageCarrier,
} from "../../../target-model/types/index.js";

export function planRustStructuralShapeModule(
  input: RustPlanningContext,
  moduleNameByFileName: ReadonlyMap<string, string>,
  externalCrateNameByFileName: ReadonlyMap<string, string>,
  externalItemPathByIdentity: ReadonlyMap<string, string>,
  externalStructuralShapeModuleByFileName: ReadonlyMap<string, string>,
  crateName: string | undefined,
  structuralShapesModuleName: string,
  rootComponentId: string,
  publicShapeNames: ReadonlySet<string>,
  diagnostics: TargetDiagnostic[],
): RustSourceFileModel | undefined {
  const definitions = input.program.structuralShapes.definitions.filter((definition) =>
    definition.componentId === rootComponentId);
  if (definitions.length === 0) {
    return undefined;
  }
  const usedAliases = new Set<string>();
  const context = {
    input,
    moduleName: structuralShapesModuleName,
    moduleNameByFileName,
    externalCrateNameByFileName,
    externalItemPathByIdentity,
    externalStructuralShapeModuleByFileName,
    ...(crateName === undefined ? {} : { crateName }),
    structuralShapesModuleName,
    usedAliases,
  };
  const structs: RustItem[] = [];
  for (const definition of definitions) {
    const visibility: RustVisibility = publicShapeNames.has(definition.targetName)
      ? "public"
      : "crate";
    const generics = rustAstGenericsFromSemanticInContext(definition.generics, context);
    const aliasGenericArguments = definition.genericArguments.map((argument) =>
      rustAstGenericArgumentFromSemanticInContext(argument, context));
    if (generics === undefined || aliasGenericArguments.some((argument) => argument === undefined)) {
      diagnostics.push({
        code: "RUST_STRUCTURAL_SHAPE_GENERICS_MISSING",
        category: "error",
        source: "tsonic-rust",
        message: `Structural shape '${definition.targetName}' has no exact renderable mixed-generic contract.`,
        evidence: ["target.capability=rust.backend.structural-shapes.generics"],
      });
      return undefined;
    }
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
              generics,
              aliasGenericArguments as readonly RustGenericArgument[],
              renderedStorageType,
              visibility,
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
        generics,
        aliasGenericArguments as readonly RustGenericArgument[],
        getterType,
        visibility,
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
          generics,
          aliasGenericArguments as readonly RustGenericArgument[],
          setterType,
          visibility,
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
      visibility,
      attrs: [rustLintAttributes.deadCode],
      generics,
      fields: { kind: "named", fields },
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
  generics: RustGenerics,
  genericArguments: readonly RustGenericArgument[],
  target: RustType,
  visibility: RustVisibility,
): RustType {
  aliases.push({
    kind: "type-alias",
    name,
    visibility,
    generics,
    target,
  });
  return {
    kind: "named",
    path: name,
    ...(genericArguments.length === 0
      ? {}
      : { genericArguments }),
  };
}
