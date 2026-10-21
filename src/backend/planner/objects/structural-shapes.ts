import { rustDeriveAttributes } from "../../target-ast/syntax/attributes.js";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustPlanningContext } from "../context.js";
import { createRustSourceFile, emptyRustGenerics } from "../../target-ast/syntax/nodes.js";
import type { RustItem, RustGenericArgument, RustGenerics, RustSourceFileModel, RustStructField, RustType, RustVisibility } from "../../target-ast/syntax/nodes.js";
import { rustRuntimeAliasImports } from "../program/plan-context.js";
import { rustStructuralFieldDeadCodeDisposition, rustStructuralShapeDeadCodeDisposition, rustGeneratedUnionVariantDeadCodeDisposition } from "../program/reachability-directives.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustProgramErrorTargetType } from "../../../target-model/types/index.js";
import { rustLifetimeKey } from "../../../target-model/lifetimes/index.js";
import { rustLifetimeToAst } from "../types/lifetime-syntax.js";
import { rustStructuralShapeGenerics, rustStructuralShapeContext } from "./structural-generics.js";
import { planRustNumberArrayUnionImplementation } from "./number-array-unions.js";
import { planRustConstructorShape } from "./constructor-shapes.js";
import type { RustSourcePackageErrorPlan } from "../../../target-model/records/source-package-errors.js";
import { planRustSourceUnionPayloadTemplate } from "../types/source-union-payloads.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export function planRustStructuralShapeModule(
  input: RustPlanningContext,
  moduleNameByFileName: ReadonlyMap<string, string>,
  externalCrateNameByFileName: ReadonlyMap<string, string>,
  externalItemPathByIdentity: ReadonlyMap<string, string>,
  externalStructuralShapeModuleByFileName: ReadonlyMap<string, string>,
  crateName: string | undefined,
  structuralShapesModuleName: string,
  rootComponentId: string,
  sourcePackageErrors: RustSourcePackageErrorPlan,
  programModuleName: string | undefined,
  publicShapeNames: ReadonlySet<string>,
  _diagnostics: TargetDiagnostic[],
): RustSourceFileModel | undefined {
  const definitions = input.program.records.structuralDeclarations.get(rootComponentId) ?? [];
  const unions = input.program.records.sourceUnionDeclarations.get(rootComponentId) ?? [];
  if (definitions.length === 0 && unions.length === 0) return undefined;
  const usedAliases = new Set<string>();
  const context = { input, sourcePackageErrors, sourcePackageComponentId: rootComponentId,
    moduleName: structuralShapesModuleName, moduleNameByFileName, externalCrateNameByFileName,
    externalItemPathByIdentity, externalStructuralShapeModuleByFileName,
    ...(crateName === undefined ? {} : { crateName }), structuralShapesModuleName, usedAliases };
  const structs: RustItem[] = [];
  for (const union of unions) {
    const visibility: RustVisibility = publicShapeNames.has(union.targetName) ? "public" : "crate";
    const deadCode = rustStructuralShapeDeadCodeDisposition(context, union.sourceCarriers, visibility === "public");
    const payloadPlan = planRustSourceUnionPayloadTemplate(union.payloadTemplate, emptyRustGenerics,
      carrier => rustTypeFromCarrierInContext(carrier, context));
    if (payloadPlan === undefined) failRustPlannerInvariant("An admitted source union requires its native payload template.");
    structs.push({ kind: "enum", name: union.targetName, visibility, attrs: rustDeriveAttributes(["Clone"]),
      ...(deadCode === undefined ? {} : { deadCode }), generics: payloadPlan.generics,
      variants: payloadPlan.variants.map(variant => {
        const disposition = rustGeneratedUnionVariantDeadCodeDisposition(context, union.sourceCarriers, variant.name, visibility === "public");
        return { ...variant, ...(disposition === undefined ? {} : { deadCode: disposition }) };
      }) });
    if (union.numberArrayLike) { usedAliases.add("js_abi"); structs.push(planRustNumberArrayUnionImplementation(union)); }
  }
  for (const definition of definitions) {
    const selected = input.program.records.structuralShapeEmission.get(definition);
    if (selected === undefined) failRustPlannerInvariant("A structural shape requires its sealed native emission plan.");
    const visibility: RustVisibility = publicShapeNames.has(definition.targetName) ? "public" : "crate";
    const shapeDeadCode = rustStructuralShapeDeadCodeDisposition(context, definition.sourceCarriers, visibility === "public");
    const scope = rustStructuralShapeContext(definition, context);
    const generics = rustStructuralShapeGenerics(definition, scope);
    const aliasGenericArguments: readonly RustGenericArgument[] = definition.genericParameters.map(parameter =>
      parameter.kind === "lifetime" ? { kind: "lifetime", lifetime: rustLifetimeToAst(parameter.lifetime) }
        : { kind: "type", type: { kind: "named", path: scope.typeParameterNames.get(parameter.identity) ?? parameter.name } });
    const definitionContext = { ...scope, lifetimeSubstitutions: new Map(definition.genericParameters.flatMap(parameter =>
      parameter.kind === "lifetime" ? [[rustLifetimeKey(parameter.lifetime), parameter.lifetime] as const] : [])) };
    const callableAliases: RustItem[] = [];
    if (selected.dispatch !== undefined) {
      const error = rustTypeFromCarrierInContext(rustProgramErrorTargetType(), definitionContext);
      if (error === undefined) failRustPlannerInvariant("A constructor shape requires its admitted native error carrier.");
      const type: RustType = { kind: "named", path: definition.targetName, genericArguments: aliasGenericArguments };
      const superTraits: RustType[] = selected.bases.map(carrier => {
        const rendered = rustTypeFromCarrierInContext(carrier, definitionContext);
        const project = input.program.records.projectType.get(carrier);
        if (rendered?.kind !== "named" || project === undefined) failRustPlannerInvariant("A constructor shape requires its admitted native supertrait.");
        return { ...rendered, path: rendered.path.slice(0, rendered.path.lastIndexOf("::") + 2) + project.dispatchName };
      });
      const planned = planRustConstructorShape(definition, selected.dispatch, generics, type, visibility, error,
        carrier => rustTypeFromCarrierInContext(carrier, definitionContext), superTraits,
        (index, role) => rustStructuralFieldDeadCodeDisposition(context, definition.sourceCarriers, index, visibility === "public", role));
      if (planned === undefined) failRustPlannerInvariant("A constructor shape requires its admitted native signatures and storage.");
      usedAliases.add("rt");
      structs.push(...planned);
      continue;
    }
    const fields: RustStructField[] = [];
    for (const [storageIndex, emitted] of selected.fields.entries()) {
      const { field } = emitted;
      const renderedStorageType = rustTypeFromCarrierInContext(emitted.carrier, definitionContext);
      if (renderedStorageType === undefined) failRustPlannerInvariant("An admitted structural field requires its exact native storage type.");
      if (emitted.property === undefined) {
        const type = emitted.methodAlias === undefined ? renderedStorageType : structuralCallableAlias(callableAliases,
          emitted.methodAlias, generics, aliasGenericArguments, renderedStorageType, visibility);
        const deadCode = rustStructuralFieldDeadCodeDisposition(context, definition.sourceCarriers, storageIndex, visibility === "public", "value");
        fields.push({ name: field.targetName, type, visibility: "public", ...(deadCode === undefined ? {} : { deadCode }) });
        continue;
      }
      const property = field.property;
      if (property === undefined) failRustPlannerInvariant("An admitted structural property requires its exact native accessor slots.");
      const storedType = rustTypeFromCarrierInContext(emitted.property.stored, definitionContext);
      const getterType = rustTypeFromCarrierInContext(emitted.property.getter, definitionContext);
      const setterType = emitted.property.setter === undefined ? undefined : rustTypeFromCarrierInContext(emitted.property.setter, definitionContext);
      if (storedType === undefined || getterType === undefined || emitted.property.setter !== undefined && setterType === undefined)
        failRustPlannerInvariant("An admitted structural property requires its exact native value and callable types.");
      usedAliases.add("rt");
      const storedDeadCode = rustStructuralFieldDeadCodeDisposition(context, definition.sourceCarriers, storageIndex, visibility === "public", "value");
      fields.push({ name: field.targetName, type: storedType, visibility: "public", ...(storedDeadCode === undefined ? {} : { deadCode: storedDeadCode }) });
      const getterAlias = structuralCallableAlias(callableAliases, emitted.property.getterAlias, generics, aliasGenericArguments, getterType, visibility);
      const getterDeadCode = rustStructuralFieldDeadCodeDisposition(context, definition.sourceCarriers, storageIndex, visibility === "public", "getter");
      fields.push({ name: property.getterTargetName, type: getterAlias, visibility: "public", ...(getterDeadCode === undefined ? {} : { deadCode: getterDeadCode }) });
      if (property.setterTargetName !== undefined) {
        if (setterType === undefined) failRustPlannerInvariant("A writable structural property requires its admitted native setter type.");
        const setterAlias = structuralCallableAlias(callableAliases, emitted.property.setterAlias, generics, aliasGenericArguments, setterType, visibility);
        const setterDeadCode = rustStructuralFieldDeadCodeDisposition(context, definition.sourceCarriers, storageIndex, visibility === "public", "setter");
        fields.push({ name: property.setterTargetName, type: setterAlias, visibility: "public", ...(setterDeadCode === undefined ? {} : { deadCode: setterDeadCode }) });
      }
    }
    structs.push(...callableAliases, { kind: "struct", name: definition.targetName, visibility,
      ...(shapeDeadCode === undefined ? {} : { deadCode: shapeDeadCode }), attrs: rustDeriveAttributes(selected.derives), generics, fields });
  }
  const uses: RustItem[] = [...usedAliases].sort((left, right) => left.localeCompare(right, "en")).flatMap(alias => {
    const entry = alias === "rt" && programModuleName !== undefined ? { path: `crate::${programModuleName}`, alias } : rustRuntimeAliasImports.get(alias);
    return entry === undefined ? [] : [{ kind: "use" as const, path: entry.path, alias: entry.alias }];
  });
  return createRustSourceFile([...uses, ...structs]);
}

function structuralCallableAlias(
  aliases: RustItem[], name: string, generics: RustGenerics,
  genericArguments: readonly RustGenericArgument[], target: RustType, visibility: RustVisibility,
): RustType {
  aliases.push({ kind: "type-alias", name, visibility, generics: { parameters: generics.parameters.map(parameter =>
    parameter.kind === "type" ? { ...parameter, bounds: [] } : parameter.kind === "lifetime" ? { ...parameter, outlives: [] } : parameter), wherePredicates: [] }, target });
  return { kind: "named", path: name, ...(genericArguments.length === 0 ? {} : { genericArguments }) };
}
