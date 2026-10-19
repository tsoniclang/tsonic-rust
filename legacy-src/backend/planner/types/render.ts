import type {
  RustTargetConstArgument,
  RustProgramErrorOwner,
  RustTargetGenericArgument,
  TargetTypeRef,
} from "../../../target-model/types/model.js";
import { registerAliasFromPath, rustCurrentErrorBoundary, rustErrorType } from "../program/plan-context.js";
import type { RustSourcePackageErrorPlan } from "../program/source-package-errors.js";
import { resolveRustPhysicalProgramErrorBoundary } from "../program/source-package-errors.js";
import { rustProgramErrorOwner } from "../../../target-model/types/carriers/program-errors.js";
import { rustTypeIsLegalInPosition, rustTypeContainsImplTrait, collectAliasesFromRustType } from "./type-observations.js";
import type {
  RustCallGenericArgument,
  RustGenericArgument,
  RustConstArgument,
  RustLifetimeParameter,
  RustTraitReference,
  RustType,
  RustTypeBound,
} from "../../target-ast/syntax/nodes.js";
import {
  rustLifetimeKey,
  type RustLifetimeBinder,
  type RustLifetimeRef,
} from "../../../target-model/lifetimes/index.js";
import {
  rustSourceTypeCarrierValue,
  rustSourceUnionCarrierValue,
  rustStructuralObjectCarrierValue,
} from "../../../target-model/types/index.js";
import { rustSourceTypePathInContext, rustStructuralTypePathInContext } from "./paths.js";
import { rustExplicitNamedTypeArguments } from "./generic-defaults.js";
import { rustGenericCallableValue } from "../../../target-model/types/carriers/generic-callables.js";
import { rustGenericCallableStorageArguments } from "../../../target-model/types/carriers/generic-callable-storage.js";
import { rustFrameCallableValue } from "../../../target-model/types/carriers/frame-callables.js";
import { rustFrameCallableTypes } from "./frame-callables.js";
import { rustClassConstructorInstance } from "../../../target-model/types/carriers/class-constructors.js";
import { rustProducerErrorReference, type RustProducerErrorReference } from "../../../target-model/types/carriers/producer-errors.js";
import { rustNativeErrorJoinReference, type RustNativeErrorJoinReference } from "../../../target-model/types/native-error-joins.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";
import { rustRuntimeUnionContract } from "../../../target-model/types/carriers/runtime-unions.js";
import { rustClassEnvironmentHandleType } from "../objects/class-environment-types.js";
import { rustLifetimeToAst } from "./lifetime-syntax.js";
import { rustOptionalStorageTypeArguments } from "./type-projections.js";
import { bindRustCallableInputLifetimes } from "../../../target-model/types/carriers/callable-input-lifetimes.js";
import { rustCallableInputAbsenceWitness } from "../../../target-model/types/carriers/callable-input-witness.js";
import {
  rustBuiltInCarrierDefinitions,
  rustCallableTargetId,
  rustCallableInputTargetId,
  rustFixedArrayCarrierValue,
  rustNamedTypeCarrierValue,
  rustPrimitiveTypeName,
  substituteRustTargetGenerics,
  rustStringTargetId,
  rustStrTargetId,
  isRustNeverCarrier,
  isRustAbsenceCarrier,
  rustOnlyTypeGenericArguments,
  rustFutureTargetId,
  rustJsPromiseTargetId,
  rustUnitTargetType,
  rustProgramErrorTargetId,
} from "../../../target-model/types/index.js";

import { rustSourceUnionPayloadArguments, type RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";

export const rustStrRefType: RustType = {
  kind: "reference",
  referent: { kind: "str" },
  mutable: false,
};

interface RustSourceTypeRendering {
  readonly typeDefinitions: RustTypeDefinitions;
  readonly typeParameterNames?: ReadonlyMap<string, string>;
  readonly pathFor: (value: { readonly fileName: string; readonly typeName: string }) => string | undefined;
  readonly additionalArgumentsFor: (carrier: TargetTypeRef) => readonly RustGenericArgument[];
  readonly programErrorType?: (owner: RustProgramErrorOwner) => RustType | undefined;
  readonly producerErrorType?: (reference: RustProducerErrorReference) => RustType | undefined;
  readonly nativeErrorJoinType?: (reference: RustNativeErrorJoinReference) => RustType | undefined;
}

export function rustTypeFromCarrier(
  carrier: TargetTypeRef | undefined,
  resolveSourceTypePath?: RustSourceTypeRendering,
  resolveStructuralShape?: (carrier: TargetTypeRef) => RustType | undefined,
): RustType | undefined {
  if (carrier === undefined) {
    return undefined;
  }
  const producerError = rustProducerErrorReference(carrier);
  if (producerError !== undefined) return resolveSourceTypePath?.producerErrorType?.(producerError);
  const joinedError = rustNativeErrorJoinReference(carrier);
  if (joinedError !== undefined) return resolveSourceTypePath?.nativeErrorJoinType?.(joinedError);
  if (carrier.kind === "trait-ref") {
    const reference = rustTraitReferenceFromCarrier(carrier, resolveSourceTypePath, resolveStructuralShape);
    return (reference?.binder?.length ?? 0) === 0 ? reference?.trait : undefined;
  }
  if (isRustNeverCarrier(carrier)) {
    return { kind: "named", path: "core::convert::Infallible" };
  }
  if (isRustAbsenceCarrier(carrier)) {
    return { kind: "unit" };
  }
  if (carrier.kind === "source-primitive") {
    const name = rustPrimitiveTypeName(carrier.name);
    return name === undefined ? undefined : { kind: "primitive", name };
  }
  if (carrier.kind === "target-named" && carrier.id === rustStringTargetId) {
    return { kind: "string" };
  }
  if (carrier.kind === "target-named" && carrier.id === rustStrTargetId) {
    return { kind: "str" };
  }
  if (carrier.kind === "target-named" &&
    (carrier.id === rustCallableTargetId || carrier.id === rustCallableInputTargetId)) {
    const lifetime = carrier.id === rustCallableTargetId ? carrier.genericArguments?.[0] : undefined;
    if (carrier.id === rustCallableTargetId && lifetime?.kind !== "lifetime") return undefined;
    const callableTypeArguments = rustOnlyTypeGenericArguments(lifetime === undefined ? carrier.genericArguments : carrier.genericArguments?.slice(1));
    const [argumentsCarrier, resultCarrier, errorCarrier] = callableTypeArguments ?? [];
    if (callableTypeArguments?.length !== (lifetime === undefined ? 2 : 3) || argumentsCarrier?.kind !== "tuple" ||
      resultCarrier === undefined) {
      return undefined;
    }
    const signature = carrier.id === rustCallableInputTargetId
      ? bindRustCallableInputLifetimes(argumentsCarrier.elements, resultCarrier) : undefined;
    if (carrier.id === rustCallableInputTargetId && signature === undefined) return undefined;
    const argumentsType = rustTypeFromCarrier(signature === undefined ? argumentsCarrier :
      { kind: "tuple", elements: signature.parameters }, resolveSourceTypePath, resolveStructuralShape);
    const resultType = rustTypeFromCarrier(signature?.result ?? resultCarrier, resolveSourceTypePath, resolveStructuralShape);
    const packageResult = rustProgramErrorOwner(errorCarrier)?.kind === "logical";
    const errorType = errorCarrier === undefined || packageResult ? undefined
      : rustTypeFromCarrier(errorCarrier, resolveSourceTypePath, resolveStructuralShape);
    if (carrier.id === rustCallableInputTargetId) {
      return argumentsType === undefined || resultType === undefined ? undefined : {
        kind: "impl-trait",
        bounds: [{ kind: "trait-type", reference: {
          trait: { kind: "named", path: "rt::CallableImplementation", genericArguments: [
            { kind: "type", type: argumentsType },
            { kind: "associated-equality", name: "Output", genericArguments: [],
              type: { kind: "named", path: "rt::TsonicResult", genericArguments: typeGenericArguments([resultType]) } },
          ] },
          binder: rustLifetimeBinderToAst(signature!.binder),
        } }],
        outlives: [],
      };
    }
    return argumentsType === undefined || resultType === undefined || !packageResult && errorType === undefined || lifetime?.kind !== "lifetime"
      ? undefined
      : {
          kind: "named",
          path: "rt::Callable",
          genericArguments: [{ kind: "lifetime", lifetime: rustLifetimeToAst(lifetime.lifetime) }, ...typeGenericArguments([
            argumentsType,
            {
              kind: "named",
              path: packageResult ? "rt::TsonicResult" : "Result",
              genericArguments: typeGenericArguments(packageResult ? [resultType] : [resultType, errorType!]),
            },
          ])],
        };
  }
  if (carrier.kind === "target-named") {
    if (carrier.id === rustProgramErrorTargetId) {
      const owner = rustProgramErrorOwner(carrier);
      return owner === undefined ? undefined : resolveSourceTypePath?.programErrorType?.(owner);
    }
    const path = rustBuiltInCarrierDefinitions[carrier.id]?.renderPath;
    if (path === undefined) {
      return undefined;
    }
    const genericArguments = rustGenericArgumentsFromCarrier(
      carrier.id === rustJsPromiseTargetId ? carrier.genericArguments?.map(argument =>
        argument.kind === "type" && isRustNeverCarrier(argument.type)
          ? { kind: "type", type: rustUnitTargetType() } : argument) : carrier.genericArguments,
      resolveSourceTypePath,
      resolveStructuralShape,
    );
    if (genericArguments === undefined) {
      return undefined;
    }
    return {
      kind: "named",
      path,
      ...(genericArguments.length === 0 ? {} : { genericArguments }),
    };
  }
  if (carrier.kind === "type-parameter") {
    return { kind: "named", path: resolveSourceTypePath?.typeParameterNames?.get(carrier.identity) ?? carrier.name };
  }
  if (carrier.kind === "reference") {
    const referent = !carrier.mutable && carrier.referent.kind === "target-named" &&
        carrier.referent.id === rustStringTargetId
      ? { kind: "str" as const }
      : rustTypeFromCarrier(carrier.referent, resolveSourceTypePath, resolveStructuralShape);
    return referent === undefined ? undefined : {
      kind: "reference",
      referent,
      mutable: carrier.mutable,
      ...(carrier.lifetime === undefined
        ? {}
        : { lifetime: rustLifetimeToAst(carrier.lifetime) }),
    };
  }
  if (carrier.kind === "slice") {
    const element = rustTypeFromCarrier(carrier.element, resolveSourceTypePath, resolveStructuralShape);
    return element === undefined ? undefined : { kind: "slice", element };
  }
  if (carrier.kind === "pointer" &&
    (carrier.mutability === "const" || carrier.mutability === "mut")) {
    const pointee = rustTypeFromCarrier(carrier.pointee, resolveSourceTypePath, resolveStructuralShape);
    return pointee === undefined
      ? undefined
      : { kind: "raw-pointer", pointee, mutable: carrier.mutability === "mut" };
  }
  if (carrier.kind === "function-pointer") {
    const parameters = carrier.args.map((argument) =>
      rustTypeFromCarrier(argument, resolveSourceTypePath, resolveStructuralShape));
    const result = rustReturnTypeFromCarrier(
      carrier.result,
      resolveSourceTypePath,
      resolveStructuralShape,
    );
    return result === undefined || parameters.some((parameter) => parameter === undefined)
      ? undefined
      : {
          kind: "function-pointer",
          parameters: parameters as RustType[],
          result,
          ...(carrier.lifetimeBinder === undefined
            ? {}
            : { binder: rustLifetimeBinderToAst(carrier.lifetimeBinder) }),
          ...(carrier.abi === undefined ? {} : { abi: carrier.abi }),
          ...(carrier.isUnsafe === true ? { isUnsafe: true } : {}),
        };
  }
  if (carrier.kind === "closure") {
    const parameters = carrier.args.map((argument) =>
      rustTypeFromCarrier(argument, resolveSourceTypePath, resolveStructuralShape));
    const result = rustReturnTypeFromCarrier(
      carrier.result,
      resolveSourceTypePath,
      resolveStructuralShape,
    );
    return result === undefined || parameters.some((parameter) => parameter === undefined)
      ? undefined
      : {
          kind: "impl-trait",
          bounds: [{
            kind: "callable",
            trait: carrier.callTrait ?? "Fn",
            binder: carrier.lifetimeBinder === undefined ? [] : rustLifetimeBinderToAst(carrier.lifetimeBinder),
            parameters: parameters as RustType[],
            result: carrier.fallible === true ? {
              kind: "named", path: "rt::TsonicResult", genericArguments: typeGenericArguments([result]),
            } : result,
          }],
          outlives: Object.freeze([]),
        };
  }
  const fixedArray = rustFixedArrayCarrierValue(carrier);
  if (fixedArray !== undefined) {
    const element = rustTypeFromCarrier(fixedArray.element, resolveSourceTypePath, resolveStructuralShape);
    return element === undefined
      ? undefined
      : { kind: "fixed-array", element, length: rustConstArgumentToAst(fixedArray.length) };
  }
  const namedType = rustNamedTypeCarrierValue(carrier);
  if (namedType !== undefined) {
    const genericArguments = rustGenericArgumentsFromCarrier(
      rustExplicitNamedTypeArguments(namedType),
      resolveSourceTypePath,
      resolveStructuralShape,
    );
    return genericArguments === undefined
      ? undefined
      : {
          kind: "named",
          path: namedType.path,
          ...(genericArguments.length === 0
            ? {}
            : { genericArguments }),
        };
  }
  const structuralObject = rustStructuralObjectCarrierValue(carrier);
  if (structuralObject !== undefined || rustGenericCallableValue(carrier) !== undefined ||
    rustFrameCallableValue(carrier) !== undefined || rustClassConstructorInstance(carrier) !== undefined) {
    return resolveStructuralShape?.(carrier);
  }
  if (carrier.kind === "array") {
    const element = rustTypeFromCarrier(carrier.element, resolveSourceTypePath, resolveStructuralShape);
    return element === undefined ? undefined : {
      kind: "named",
      path: "Vec",
      genericArguments: typeGenericArguments([element]),
    };
  }
  if (carrier.kind === "tuple") {
    if (carrier.elements.length === 0) {
      return { kind: "unit" };
    }
    const elements = carrier.elements.map((element) =>
      rustTypeFromCarrier(element, resolveSourceTypePath, resolveStructuralShape));
    if (elements.some((element) => element === undefined)) {
      return undefined;
    }
    return { kind: "tuple", elements: elements as RustType[] };
  }
  if (resolveSourceTypePath !== undefined) {
    const value = rustSourceTypeCarrierValue(carrier);
    if (value !== undefined) {
      const path = resolveSourceTypePath.pathFor(value);
      const genericArguments = rustGenericArgumentsFromCarrier(
        value.genericArguments,
        resolveSourceTypePath,
        resolveStructuralShape,
      );
      if (path === undefined || genericArguments === undefined) return undefined;
      const completeArguments = [
        ...genericArguments, ...resolveSourceTypePath.additionalArgumentsFor(carrier),
      ];
      return {
            kind: "named",
            path,
            ...(completeArguments.length === 0
              ? {}
              : { genericArguments: completeArguments }),
          };
    }
    const union = rustSourceUnionCarrierValue(carrier);
    if (union !== undefined) {
      if (union.origin === "generated") return resolveStructuralShape?.(carrier);
      const path = resolveSourceTypePath.pathFor(union);
      const arguments_ = rustSourceUnionPayloadArguments(carrier, resolveSourceTypePath.typeDefinitions);
      const genericArguments = arguments_ === undefined ? undefined : rustGenericArgumentsFromCarrier(
        arguments_, resolveSourceTypePath, resolveStructuralShape,
      );
      return path === undefined || genericArguments === undefined ? undefined : {
        kind: "named", path,
        ...(genericArguments.length === 0 ? {} : { genericArguments }),
      };
    }
  }
  if (carrier.kind === "trait-object") {
    const principal = rustTraitReferenceFromCarrier(
      carrier.principal,
      resolveSourceTypePath,
      resolveStructuralShape,
    );
    const autoTraits = carrier.autoTraits.map((trait) => rustTraitReferenceFromCarrier(
      trait,
      resolveSourceTypePath,
      resolveStructuralShape,
    ));
    return principal === undefined || autoTraits.some((trait) => trait === undefined)
      ? undefined
      : {
          kind: "trait-object",
          principal,
          autoTraits: autoTraits as RustTraitReference[],
          ...(carrier.lifetime === undefined
            ? {}
            : { lifetime: rustLifetimeToAst(carrier.lifetime) }),
        };
  }
  if (carrier.kind === "impl-trait") {
    const bounds = carrier.bounds.map((bound) => rustTraitReferenceFromCarrier(
      bound,
      resolveSourceTypePath,
      resolveStructuralShape,
    ));
    const captures = rustGenericArgumentsFromCarrier(
      carrier.captures,
      resolveSourceTypePath,
      resolveStructuralShape,
    );
    return bounds.some((bound) => bound === undefined) || captures === undefined
      ? undefined
      : {
          kind: "impl-trait",
          bounds: (bounds as RustTraitReference[]).map((reference): RustTypeBound => ({
            kind: "trait-type",
            reference,
          })),
          outlives: carrier.outlives.map(rustLifetimeToAst),
          captures,
        };
  }
  if (carrier.kind === "associated-type") {
    const owner = rustTypeFromCarrier(
      carrier.owner,
      resolveSourceTypePath,
      resolveStructuralShape,
    );
    const traitReference = carrier.trait === undefined
      ? undefined
      : rustTraitReferenceFromCarrier(
          carrier.trait,
          resolveSourceTypePath,
          resolveStructuralShape,
        );
    const genericArguments = rustGenericArgumentsFromCarrier(
      carrier.genericArguments,
      resolveSourceTypePath,
      resolveStructuralShape,
    );
    if (owner === undefined || carrier.trait !== undefined && traitReference === undefined ||
      (traitReference?.binder?.length ?? 0) !== 0 ||
      genericArguments === undefined) {
      return undefined;
    }
    return {
      kind: "qualified",
      owner,
      ...(traitReference === undefined ? {} : { trait: traitReference.trait }),
      member: carrier.name,
      ...(genericArguments.length === 0 ? {} : { genericArguments }),
    };
  }
  return undefined;
}

function rustTraitReferenceFromCarrier(
  carrier: TargetTypeRef,
  resolveSourceTypePath?: RustSourceTypeRendering,
  resolveStructuralShape?: (carrier: TargetTypeRef) => RustType | undefined,
): RustTraitReference | undefined {
  if (carrier.kind !== "trait-ref") return undefined;
  const path = carrier.sourceItem === undefined ? carrier.path : resolveSourceTypePath?.pathFor(carrier.sourceItem);
  if (path === undefined) return undefined;
  const genericArguments = rustGenericArgumentsFromCarrier(
    carrier.genericArguments,
    resolveSourceTypePath,
    resolveStructuralShape,
  );
  if (genericArguments === undefined) return undefined;
  const associatedConstraints = carrier.associatedConstraints.map((constraint) => {
    const arguments_ = rustGenericArgumentsFromCarrier(
      constraint.genericArguments,
      resolveSourceTypePath,
      resolveStructuralShape,
    );
    if (arguments_ === undefined) return undefined;
    if (constraint.kind === "equality") {
      const type = rustTypeFromCarrier(
        constraint.type,
        resolveSourceTypePath,
        resolveStructuralShape,
      );
      return type === undefined
        ? undefined
        : {
            kind: "associated-equality" as const,
            name: constraint.name,
            genericArguments: arguments_,
            type,
          };
    }
    const traits = constraint.traits.map((trait) => rustTraitReferenceFromCarrier(
      trait,
      resolveSourceTypePath,
      resolveStructuralShape,
    ));
    return traits.some((trait) => trait === undefined)
      ? undefined
      : {
          kind: "associated-bounds" as const,
          name: constraint.name,
          genericArguments: arguments_,
          bounds: Object.freeze([
            ...(traits as RustTraitReference[]).map((reference): RustTypeBound => ({
              kind: "trait-type",
              reference,
            })),
            ...constraint.outlives.map((lifetime): RustTypeBound => ({
              kind: "lifetime",
              lifetime: rustLifetimeToAst(lifetime),
            })),
          ]),
        };
  });
  return associatedConstraints.some((constraint) => constraint === undefined)
    ? undefined
    : {
        trait: {
          kind: "named",
          path,
          ...(
            genericArguments.length === 0 && associatedConstraints.length === 0
              ? {}
              : {
                  genericArguments: Object.freeze([
                    ...genericArguments,
                    ...(associatedConstraints as RustGenericArgument[]),
                  ]),
                }
          ),
        },
        ...(carrier.lifetimeBinder === undefined
          ? {}
          : { binder: rustLifetimeBinderToAst(carrier.lifetimeBinder) }),
      };
}

export function rustReturnTypeFromCarrier(
  carrier: TargetTypeRef | undefined,
  resolveSourceTypePath?: RustSourceTypeRendering,
  resolveStructuralShape?: (carrier: TargetTypeRef) => RustType | undefined,
): RustType | undefined {
  return isRustNeverCarrier(carrier)
    ? { kind: "never" }
    : rustTypeFromCarrier(carrier, resolveSourceTypePath, resolveStructuralShape);
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

export function rustTypeFromCarrierInContext(
  carrier: TargetTypeRef | undefined,
  context: RustTypeRenderingContext,
  position: "general" | "parameter" | "return" | "inferred-call" | "absence" = "general",
): RustType | undefined {
  const instantiatedCarrier = carrier === undefined ||
      context.typeParameterSubstitutions === undefined &&
      context.lifetimeSubstitutions === undefined
    ? carrier
    : substituteRustTargetGenerics(
        carrier,
        context.typeParameterSubstitutions ?? new Map(),
        context.lifetimeSubstitutions ?? new Map(),
      );
  const selectedCarrier = position === "absence" && instantiatedCarrier !== undefined
    ? rustCallableInputAbsenceWitness(instantiatedCarrier) : instantiatedCarrier;
  const resolveStructuralShape = (shapeCarrier: TargetTypeRef): RustType | undefined => {
    if (rustFrameCallableValue(shapeCarrier) !== undefined) return rustFrameCallableTypes(shapeCarrier, context)?.rootType;
    const instance = rustClassConstructorInstance(shapeCarrier);
    if (instance !== undefined) return rustClassEnvironmentHandleType(instance, context);
    const genericCallable = rustGenericCallableValue(shapeCarrier);
    if (genericCallable !== undefined) {
      const physical = context.input.program.callableValues.generic.physical;
      const definition = physical.definitionFor(shapeCarrier);
      const module = definition === undefined ? undefined : context.moduleNameByFileName.get(definition.ownerFileName);
      const externalCrate = definition === undefined ? undefined : context.externalCrateNameByFileName.get(definition.ownerFileName);
      const physicalArguments = physical.argumentsFor(shapeCarrier);
      const arguments_ = physicalArguments === undefined ? undefined : rustGenericArgumentsFromCarrier(
        rustGenericCallableStorageArguments(genericCallable.environment, physicalArguments), sourceRendering, resolveStructuralShape);
      if (definition === undefined || module === undefined || arguments_ === undefined) return undefined;
      return { kind: "named", path: `${externalCrate !== undefined && externalCrate !== context.crateName ? externalCrate : "crate"}::${module}::${definition.targetName}`,
        genericArguments: arguments_,
      };
    }
    const union = rustSourceUnionCarrierValue(shapeCarrier);
    const definition = union?.origin === "generated"
      ? context.input.program.structuralShapes.unionForCarrier(shapeCarrier)
      : context.input.program.structuralShapes.definitionForCarrier(shapeCarrier);
    if (definition === undefined) {
      return undefined;
    }
    const arguments_ = union?.origin === "generated" ? rustSourceUnionPayloadArguments(shapeCarrier, context.input.program.typeDefinitions) :
      context.input.program.structuralShapes.definitionForCarrier(shapeCarrier)!.genericArguments;
    if (arguments_ === undefined) return undefined;
    const genericArguments = rustGenericArgumentsFromCarrier(arguments_, sourceRendering, resolveStructuralShape);
    if (genericArguments === undefined) {
      return undefined;
    }
    const path = rustStructuralTypePathInContext(shapeCarrier, context);
    if (path === undefined) return undefined;
    const stateType: RustType = {
      kind: "named",
      path,
      ...(genericArguments.length === 0
        ? {}
        : { genericArguments: genericArguments as readonly RustGenericArgument[] }),
    };
    return union?.origin === "generated" || rustStructuralObjectCarrierValue(shapeCarrier)?.representation === "value" ||
      context.input.program.structuralShapes.definitionForCarrier(shapeCarrier)?.dispatchName !== undefined ? stateType : {
      kind: "named",
      path: "rt::ObjectHandle",
      genericArguments: typeGenericArguments([stateType]),
    };
  };
  const resolvingProducerErrors = new Set<string>();
  const resolvingErrorJoins = new Set<string>();
  let producerErrorWork = 4096;
  const sourceRendering: RustSourceTypeRendering = {
    typeParameterNames: context.typeParameterNames, typeDefinitions: context.input.program.typeDefinitions,
    pathFor: value => rustSourceTypePathInContext(value, context), additionalArgumentsFor: type => rustOptionalStorageTypeArguments(type, context),
    programErrorType: owner => {
      const boundary = context.sourcePackageErrors === undefined ? undefined : owner.kind === "logical"
        ? rustCurrentErrorBoundary(context)
        : resolveRustPhysicalProgramErrorBoundary(context.sourcePackageErrors, context.sourcePackageComponentId, owner);
      return boundary === undefined ? undefined : rustErrorType(boundary);
    },
    producerErrorType: reference => {
      const key = closedMetadataKey(reference);
      if (producerErrorWork-- <= 0 || resolvingProducerErrors.size >= 128 || resolvingProducerErrors.has(key)) return undefined;
      resolvingProducerErrors.add(key);
      try {
        return context.input.errorRegions.producerErrorType(reference,
          carrier => rustTypeFromCarrier(carrier, sourceRendering, resolveStructuralShape));
      } finally {
        resolvingProducerErrors.delete(key);
      }
    },
    nativeErrorJoinType: reference => {
      const key = closedMetadataKey(reference);
      if (producerErrorWork-- <= 0 || resolvingErrorJoins.size >= 128 || resolvingErrorJoins.has(key)) return undefined;
      resolvingErrorJoins.add(key);
      try {
        return context.input.errorRegions.nativeErrorJoinType(reference, context,
          carrier => rustTypeFromCarrier(carrier, sourceRendering, resolveStructuralShape));
      } finally {
        resolvingErrorJoins.delete(key);
      }
    },
  };
  const rendered = rustTypeFromCarrier(selectedCarrier, sourceRendering, resolveStructuralShape);
  if (position === "inferred-call" && rendered !== undefined && rustTypeContainsImplTrait(rendered)) {
    return { kind: "infer" };
  }
  if (!rustTypeIsLegalInPosition(rendered, position === "inferred-call" || position === "absence" ? "general" : position)) {
    return undefined;
  }
  collectAliasesFromRustType(rendered, (path) => {
    registerAliasFromPath(context, path);
  });
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
  return carrier.kind === "target-named" && carrier.id === rustFutureTargetId
    ? { kind: "infer" }
    : rustTypeFromCarrierInContext(carrier, context, "inferred-call");
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

function rustGenericArgumentsFromCarrier(
  arguments_: readonly RustTargetGenericArgument[] | undefined,
  resolveSourceTypePath?: RustSourceTypeRendering,
  resolveStructuralShape?: (carrier: TargetTypeRef) => RustType | undefined,
): readonly RustGenericArgument[] | undefined {
  const result: RustGenericArgument[] = [];
  for (const argument of arguments_ ?? []) {
    if (argument.kind === "lifetime") {
      result.push({ kind: "lifetime", lifetime: rustLifetimeToAst(argument.lifetime) });
      continue;
    }
    if (argument.kind === "const") {
      result.push({ kind: "const", value: rustConstArgumentToAst(argument.value) });
      continue;
    }
    const type = rustTypeFromCarrier(
      argument.type,
      resolveSourceTypePath,
      resolveStructuralShape,
    );
    if (type === undefined) return undefined;
    result.push({ kind: "type", type });
  }
  return Object.freeze(result);
}

function rustConstArgumentToAst(value: RustTargetConstArgument): RustConstArgument {
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

function typeGenericArguments(types: readonly RustType[]): readonly RustGenericArgument[] {
  return Object.freeze(types.map((type) => ({ kind: "type" as const, type })));
}
