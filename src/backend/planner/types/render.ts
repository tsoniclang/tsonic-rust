import type { RustTargetGenericArgument, TargetTypeRef } from "../../../target-model/types/model.js";
import { registerAliasFromPath, rustCurrentErrorBoundary } from "../program/plan-context.js";
import { rustErrorType } from "../program/fallible-boundaries.js";
import type { RustSourcePackageErrorPlan } from "../../../target-model/records/errors/source-package-errors.js";
import { resolveRustPhysicalProgramErrorBoundary } from "../program/source-package-errors.js";
import { collectAliasesFromRustType } from "./type-observations.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import type { RustTypeEmission } from "../../../target-model/records/types/type-emission.js";
import type { RustCallGenericArgument, RustGenericArgument, RustType } from "../../target-ast/syntax/nodes.js";
import { rustLifetimeKey, type RustLifetimeRef } from "../../../target-model/lifetimes/index.js";
import {
  rustSourceUnionCarrierValue, rustBuiltInCarrierDefinitions, substituteRustTargetGenerics, isRustNeverCarrier,
} from "../../../target-model/types/index.js";
import { rustSourceTypePathInContext, rustStructuralTypePathInContext } from "./paths.js";
import { rustFrameCallableValue } from "../../../target-model/types/carriers/frame-callables.js";
import { rustGenericCallableValue } from "../../../target-model/types/carriers/generic-callables.js";
import { rustFrameCallableTypes } from "./frame-callables.js";
import { rustClassConstructorInstance } from "../../../target-model/types/carriers/class-constructors.js";
import { rustNativeErrorJoinIdentity } from "../../../target-model/types/native-error-joins.js";
import { rustRuntimeUnionContract } from "../../../target-model/types/carriers/runtime-unions.js";
import { rustClassEnvironmentHandleType } from "../objects/class-environment-types.js";
import { rustLifetimeToAst } from "./lifetime-syntax.js";
import { rustOptionalStorageTypeArguments } from "./type-projections.js";
import { rustCallableInputAbsenceWitness } from "../../../target-model/types/carriers/callable-input-witness.js";
import {
  rustTypeFromCarrier, rustGenericArgumentsFromCarrier, rustConstArgumentToAst, typeGenericArguments,
  type RustSourceTypeRendering,
} from "./carrier-syntax.js";


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
      readonly program: {
        readonly source: Pick<import("@tsonic/target-api/analysis").TargetSourceSyntaxProgram, "ast">;
        readonly records: import("../../../target-model/records/program.js").RustProgramRecords;
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
  const syntaxPosition = position === "inferred-call" || position === "absence" ? "general" : position;
  const resolveStructuralShape = (shapeCarrier: TargetTypeRef): RustType | undefined => {
    if (rustFrameCallableValue(shapeCarrier) !== undefined) return rustFrameCallableTypes(shapeCarrier, context, syntaxPosition)?.rootType;
    const instance = rustClassConstructorInstance(shapeCarrier);
    if (instance !== undefined) return rustClassEnvironmentHandleType(instance, context, syntaxPosition);
    const selected = context.input.program.records.typeEmission.get(shapeCarrier);
    if (selected === undefined) failRustPlannerInvariant("An admitted native type requires its sealed physical storage selection.");
    if (selected.generic !== undefined) {
      const generic = selected.generic;
      const module = context.moduleNameByFileName.get(generic.fileName);
      const external = context.externalCrateNameByFileName.get(generic.fileName);
      const arguments_ = rustGenericArgumentsFromCarrier(generic.arguments, sourceRendering, resolveStructuralShape, syntaxPosition);
      if (module === undefined || arguments_ === undefined) failRustPlannerInvariant("An admitted generic callable requires its native module and storage arguments.");
      return { kind: "named", path: `${external !== undefined && external !== context.crateName ? external : "crate"}::${module}::${generic.name}`,
        genericArguments: arguments_ };
    }
    // A logical generic callable carrier (no physical key) has no selected storage type; it has no native rendering.
    if (rustGenericCallableValue(shapeCarrier) !== undefined) return undefined;
    const shape = selected.structural;
    if (shape === undefined) failRustPlannerInvariant("An admitted structural native type requires its exact sealed definition.");
    const arguments_ = rustGenericArgumentsFromCarrier(shape.arguments, sourceRendering, resolveStructuralShape, syntaxPosition);
    const path = rustStructuralTypePathInContext(shapeCarrier, context);
    if (arguments_ === undefined || path === undefined) failRustPlannerInvariant("An admitted structural native type requires its exact emitted path and arguments.");
    const state: RustType = { kind: "named", path, ...(arguments_.length === 0 ? {} : { genericArguments: arguments_ }) };
    if (!shape.handle) return state;
    if (shape.context === undefined) failRustPlannerInvariant("An admitted structural handle requires its completed native context type.");
    const nativeContext = rustTypeFromCarrier(shape.context, sourceRendering, resolveStructuralShape, syntaxPosition);
    if (nativeContext === undefined) failRustPlannerInvariant("An admitted structural handle requires its renderable completed native context.");
    return { kind: "named", path: "rt::ObjectHandle", genericArguments: typeGenericArguments([state, nativeContext]) };
  };
  const sourceRendering: RustSourceTypeRendering = {
    typeParameterNames: context.typeParameterNames,
    payloadArgumentsFor: carrier => context.input.program.records.typeEmission.get(carrier)?.unionArguments,
    pathFor: value => rustSourceTypePathInContext(value, context),
    additionalArgumentsFor: type => rustOptionalStorageTypeArguments(type, context, undefined, syntaxPosition),
    programErrorType: owner => {
      const boundary = context.sourcePackageErrors === undefined ? undefined : owner.kind === "logical"
        ? rustCurrentErrorBoundary(context)
        : resolveRustPhysicalProgramErrorBoundary(context.input.program.records, context.sourcePackageComponentId, owner);
      return boundary === undefined ? undefined : rustErrorType(boundary);
    },
    producerErrorType: carrier => {
      const selected = context.input.program.records.typeEmission.get(carrier)?.producerError;
      if (selected === undefined) failRustPlannerInvariant("An admitted producer error requires its exact sealed native error carrier.");
      return rustTypeFromCarrier(selected, sourceRendering, resolveStructuralShape, syntaxPosition);
    },
    nativeErrorJoinType: reference => {
      const errors = reference.errors.map(carrier => rustTypeFromCarrier(carrier, sourceRendering, resolveStructuralShape, syntaxPosition));
      if (errors.length === 0 || errors.some(error => error === undefined))
        failRustPlannerInvariant("An admitted native error join requires its exact error type inventory.");
      if (errors.length === 1) return errors[0];
      const name = context.input.program.records.nativeErrorJoinName.get(reference.fileName, errors.length);
      const module = context.moduleNameByFileName.get(reference.fileName);
      const external = context.externalCrateNameByFileName.get(reference.fileName);
      if (name === undefined || module === undefined)
        failRustPlannerInvariant("An admitted native error join requires its exact sealed name and emitted source module.");
      return { kind: "named", path: `${external !== undefined && external !== context.crateName ? external : "crate"}::${module}::${name}`,
        identity: rustNativeErrorJoinIdentity(reference.fileName, errors.length),
        genericArguments: typeGenericArguments(errors as readonly RustType[]) };
    },
  };
  const rendered = rustTypeFromCarrier(selectedCarrier, sourceRendering, resolveStructuralShape, syntaxPosition);
  const nativePosition = selectedCarrier === undefined ? undefined : context.input.program.records.typeEmission.get(selectedCarrier)?.positions;
  if (selectedCarrier !== undefined && nativePosition === undefined) failRustPlannerInvariant("An admitted native type requires its exact sealed position evidence.");
  if (position === "inferred-call" && rendered !== undefined && nativePosition?.opaque === true) {
    return { kind: "infer" };
  }
  if (nativePosition !== undefined && !nativePosition[position === "inferred-call" || position === "absence" ? "general" : position]) {
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

export function rustTypeEmissionInContext(carrier: TargetTypeRef, context: RustTypeRenderingContext): RustTypeEmission {
  const instantiated = context.typeParameterSubstitutions === undefined && context.lifetimeSubstitutions === undefined ? carrier
    : substituteRustTargetGenerics(carrier, context.typeParameterSubstitutions ?? new Map(), context.lifetimeSubstitutions ?? new Map());
  const selected = context.input.program.records.typeEmission.get(instantiated);
  if (selected === undefined) failRustPlannerInvariant("An admitted native type requires its exact sealed rendering metadata.");
  return selected;
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
  position: "general" | "parameter" | "return" = "general",
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
      const type = rustTypeFromCarrierInContext(argument.type, context, position);
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
  return rustTypeEmissionInContext(carrier, context).callArgumentInfer
    ? { kind: "infer" }
    : rustTypeFromCarrierInContext(carrier, context, "inferred-call");
}
