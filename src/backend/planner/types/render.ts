import type {
  RustTargetConstArgument,
  RustTargetGenericArgument,
  TargetTypeRef,
} from "../../../target-model/types/model.js";
import { registerAliasFromPath } from "../program/plan-context.js";
import type { RustSourcePackageErrorPlan } from "../../../target-model/records/error-regions.js";
import { collectAliasesFromRustType } from "./type-observations.js";
import type {
  RustCallGenericArgument,
  RustGenericArgument,
  RustConstArgument,
  RustLifetimeParameter,
  RustTraitReference,
  RustType,
} from "../../target-ast/syntax/nodes.js";
import {
  rustLifetimeKey,
  type RustLifetimeBinder,
  type RustLifetimeRef,
} from "../../../target-model/lifetimes/index.js";
import { rustSourceUnionCarrierValue } from "../../../target-model/types/index.js";
import { rustSourceTypePathInContext, rustStructuralTypePathInContext } from "./paths.js";
import { rustRuntimeUnionContract } from "../../../target-model/types/carriers/runtime-unions.js";
import { rustLifetimeToAst } from "./lifetime-syntax.js";
import { selectRustOptionalStorageTypeArguments } from "../../../analysis/declarations/type-projections.js";
import { rustCallableInputAbsenceWitness } from "../../../target-model/types/carriers/callable-input-witness.js";
import {
  rustBuiltInCarrierDefinitions,
  rustFixedArrayCarrierValue,
  rustNamedTypeCarrierValue,
  rustPrimitiveTypeName,
  substituteRustTargetGenerics,
  rustStringTargetId,
  rustStrTargetId,
  isRustNeverCarrier,
} from "../../../target-model/types/index.js";

import { selectRustNativeTypeCarrier, selectRustNativeCallTypeCarrier, rustNativeTypeSelectionInput, type RustNativeTypeInputContext, type RustNativeTypeSelectionInput } from "../../../policy/types/model/native-type-selection.js";
import { emptyRustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { rustSourceItemIdentity } from "../../../target-model/names/source-output-identities.js";

export const rustStrRefType: RustType = {
  kind: "reference",
  referent: { kind: "str" },
  mutable: false,
};

const standaloneNativeTypeInput: RustNativeTypeSelectionInput = Object.freeze({
  typeDefinitions: emptyRustTypeDefinitions,
  typeParameterNames: undefined,
  pathFor: () => undefined,
  additionalArgumentsFor: () => undefined,
  programErrorCarrier: () => undefined,
  producerErrorCarrier: () => undefined,
  nativeErrorJoinCarrier: () => undefined,
  structuralCarrier: () => undefined,
});

export function rustTypeFromCarrier(
  carrier: TargetTypeRef | undefined,
  input: RustNativeTypeSelectionInput = standaloneNativeTypeInput,
): RustType | undefined {
  if (carrier === undefined) return undefined;
  const selected = selectRustNativeTypeCarrier(carrier, input, "inferred-call");
  return selected.kind === "rejected" ? undefined : rustTypeFromSelectedNativeCarrier(selected.carrier);
}

export function rustReturnTypeFromCarrier(
  carrier: TargetTypeRef | undefined,
  input: RustNativeTypeSelectionInput = standaloneNativeTypeInput,
): RustType | undefined {
  if (carrier === undefined) return undefined;
  const selected = selectRustNativeTypeCarrier(carrier, input, "return");
  return selected.kind === "rejected" ? undefined : rustTypeFromSelectedNativeCarrier(selected.carrier);
}

export function rustTypeFromSelectedNativeCarrierInContext(
  carrier: TargetTypeRef,
  context: RustTypeRenderingContext,
): RustType {
  const rendered = rustTypeFromSelectedNativeCarrier(carrier);
  collectAliasesFromRustType(rendered, path => registerAliasFromPath(context, path));
  return rendered;
}

export function rustTypeFromSelectedNativeCarrier(carrier: TargetTypeRef): RustType {
  if (isRustNeverCarrier(carrier)) return { kind: "never" };
  if (carrier.kind === "source-primitive") {
    const name = rustPrimitiveTypeName(carrier.name);
    if (name === undefined) return failRustPlannerInvariant("A selected native primitive lost its exact Rust type.");
    return { kind: "primitive", name };
  }
  if (carrier.kind === "target-named" && carrier.id === rustStringTargetId) return { kind: "string" };
  if (carrier.kind === "target-named" && carrier.id === rustStrTargetId) return { kind: "str" };
  const named = rustNamedTypeCarrierValue(carrier);
  if (named !== undefined) {
    const genericArguments = selectedNativeGenericArguments(named.genericArguments.slice(0, named.nativeArgumentCount));
    return { kind: "named", path: named.path,
      ...(named.nativeErrorIdentity === undefined ? {} : { identity: named.nativeErrorIdentity }),
      ...(genericArguments.length === 0 ? {} : { genericArguments }) };
  }
  const fixed = rustFixedArrayCarrierValue(carrier);
  if (fixed !== undefined) return { kind: "fixed-array", element: rustTypeFromSelectedNativeCarrier(fixed.element),
    length: rustConstArgumentToAst(fixed.length) };
  switch (carrier.kind) {
    case "type-parameter": return { kind: "named", path: carrier.name };
    case "reference": return { kind: "reference", referent: rustTypeFromSelectedNativeCarrier(carrier.referent),
      mutable: carrier.mutable,
      ...(carrier.lifetime === undefined ? {} : { lifetime: rustLifetimeToAst(carrier.lifetime) }) };
    case "slice": return { kind: "slice", element: rustTypeFromSelectedNativeCarrier(carrier.element) };
    case "pointer": return { kind: "raw-pointer", pointee: rustTypeFromSelectedNativeCarrier(carrier.pointee),
      mutable: carrier.mutability === "mut" };
    case "tuple": return carrier.elements.length === 0 ? { kind: "unit" }
      : { kind: "tuple", elements: carrier.elements.map(rustTypeFromSelectedNativeCarrier) };
    case "function-pointer": return { kind: "function-pointer",
      parameters: carrier.args.map(rustTypeFromSelectedNativeCarrier),
      result: rustTypeFromSelectedNativeCarrier(carrier.result),
      ...(carrier.lifetimeBinder === undefined ? {} : { binder: rustLifetimeBinderToAst(carrier.lifetimeBinder) }),
      ...(carrier.abi === undefined ? {} : { abi: carrier.abi }),
      ...(carrier.isUnsafe === true ? { isUnsafe: true } : {}) };
    case "closure": {
      const result = rustTypeFromSelectedNativeCarrier(carrier.result);
      return { kind: "impl-trait", bounds: [{ kind: "callable", trait: carrier.callTrait ?? "Fn",
        binder: carrier.lifetimeBinder === undefined ? [] : rustLifetimeBinderToAst(carrier.lifetimeBinder),
        parameters: carrier.args.map(rustTypeFromSelectedNativeCarrier),
        result: carrier.fallible === true ? { kind: "named", path: "rt::TsonicResult",
          genericArguments: [{ kind: "type", type: result }] } : result }], outlives: [] };
    }
    case "trait-ref": return selectedNativeTrait(carrier).trait;
    case "trait-object": return { kind: "trait-object", principal: selectedNativeTrait(carrier.principal),
      autoTraits: carrier.autoTraits.map(selectedNativeTrait),
      ...(carrier.lifetime === undefined ? {} : { lifetime: rustLifetimeToAst(carrier.lifetime) }) };
    case "impl-trait": return { kind: "impl-trait",
      bounds: carrier.bounds.map(reference => ({ kind: "trait-type", reference: selectedNativeTrait(reference) })),
      outlives: carrier.outlives.map(rustLifetimeToAst),
      ...(carrier.captures === undefined ? {} : { captures: selectedNativeGenericArguments(carrier.captures) }) };
    case "associated-type": {
      const genericArguments = selectedNativeGenericArguments(carrier.genericArguments);
      return { kind: "qualified", owner: rustTypeFromSelectedNativeCarrier(carrier.owner),
        ...(carrier.trait === undefined ? {} : { trait: selectedNativeTrait(carrier.trait).trait }),
        member: carrier.name, ...(genericArguments.length === 0 ? {} : { genericArguments }) };
    }
    default: return failRustPlannerInvariant("An admitted native type lost its selected Rust syntax form.");
  }
}

function selectedNativeGenericArguments(
  arguments_: readonly RustTargetGenericArgument[] | undefined,
): readonly RustGenericArgument[] {
  return Object.freeze((arguments_ ?? []).map((argument): RustGenericArgument => argument.kind === "type"
    ? { kind: "type", type: rustTypeFromSelectedNativeCarrier(argument.type) }
    : argument.kind === "lifetime"
      ? { kind: "lifetime", lifetime: rustLifetimeToAst(argument.lifetime) }
      : { kind: "const", value: rustConstArgumentToAst(argument.value) }));
}

function selectedNativeTrait(
  carrier: Extract<TargetTypeRef, { readonly kind: "trait-ref" }>,
): RustTraitReference {
  const associated: RustGenericArgument[] = carrier.associatedConstraints.map(constraint => constraint.kind === "equality"
    ? { kind: "associated-equality", name: constraint.name,
        genericArguments: selectedNativeGenericArguments(constraint.genericArguments),
        type: rustTypeFromSelectedNativeCarrier(constraint.type) }
    : { kind: "associated-bounds", name: constraint.name,
        genericArguments: selectedNativeGenericArguments(constraint.genericArguments),
        bounds: [...constraint.traits.map(reference => ({ kind: "trait-type" as const, reference: selectedNativeTrait(reference) })),
          ...constraint.outlives.map(lifetime => ({ kind: "lifetime" as const, lifetime: rustLifetimeToAst(lifetime) }))] });
  const genericArguments = [...selectedNativeGenericArguments(carrier.genericArguments), ...associated];
  return { trait: { kind: "named", path: carrier.path,
    ...(genericArguments.length === 0 ? {} : { genericArguments }) },
    ...(carrier.lifetimeBinder === undefined ? {} : { binder: rustLifetimeBinderToAst(carrier.lifetimeBinder) }) };
}

export function isFloatCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "source-primitive" && (carrier.name === "float32" || carrier.name === "float64");
}

export interface RustTypeRenderingContext {
    readonly sourcePackageErrors: RustSourcePackageErrorPlan;
    readonly sourcePackageComponentId: string;
    readonly typeParameterNames?: ReadonlyMap<string, string>;
    readonly moduleName: string;
    readonly moduleNameByFileName: ReadonlyMap<string, string>;
    readonly externalCrateNameByFileName: ReadonlyMap<string, string>;
    readonly externalItemPathByIdentity: ReadonlyMap<string, string>;
    readonly externalStructuralShapeModuleByFileName: ReadonlyMap<string, string>;
    readonly crateName?: string;
    readonly structuralShapesModuleName: string;
    readonly usedAliases?: Set<string>;
    readonly typeParameterSubstitutions?: ReadonlyMap<string, TargetTypeRef>;
    readonly lifetimeSubstitutions?: ReadonlyMap<string, RustLifetimeRef>;
    readonly input: {
      readonly errorRegions: import("../program/error-regions.js").RustErrorRegionCatalog;
      readonly program: {
        readonly source: import("@tsonic/target-api/analysis").TargetSourceSyntaxProgram;
        readonly records: import("../../../target-model/records/program.js").RustProgramRecords;
        readonly errorRegions: import("../../../target-model/records/error-regions.js").RustErrorRegionRecords;
        readonly errorTransport: Pick<RustSourcePackageErrorPlan, "nativeBoundaryFor">;
        readonly sourcePackageFacades: { readonly nativeTypeItemFor: RustNativeTypeInputContext["nativeTypeItemFor"] };
        readonly typeDefinitions: import("../../../target-model/types/source-union-definitions.js").RustTypeDefinitions;
        readonly names: import("../../../target-model/names/model.js").RustNamePlan;
        readonly structuralShapes: import("../../../analysis/objects/structural-shape-plan.js").RustStructuralShapePlan;
        readonly sourceCallableSpecializations: import("../../../analysis/callables/specializations.js").RustSourceCallableSpecializationPlan;
        readonly callableValues: import("../../../analysis/callables/value-plan.js").RustCallableValuePlan;
        readonly classValues: import("../../../analysis/objects/class-values.js").RustClassValuePlan;
        readonly declarationGenericRequirements: import("../../../analysis/declarations/generic-requirements.js").RustDeclarationGenericRequirementIndex;
        readonly projectTypes: import("../../../target-model/types/project-types.js").RustProjectTypePolicy;
        readonly objectRepresentations: import("../../../analysis/project-types/object-representation.js").RustObjectRepresentationPlan;
        readonly typeFamilies: import("../../../target-model/types/type-families.js").RustSourceTypeFamilyPlan;
      };
    };
}

export function rustNativeTypeInputContextForRendering(
  context: RustTypeRenderingContext,
): RustNativeTypeInputContext {
  const program = context.input.program;
  return {
    moduleName: context.moduleName,
    crateName: context.crateName,
    moduleNameByFileName: context.moduleNameByFileName,
    externalCrateNameByFileName: context.externalCrateNameByFileName,
    externalPublicPathFor: (fileName, targetName) => context.externalItemPathByIdentity.get(rustSourceItemIdentity(fileName, targetName)),
    nativeTypeItemFor: (fileName, sourceName) => program.sourcePackageFacades.nativeTypeItemFor(fileName, sourceName),
    externalStructuralShapeModuleByFileName: context.externalStructuralShapeModuleByFileName,
    structuralShapesModuleName: context.structuralShapesModuleName,
    typeParameterNames: context.typeParameterNames,
    typeDefinitions: program.typeDefinitions,
    projectTypes: program.projectTypes,
    objectRepresentations: program.objectRepresentations,
    structuralShapes: program.structuralShapes,
    callableValues: program.callableValues,
    classValues: program.classValues,
    errorRegions: program.errorRegions,
    additionalArgumentsFor: (carrier, parameterIndexes) => selectRustOptionalStorageTypeArguments(carrier, {
      genericRequirements: program.declarationGenericRequirements,
      projectTypes: program.projectTypes,
      normalize: program.typeFamilies.normalize,
    }, parameterIndexes),
    programErrorBoundaryFor: owner => program.errorTransport === undefined ? undefined
      : program.errorTransport.nativeBoundaryFor(context.sourcePackageComponentId, owner),
  };
}

export function rustTypeFromCarrierInContext(
  carrier: TargetTypeRef | undefined,
  context: RustTypeRenderingContext,
  position: "general" | "parameter" | "return" | "inferred-call" | "absence" = "general",
): RustType | undefined {
  if (carrier === undefined) return undefined;
  const instantiated = context.typeParameterSubstitutions === undefined && context.lifetimeSubstitutions === undefined
    ? carrier : substituteRustTargetGenerics(carrier, context.typeParameterSubstitutions ?? new Map(),
      context.lifetimeSubstitutions ?? new Map());
  const selectedCarrier = position === "absence" ? rustCallableInputAbsenceWitness(instantiated) : instantiated;
  if (selectedCarrier === undefined) return undefined;
  const input = rustNativeTypeSelectionInput(rustNativeTypeInputContextForRendering(context));
  const selected = position === "inferred-call" ? selectRustNativeCallTypeCarrier(selectedCarrier, input)
    : selectRustNativeTypeCarrier(selectedCarrier, input, position === "absence" ? "general" : position);
  if (selected.kind === "rejected") return undefined;
  if (selected.kind === "inferred") return { kind: "infer" };
  const rendered = rustTypeFromSelectedNativeCarrier(selected.carrier);
  collectAliasesFromRustType(rendered, path => registerAliasFromPath(context, path));
  return rendered;
}

export function rustParameterTypeFromCarrierInContext(
  carrier: TargetTypeRef | undefined,
  context: RustTypeRenderingContext,
): RustType | undefined {
  return rustTypeFromCarrierInContext(carrier, context, "parameter");
}

export function rustUnionTypePathInContext(carrier: TargetTypeRef, context: RustTypeRenderingContext): string | undefined {
  const union = rustSourceUnionCarrierValue(carrier);
  const path = union !== undefined
    ? union.origin === "generated" ? rustStructuralTypePathInContext(carrier, context) : rustSourceTypePathInContext(union, context)
    : carrier.kind === "target-named" && rustRuntimeUnionContract(carrier) !== undefined ? rustBuiltInCarrierDefinitions[carrier.id]?.renderPath : undefined;
  if (path !== undefined) registerAliasFromPath(context, path);
  return path;
}

export function rustReturnTypeFromCarrierInContext(
  carrier: TargetTypeRef | undefined,
  context: RustTypeRenderingContext,
): RustType | undefined {
  return isRustNeverCarrier(carrier)
    ? { kind: "never" }
    : rustTypeFromCarrierInContext(carrier, context, "return");
}

export function rustTargetGenericArgumentToAstInContext(
  argument: RustTargetGenericArgument,
  context: RustTypeRenderingContext,
): RustGenericArgument | undefined {
  switch (argument.kind) {
    case "lifetime":
      return {
        kind: "lifetime",
        lifetime: rustLifetimeToAst(
          context.lifetimeSubstitutions?.get(rustLifetimeKey(argument.lifetime)) ??
            argument.lifetime,
        ),
      };
    case "const":
      return { kind: "const", value: rustConstArgumentToAst(argument.value) };
    case "type": {
      const type = rustTypeFromCarrierInContext(argument.type, context);
      return type === undefined ? undefined : { kind: "type", type };
    }
  }
}

export function rustTargetCallGenericArgumentToAstInContext(
  argument: Extract<RustTargetGenericArgument, { readonly kind: "type" | "const" }>,
  context: RustTypeRenderingContext,
): RustCallGenericArgument | undefined {
  if (argument.kind === "type") {
    const type = rustCallTypeFromCarrierInContext(argument.type, context);
    return type === undefined ? undefined : { kind: "type", type };
  }
  const rendered = rustTargetGenericArgumentToAstInContext(argument, context);
  return rendered?.kind === "type" || rendered?.kind === "const"
    ? rendered
    : undefined;
}

export function rustCallTypeFromCarrierInContext(
  carrier: TargetTypeRef,
  context: RustTypeRenderingContext,
): RustType | undefined {
  return rustTypeFromCarrierInContext(carrier, context, "inferred-call");
}

export function rustLifetimeBinderToAst(
  binder: RustLifetimeBinder,
): readonly RustLifetimeParameter[] {
  return Object.freeze(binder.parameters.map((parameter) => ({
    kind: "lifetime" as const,
    name: parameter.lifetime.name,
    outlives: Object.freeze(parameter.outlives.map(rustLifetimeToAst)),
  })));
}

export function rustConstArgumentToAst(value: RustTargetConstArgument): RustConstArgument {
  switch (value.kind) {
    case "integer":
      return { kind: "integer", value: BigInt(value.value) };
    case "boolean":
    case "char":
      return value;
    case "parameter":
      return { kind: "path", path: value.name };
    case "infer":
      return value;
  }
}
