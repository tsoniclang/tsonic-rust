import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustPlanningContext } from "../context.js";
import { rustGenericsWithAssociatedBounds } from "../types/generic-bounds.js";
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
  rustCarrierSupportsTrait,
  rustStructuralObjectCarrierValue,
  rustLocationTargetType,
  rustProgramErrorTargetType,
  rustStructuralPropertyGetterStorageCarrier,
  rustStructuralPropertySetterStorageCarrier,
  rustStructuralPropertyValueCarrier,
  rustStructuralMethodStorageCarrier,
  rustCallableProtocol,
} from "../../../target-model/types/index.js";
import { rustLifetimeKey } from "../../../target-model/lifetimes/index.js";
import { rustLifetimeToAst } from "../types/lifetime-syntax.js";
import { rustAssociatedPredicates } from "../types/associated-bounds.js";
import { rustGenericRequirementBounds } from "../types/generic-bounds.js";
import { planRustNumberArrayUnionImplementation } from "./number-array-unions.js";
import { planRustConstructorShape } from "./constructor-shapes.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { substituteRustTargetTypeParameters } from "../../../target-model/types/carriers/substitution.js";
import { inferRustTargetTypeParameterBindings } from "../../../target-model/types/carriers/generic-inference.js";
import { rustTargetTypeParameterNames } from "../../../target-model/types/carriers/generic-references.js";

export function planRustStructuralShapeModule(
  input: RustPlanningContext,
  moduleNameByFileName: ReadonlyMap<string, string>,
  externalCrateNameByFileName: ReadonlyMap<string, string>,
  externalItemPathByIdentity: ReadonlyMap<string, string>,
  externalStructuralShapeModuleByFileName: ReadonlyMap<string, string>,
  crateName: string | undefined,
  structuralShapesModuleName: string,
  rootComponentId: string,
  programModuleName: string | undefined,
  publicShapeNames: ReadonlySet<string>,
  diagnostics: TargetDiagnostic[],
): RustSourceFileModel | undefined {
  const definitions = input.program.structuralShapes.definitions.filter((definition) =>
    definition.componentId === rootComponentId);
  const unions = input.program.structuralShapes.unionDefinitions.filter(definition => definition.componentId === rootComponentId);
  if (definitions.length === 0 && unions.length === 0) {
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
  for (const union of unions) {
    const visibility: RustVisibility = publicShapeNames.has(union.targetName) ? "public" : "crate";
    const deadCode = rustStructuralShapeDeadCodeDisposition(context, union.sourceCarriers, visibility === "public");
    structs.push({
      kind: "enum",
      name: union.targetName,
      visibility,
      derives: ["Clone"],
      ...(deadCode === undefined ? {} : { deadCode }),
      generics: {
        parameters: union.variantNames.map((_, index) => ({ kind: "type", name: `Payload${index}`, bounds: [] })),
        wherePredicates: [],
      },
      variants: union.variantNames.map((name, index) => ({ name, fields: [{ kind: "named", path: `Payload${index}` }] })),
    });
    if (union.numberArrayLike) {
      usedAliases.add("js_abi");
      structs.push(planRustNumberArrayUnionImplementation(union));
    }
  }
  for (const definition of definitions) {
    const visibility: RustVisibility = publicShapeNames.has(definition.targetName)
      ? "public"
      : "crate";
    const shapeDeadCode = rustStructuralShapeDeadCodeDisposition(
      context,
      definition.sourceCarriers,
      visibility === "public",
    );
    const requirements = input.program.declarationGenericRequirements.contractForCarrier(definition.carrier);
    if (requirements === undefined) throw new Error("A structural shape has no sealed generic requirements.");
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
            bounds: rustGenericRequirementBounds(requirements.typeParameters.find(candidate => candidate.name === parameter.name)!.requirements),
          });
    const generics: RustGenerics = rustGenericsWithAssociatedBounds(genericParameters,
      rustAssociatedPredicates(requirements.associatedTypes, context));
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
    if (definition.dispatchName !== undefined) {
      const error = rustTypeFromCarrierInContext(rustProgramErrorTargetType(), definitionContext);
      const type: RustType = { kind: "named", path: definition.targetName, genericArguments: aliasGenericArguments };
      const bases: TargetTypeRef[] = [];
      for (const view of input.program.classValues.instanceViews) {
        if (!definition.sourceCarriers.some(carrier => rustTargetTypeRefEquals(carrier, view.targetCarrier))) continue;
        const substitutions = inferRustTargetTypeParameterBindings(view.targetCarrier, definition.carrier,
          new Set(rustTargetTypeParameterNames(view.targetCarrier)));
        if (substitutions === undefined) return undefined;
        for (const base of view.bases) {
          const selected = substituteRustTargetTypeParameters(base, substitutions);
          if (!bases.some(candidate => rustTargetTypeRefEquals(candidate, selected))) bases.push(selected);
        }
      }
      const superTraits = bases.map(carrier => {
        const type = rustTypeFromCarrierInContext(carrier, definitionContext);
        const project = input.program.projectTypes.definitionForCarrier(carrier);
        return type?.kind !== "named" || project === undefined ? undefined : {
          ...type, path: `${type.path.slice(0, type.path.lastIndexOf("::") + 2)}${project.dispatchName}`,
        };
      });
      if (superTraits.some(type => type === undefined)) return undefined;
      const planned = error === undefined ? undefined : planRustConstructorShape(definition, generics, type, visibility,
        error, carrier => rustTypeFromCarrierInContext(carrier, definitionContext), superTraits as RustType[]);
      if (planned === undefined) {
        diagnostics.push({ code: "RUST_STRUCTURAL_CONSTRUCTOR_TYPE_MISSING", category: "error", source: "tsonic-rust",
          message: "A constructor interface requires exact native dispatch signatures and property storage.",
          evidence: ["target.capability=rust.class-value.constructor"] });
        return undefined;
      }
      usedAliases.add("rt");
      structs.push(...planned);
      continue;
    }
    const fields: RustStructField[] = [];
    const nativeCallableType = (carrier: import("../../../target-model/types/model.js").TargetTypeRef): RustType | undefined => {
      const protocol = rustCallableProtocol(carrier);
      const parameters = protocol?.parameters.map(parameter => rustTypeFromCarrierInContext(parameter, definitionContext));
      const result = protocol === undefined ? undefined : rustTypeFromCarrierInContext(protocol.result, definitionContext);
      const error = rustTypeFromCarrierInContext(rustProgramErrorTargetType(), definitionContext);
      return parameters === undefined || parameters.some(parameter => parameter === undefined) || result === undefined || error === undefined
        ? undefined : { kind: "function-pointer", parameters: parameters as readonly RustType[], result: {
          kind: "named", path: "Result", genericArguments: [{ kind: "type", type: result }, { kind: "type", type: error }],
        } };
    };
    for (const [storageIndex, field] of definition.fields.entries()) {
      const methodStorageCarrier = field.receiverIndependent === true ? field.carrier : field.method === true
        ? rustStructuralMethodStorageCarrier(
            definition.carrier,
            field.carrier,
            field.presence,
          )
        : undefined;
      const storageCarrier = field.method === true ? methodStorageCarrier
        : field.nativeLayout === undefined ? field.carrier : rustLocationTargetType(field.carrier);
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
      const renderedStorageType = field.nativeMethod === true ? nativeCallableType(field.carrier)
        : rustTypeFromCarrierInContext(storageCarrier, definitionContext);
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
      if (field.storage === "stored" || field.storage === "bound") {
        const errorType = field.storage === "bound"
          ? rustTypeFromCarrierInContext(rustProgramErrorTargetType(), definitionContext) : undefined;
        if (field.storage === "bound" && errorType === undefined) return undefined;
        if (field.storage === "bound") usedAliases.add("rt");
        const type = field.method === true && field.nativeMethod !== true
          ? structuralCallableAlias(
              callableAliases,
              `${definition.targetName}${rustPascalCaseIdentifier(field.sourceName)}Method`,
              generics,
              aliasGenericArguments,
              renderedStorageType,
              visibility,
            )
          : field.storage === "bound" ? {
            kind: "named" as const, path: "rt::RecordField", genericArguments: [
              { kind: "type" as const, type: renderedStorageType },
              { kind: "type" as const, type: errorType! },
            ],
          } : renderedStorageType;
        const deadCode = rustStructuralFieldDeadCodeDisposition(
          context,
          definition.sourceCarriers,
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
      if (field.method === true && field.receiverIndependent !== true || field.property === undefined) {
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
        definition.sourceCarriers,
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
        definition.sourceCarriers,
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
          definition.sourceCarriers,
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
    const valueRepresentation = rustStructuralObjectCarrierValue(definition.carrier)?.representation === "value";
    const defaultable = valueRepresentation && rustCarrierSupportsTrait(definition.carrier, "core::default::Default", () => true, undefined, context.input.program.typeDefinitions);
    const cloneable = valueRepresentation && rustCarrierSupportsTrait(definition.carrier, "core::clone::Clone", () => true, undefined, context.input.program.typeDefinitions);
    const copyable = valueRepresentation && rustCarrierSupportsTrait(definition.carrier, "core::marker::Copy", () => true, undefined, context.input.program.typeDefinitions);
    structs.push({
      kind: "struct",
      name: definition.targetName,
      visibility,
      ...(shapeDeadCode === undefined ? {} : { deadCode: shapeDeadCode }),
      derives: [...(cloneable ? ["Clone"] : []), ...(copyable ? ["Copy"] : []), ...(defaultable ? ["Default"] : [])],
      generics,
      fields,
    });
  }
  const uses: RustItem[] = [...usedAliases]
    .sort((left, right) => left.localeCompare(right, "en"))
    .flatMap((alias) => {
      const entry = alias === "rt" && programModuleName !== undefined
        ? { path: `crate::${programModuleName}`, alias }
        : rustRuntimeAliasImports.get(alias);
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
    generics: { parameters: generics.parameters.map(parameter => parameter.kind === "type"
      ? { ...parameter, bounds: [] } : parameter.kind === "lifetime" ? { ...parameter, outlives: [] } : parameter),
      wherePredicates: [],
    },
    target,
  });
  return {
    kind: "named",
    path: name,
    ...(genericArguments.length === 0 ? {} : { genericArguments }),
  };
}
