import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustPlanningContext } from "../context.js";
import {
  createRustSourceFile,
} from "../../target-ast/nodes.js";
import type {
  RustItem,
  RustGenericArgument,
  RustGenericParameter,
  RustGenerics,
  RustSourceFileModel,
  RustStructField,
  RustType,
  RustVisibility,
} from "../../target-ast/nodes.js";
import { rustPascalCaseIdentifier } from "../../../target-model/names/identifiers.js";
import {
  rustRuntimeAliasImports,
} from "../program/plan-context.js";
import {
  rustStructuralFieldDeadCodeDisposition,
  rustStructuralShapeDeadCodeDisposition,
} from "../liveness/directives.js";
import {
  rustTypeFromCarrierInContext,
} from "../types/render.js";
import {
  rustOptionTargetType,
  rustStructuralPropertyGetterStorageCarrier,
  rustStructuralPropertySetterStorageCarrier,
  rustStructuralPropertyValueCarrier,
  rustStructuralMethodStorageCarrier,
} from "../../../target-model/types/index.js";
import { rustLifetimeKey } from "../../../target-model/lifetimes/index.js";
import { rustLifetimeToAst } from "../types/lifetime-syntax.js";

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
    const shapeDeadCode = rustStructuralShapeDeadCodeDisposition(
      context,
      definition.carrier,
      visibility === "public",
    );
    const genericParameters: readonly RustGenericParameter[] = definition.genericParameters.map((parameter) =>
      parameter.kind === "lifetime"
        ? {
            kind: "lifetime",
            name: parameter.lifetime.name,
            outlives: [],
          }
        : {
            kind: "type",
            name: parameter.name,
            bounds: [],
          });
    const generics: RustGenerics = {
      parameters: genericParameters,
      wherePredicates: [],
    };
    const aliasGenericArguments: readonly RustGenericArgument[] = definition.genericParameters.map((parameter) =>
      parameter.kind === "lifetime"
        ? { kind: "lifetime", lifetime: rustLifetimeToAst(parameter.lifetime) }
        : { kind: "type", type: { kind: "named", path: parameter.name } });
    const definitionContext = {
      ...context,
      lifetimeSubstitutions: new Map(definition.genericParameters.flatMap((parameter) =>
        parameter.kind === "lifetime"
          ? [[rustLifetimeKey(parameter.lifetime), parameter.lifetime] as const]
          : [])),
    };
    const callableAliases: RustItem[] = [];
    const fields: RustStructField[] = [];
    for (const [storageIndex, field] of definition.fields.entries()) {
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
      const renderedStorageType = rustTypeFromCarrierInContext(storageCarrier, definitionContext);
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
              aliasGenericArguments,
              renderedStorageType,
              visibility,
            )
          : renderedStorageType;
        const deadCode = rustStructuralFieldDeadCodeDisposition(
          context,
          definition.carrier,
          storageIndex,
          visibility === "public",
          "value",
        );
        fields.push({
          name: field.targetName,
          type,
          visibility: "public",
          ...(deadCode === undefined ? {} : { deadCode }),
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
      const storedType = rustTypeFromCarrierInContext(storedCarrier, definitionContext);
      const getterType = rustTypeFromCarrierInContext(getterCarrier, definitionContext);
      const setterType = setterCarrier === undefined
        ? undefined
        : rustTypeFromCarrierInContext(setterCarrier, definitionContext);
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
      const storedDeadCode = rustStructuralFieldDeadCodeDisposition(
        context,
        definition.carrier,
        storageIndex,
        visibility === "public",
        "value",
      );
      fields.push({
        name: field.targetName,
        type: storedType,
        visibility: "public",
        ...(storedDeadCode === undefined ? {} : { deadCode: storedDeadCode }),
      });
      const getterAlias = structuralCallableAlias(
        callableAliases,
        `${definition.targetName}${rustPascalCaseIdentifier(field.sourceName)}Getter`,
        generics,
        aliasGenericArguments,
        getterType,
        visibility,
      );
      const getterDeadCode = rustStructuralFieldDeadCodeDisposition(
        context,
        definition.carrier,
        storageIndex,
        visibility === "public",
        "getter",
      );
      fields.push({
        name: field.property.getterTargetName,
        type: getterAlias,
        visibility: "public",
        ...(getterDeadCode === undefined ? {} : { deadCode: getterDeadCode }),
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
          aliasGenericArguments,
          setterType,
          visibility,
        );
        const setterDeadCode = rustStructuralFieldDeadCodeDisposition(
          context,
          definition.carrier,
          storageIndex,
          visibility === "public",
          "setter",
        );
        fields.push({
          name: field.property.setterTargetName,
          type: setterAlias,
          visibility: "public",
          ...(setterDeadCode === undefined ? {} : { deadCode: setterDeadCode }),
        });
      }
    }
    structs.push(...callableAliases);
    structs.push({
      kind: "struct",
      name: definition.targetName,
      visibility,
      ...(shapeDeadCode === undefined ? {} : { deadCode: shapeDeadCode }),
      derives: [],
      generics,
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
    ...(genericArguments.length === 0 ? {} : { genericArguments }),
  };
}
