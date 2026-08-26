import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { registerAliasFromPath } from "../program/plan-context.js";
import type {
  RustConstExpression,
  RustGenericArgument as RustAstGenericArgument,
  RustGenericParameter as RustAstGenericParameter,
  RustGenerics as RustAstGenerics,
  RustLifetime,
  RustType,
  RustTypeBound,
} from "../../target-ast/nodes.js";
import type {
  RustAssociatedConstraint,
  RustBound,
  RustCapturedGeneric,
  RustConstExpr,
  RustGenericArgument,
  RustGenerics as RustSemanticGenerics,
  RustLifetimeRef,
  RustTraitRef,
  RustTypeRef,
} from "../../../target-model/semantics/index.js";
import {
  rustGenericArgumentSemanticKey,
  rustSemanticIdentityKey,
  rustTypeSemanticKey,
} from "../../../target-model/semantics/index.js";
import {
  rustSourceTypeCarrierValue,
  rustSourceUnionCarrierValue,
  rustStructuralObjectCarrierValue,
} from "../../../target-model/types/index.js";
import { rustSourceItemIdentity } from "../program/source-package-facades.js";
import {
  rustCallableProtocol,
  rustFutureOutputCarrier,
  inferRustTargetGenericSubstitutions,
  rustBuiltinPathTypeMatches,
  rustPrimitiveTypeName,
  substituteRustTargetGenerics,
  substituteRustGenericArgument,
  rustStringTargetId,
  rustTupleTargetType,
  isRustNeverCarrier,
} from "../../../target-model/types/index.js";
import { collectAliasesFromRustType } from "./alias-collection.js";

export { collectAliasesFromRustType } from "./alias-collection.js";

export const rustStrType: RustType = { kind: "str" };

export interface RustTypeRenderingContext {
  readonly moduleName: string;
  readonly moduleNameByFileName: ReadonlyMap<string, string>;
  readonly externalCrateNameByFileName: ReadonlyMap<string, string>;
  readonly externalItemPathByIdentity: ReadonlyMap<string, string>;
  readonly externalStructuralShapeModuleByFileName: ReadonlyMap<string, string>;
  readonly crateName?: string;
  readonly structuralShapesModuleName: string;
  readonly usedAliases?: Set<string>;
  readonly genericSubstitutions?: import("../../../target-model/types/index.js").RustGenericSubstitutions;
  readonly input: {
    readonly program: {
      readonly names: import("../../../target-model/names/model.js").RustNamePlan;
      readonly structuralShapes: import("../../../analysis/objects/structural-shape-plan.js").RustStructuralShapePlan;
    };
  };
}

export function rustAstLifetimeFromSemantic(lifetime: RustLifetimeRef): RustLifetime {
  switch (lifetime.kind) {
    case "static": return { kind: "static" };
    case "parameter":
    case "bound": return { kind: "named", name: lifetime.displayName };
    case "inferred-region": return { kind: "inferred" };
  }
}

export function rustAstConstFromSemantic(expression: RustConstExpr): RustConstExpression {
  switch (expression.kind) {
    case "literal":
      return expression.literalKind === "integer"
        ? { kind: "integer", value: expression.value }
        : expression.literalKind === "boolean"
          ? { kind: "boolean", value: expression.value }
          : { kind: "character", value: expression.value };
    case "parameter": return { kind: "path", path: expression.displayName };
    case "item": return { kind: "path", path: expression.displayPath.join("::") };
    case "inferred": return { kind: "inferred" };
    case "unary": return {
      kind: "unary",
      operator: expression.operator === "negate" ? "-" : "!",
      operand: rustAstConstFromSemantic(expression.operand),
    };
    case "binary": return {
      kind: "binary",
      operator: rustAstConstBinaryOperator(expression.operator),
      left: rustAstConstFromSemantic(expression.left),
      right: rustAstConstFromSemantic(expression.right),
    };
  }
}

export function rustAstGenericArgumentFromSemantic(
  argument: RustGenericArgument,
  resolveSourceTypePath?: (value: { readonly fileName: string; readonly typeName: string }) => string | undefined,
  resolveStructuralShape?: (carrier: TargetTypeRef) => RustType | undefined,
): RustAstGenericArgument | undefined {
  switch (argument.kind) {
    case "lifetime": return { kind: "lifetime", lifetime: rustAstLifetimeFromSemantic(argument.value) };
    case "const": return { kind: "const", expression: rustAstConstFromSemantic(argument.value) };
    case "type": {
      const type = rustTypeFromCarrier(argument.value, resolveSourceTypePath, resolveStructuralShape);
      return type === undefined ? undefined : { kind: "type", type };
    }
  }
}

export function rustAstTraitFromSemantic(
  trait: RustTraitRef,
  resolveSourceTypePath?: (value: { readonly fileName: string; readonly typeName: string }) => string | undefined,
  resolveStructuralShape?: (carrier: TargetTypeRef) => RustType | undefined,
): RustType | undefined {
  const argumentsList = trait.arguments.map((argument) =>
    rustAstGenericArgumentFromSemantic(argument, resolveSourceTypePath, resolveStructuralShape));
  const constraints = trait.associatedConstraints.map((constraint): RustAstGenericArgument | undefined => {
    const genericArguments = constraint.arguments.map((argument) =>
      rustAstGenericArgumentFromSemantic(argument, resolveSourceTypePath, resolveStructuralShape));
    if (genericArguments.some((argument) => argument === undefined)) return undefined;
    if (constraint.kind === "equality") {
      const type = rustTypeFromCarrier(constraint.type, resolveSourceTypePath, resolveStructuralShape);
      return type === undefined ? undefined : {
        kind: "associated-equality",
        name: constraint.displayName,
        ...(genericArguments.length === 0 ? {} : { genericArguments: genericArguments as RustAstGenericArgument[] }),
        type,
      };
    }
    const bounds = constraint.bounds.map((bound) => rustAstTypeBoundFromSemantic(
      bound,
      resolveSourceTypePath,
      resolveStructuralShape,
    ));
    return bounds.some((bound) => bound === undefined) ? undefined : {
      kind: "associated-bounds",
      name: constraint.displayName,
      ...(genericArguments.length === 0 ? {} : { genericArguments: genericArguments as RustAstGenericArgument[] }),
      bounds: bounds as RustTypeBound[],
    };
  });
  if (argumentsList.some((argument) => argument === undefined) ||
    constraints.some((constraint) => constraint === undefined)) return undefined;
  const genericArguments = [...argumentsList, ...constraints] as RustAstGenericArgument[];
  return {
    kind: "named",
    path: trait.displayPath.join("::"),
    ...(genericArguments.length === 0 ? {} : { genericArguments }),
  };
}

export function rustAstTypeBoundFromSemantic(
  bound: RustBound,
  resolveSourceTypePath?: (value: { readonly fileName: string; readonly typeName: string }) => string | undefined,
  resolveStructuralShape?: (carrier: TargetTypeRef) => RustType | undefined,
): RustTypeBound | undefined {
  switch (bound.kind) {
    case "trait": {
      if (bound.polarity === "negative") return undefined;
      const trait = rustAstTraitFromSemantic(bound.trait, resolveSourceTypePath, resolveStructuralShape);
      if (trait === undefined) return undefined;
      const binder = bound.binder?.lifetimes.map((parameter): Extract<RustAstGenericParameter, { readonly kind: "lifetime" }> => ({
        kind: "lifetime",
        name: parameter.identity.kind === "parameter" || parameter.identity.kind === "bound"
          ? parameter.identity.displayName
          : "_",
        bounds: parameter.bounds.map(rustAstLifetimeFromSemantic),
      }));
      return {
        kind: "trait",
        trait,
        ...(bound.polarity === "maybe" ? { polarity: "maybe" as const } : {}),
        ...(binder === undefined || binder.length === 0 ? {} : { binder }),
      };
    }
    case "lifetime-outlives":
      return { kind: "lifetime", lifetime: rustAstLifetimeFromSemantic(bound.shorter) };
    case "type-outlives":
      return { kind: "lifetime", lifetime: rustAstLifetimeFromSemantic(bound.lifetime) };
    case "associated-equality":
      return undefined;
  }
}

export function rustTypeFromCarrier(
  carrier: TargetTypeRef | undefined,
  resolveSourceTypePath?: (value: { readonly fileName: string; readonly typeName: string }) => string | undefined,
  resolveStructuralShape?: (carrier: TargetTypeRef) => RustType | undefined,
): RustType | undefined {
  return rustTypeFromCarrierAtPosition(
    carrier,
    resolveSourceTypePath,
    resolveStructuralShape,
    false,
  );
}

function rustTypeFromCarrierAtPosition(
  carrier: TargetTypeRef | undefined,
  resolveSourceTypePath: ((value: { readonly fileName: string; readonly typeName: string }) => string | undefined) | undefined,
  resolveStructuralShape: ((carrier: TargetTypeRef) => RustType | undefined) | undefined,
  includePreciseCapture: boolean,
): RustType | undefined {
  if (carrier === undefined) {
    return undefined;
  }
  if (isRustNeverCarrier(carrier)) {
    return undefined;
  }
  if (carrier.kind === "source-primitive" || carrier.kind === "primitive") {
    const name = carrier.kind === "primitive"
      ? carrier.name
      : rustPrimitiveTypeName(carrier.name);
    return name === undefined ? undefined : { kind: "primitive", name };
  }
  if (rustBuiltinPathTypeMatches(carrier, rustStringTargetId, "rust")) {
    return { kind: "string" };
  }
  const callableProtocol = rustCallableProtocol(carrier);
  if (callableProtocol !== undefined) {
    const argumentsType = rustTypeFromCarrier(
      rustTupleTargetType(callableProtocol.parameters),
      resolveSourceTypePath,
      resolveStructuralShape,
    );
    const runtimeResultCarrier = callableProtocol.asynchronous
      ? rustFutureOutputCarrier(callableProtocol.result)
      : callableProtocol.result;
    const resultType = rustTypeFromCarrier(
      runtimeResultCarrier,
      resolveSourceTypePath,
      resolveStructuralShape,
    );
    return argumentsType === undefined || resultType === undefined
      ? undefined
      : {
          kind: "named",
          path: callableProtocol.asynchronous
            ? callableProtocol.storage === "owned-local"
              ? "rt::OwnedLocalAsyncCallable"
              : callableProtocol.storage === "borrowed-local"
                ? "rt::BorrowedLocalAsyncCallable"
                : "rt::ThreadedAsyncCallable"
            : callableProtocol.storage === "owned-local"
              ? "rt::OwnedLocalCallable"
              : callableProtocol.storage === "borrowed-local"
                ? "rt::BorrowedLocalCallable"
                : "rt::ThreadedCallable",
          genericArguments: [
            ...(callableProtocol.lifetime === undefined
              ? []
              : [{
                  kind: "lifetime" as const,
                  lifetime: rustAstLifetimeFromSemantic(callableProtocol.lifetime),
                }]),
            { kind: "type", type: argumentsType },
            { kind: "type", type: {
              kind: "named",
              path: "rt::TsonicResult",
              genericArguments: [{ kind: "type", type: resultType }],
            } },
          ],
        };
  }
  if (carrier.kind === "type-parameter") {
    return { kind: "named", path: carrier.displayName };
  }
  if (carrier.kind === "reference") {
    const target = rustBuiltinPathTypeMatches(carrier.target, rustStringTargetId, "rust")
      ? { kind: "str" as const }
      : carrier.target;
    const referent = rustTypeFromCarrier(target, resolveSourceTypePath, resolveStructuralShape);
    return referent === undefined ? undefined : {
      kind: "reference",
      referent,
      mutable: carrier.mutable,
      ...(carrier.lifetime.kind === "inferred-region"
        ? {}
        : { lifetime: rustAstLifetimeFromSemantic(carrier.lifetime) }),
    };
  }
  if (carrier.kind === "slice") {
    const element = rustTypeFromCarrier(carrier.element, resolveSourceTypePath, resolveStructuralShape);
    return element === undefined ? undefined : { kind: "slice", element };
  }
  if (carrier.kind === "raw-pointer") {
    const pointee = rustTypeFromCarrier(carrier.target, resolveSourceTypePath, resolveStructuralShape);
    return pointee === undefined
      ? undefined
      : { kind: "raw-pointer", pointee, mutable: carrier.mutable };
  }
  if (carrier.kind === "function-pointer") {
    const parameters = carrier.parameters.map((argument) =>
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
          ...(carrier.binder === undefined ? {} : {
            binder: carrier.binder.lifetimes.map((parameter) => ({
              kind: "lifetime" as const,
              name: parameter.identity.kind === "parameter" || parameter.identity.kind === "bound"
                ? parameter.identity.displayName
                : "_",
              bounds: parameter.bounds.map(rustAstLifetimeFromSemantic),
            })),
          }),
          ...(carrier.abi === "Rust" ? {} : { abi: carrier.abi }),
          ...(carrier.safety === "unsafe" ? { isUnsafe: true } : {}),
          ...(carrier.variadic ? { variadic: true } : {}),
        };
  }
  if (carrier.kind === "array") {
    const element = rustTypeFromCarrier(carrier.element, resolveSourceTypePath, resolveStructuralShape);
    return element === undefined
      ? undefined
      : { kind: "fixed-array", element, length: rustAstConstFromSemantic(carrier.length) };
  }
  if (carrier.kind === "path") {
    const genericArguments = carrier.arguments.map((argument) =>
      rustAstGenericArgumentFromSemantic(argument, resolveSourceTypePath, resolveStructuralShape));
    if (genericArguments.some((argument) => argument === undefined)) return undefined;
    return {
      kind: "named",
      path: carrier.displayPath.join("::"),
      identity: rustSemanticIdentityKey(carrier.identity),
      ...(genericArguments.length === 0 ? {} : { genericArguments: genericArguments as RustAstGenericArgument[] }),
    };
  }
  const structuralObject = rustStructuralObjectCarrierValue(carrier);
  if (structuralObject !== undefined) {
    return resolveStructuralShape?.(carrier);
  }
  if (carrier.kind === "sequence") {
    const element = rustTypeFromCarrier(carrier.element, resolveSourceTypePath, resolveStructuralShape);
    return element === undefined ? undefined : {
      kind: "named",
      path: "Vec",
      genericArguments: [{ kind: "type", type: element }],
    };
  }
  if (carrier.kind === "tuple") {
    if (carrier.elements.length === 0) return undefined;
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
      const path = resolveSourceTypePath(value);
      const genericArguments = value.genericArguments.map((argument) =>
        rustAstGenericArgumentFromSemantic(
          argument,
          resolveSourceTypePath,
          resolveStructuralShape,
        ));
      return path === undefined || genericArguments.some((argument) => argument === undefined)
        ? undefined
        : {
            kind: "named",
            path,
            ...(genericArguments.length === 0
              ? {}
              : { genericArguments: genericArguments as RustAstGenericArgument[] }),
          };
    }
    const union = rustSourceUnionCarrierValue(carrier);
    if (union !== undefined) {
      const path = resolveSourceTypePath(union);
      return path === undefined ? undefined : { kind: "named", path };
    }
  }
  if (carrier.kind === "unit") return { kind: "unit" };
  if (carrier.kind === "never") return { kind: "never" };
  if (carrier.kind === "str") return rustStrType;
  if (carrier.kind === "self") return { kind: "named", path: "Self" };
  if (carrier.kind === "inference-variable") return { kind: "infer" };
  if (carrier.kind === "trait-object") {
    const traits = [carrier.principal, ...carrier.autoTraits].map((trait) =>
      rustAstTraitFromSemantic(trait, resolveSourceTypePath, resolveStructuralShape));
    if (traits.some((trait) => trait === undefined)) return undefined;
    return {
      kind: "trait-object",
      bounds: (traits as RustType[]).map((trait) => ({ kind: "trait", trait })),
      lifetime: rustAstLifetimeFromSemantic(carrier.lifetime),
    };
  }
  if (carrier.kind === "opaque") {
    const bounds = carrier.bounds.map((bound) => rustAstTypeBoundFromSemantic(
      bound,
      resolveSourceTypePath,
      resolveStructuralShape,
    ));
    return bounds.some((bound) => bound === undefined)
      ? undefined
      : {
          kind: "opaque",
          bounds: [
            ...(bounds as RustTypeBound[]),
            ...(includePreciseCapture ? [rustAstPreciseCaptureBound(carrier.captures)] : []),
          ],
        };
  }
  if (carrier.kind === "associated-type") {
    const owner = rustTypeFromCarrier(carrier.owner, resolveSourceTypePath, resolveStructuralShape);
    const trait = rustAstTraitFromSemantic(carrier.trait, resolveSourceTypePath, resolveStructuralShape);
    const genericArguments = carrier.arguments.map((argument) =>
      rustAstGenericArgumentFromSemantic(argument, resolveSourceTypePath, resolveStructuralShape));
    return owner === undefined || trait === undefined ||
        genericArguments.some((argument) => argument === undefined)
      ? undefined
      : {
          kind: "qualified",
          owner,
          trait,
          member: carrier.displayName,
          ...(genericArguments.length === 0
            ? {}
            : { genericArguments: genericArguments as RustAstGenericArgument[] }),
        };
  }
  if (carrier.kind === "closure") {
    const parameters = carrier.parameters.map((parameter) =>
      rustTypeFromCarrier(parameter, resolveSourceTypePath, resolveStructuralShape));
    const result = rustReturnTypeFromCarrier(carrier.result, resolveSourceTypePath, resolveStructuralShape);
    return result === undefined || parameters.some((parameter) => parameter === undefined)
      ? undefined
      : {
        kind: "opaque",
          bounds: [
            {
              kind: "callable-trait",
              trait: carrier.callTrait === "fn" ? "Fn" : carrier.callTrait === "fn-mut" ? "FnMut" : "FnOnce",
              ...(carrier.binder === undefined || carrier.binder.lifetimes.length === 0
                ? {}
                : {
                    binder: carrier.binder.lifetimes.map((parameter) => ({
                      kind: "lifetime" as const,
                      name: parameter.identity.kind === "parameter" || parameter.identity.kind === "bound"
                        ? parameter.identity.displayName
                        : "_",
                      bounds: parameter.bounds.map(rustAstLifetimeFromSemantic),
                    })),
                  }),
              parameters: parameters as RustType[],
              result,
            },
            ...(includePreciseCapture ? [rustAstPreciseCaptureBound(carrier.captures)] : []),
          ],
        };
  }
  return undefined;
}

export function rustReturnTypeFromCarrier(
  carrier: TargetTypeRef | undefined,
  resolveSourceTypePath?: (value: { readonly fileName: string; readonly typeName: string }) => string | undefined,
  resolveStructuralShape?: (carrier: TargetTypeRef) => RustType | undefined,
): RustType | undefined {
  return isRustNeverCarrier(carrier)
    ? { kind: "never" }
    : rustTypeFromCarrierAtPosition(
        carrier,
        resolveSourceTypePath,
        resolveStructuralShape,
        true,
      );
}

export function isFloatCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "source-primitive" && (carrier.name === "float32" || carrier.name === "float64");
}

export function rustTypeFromCarrierInContext(
  carrier: TargetTypeRef | undefined,
  context: RustTypeRenderingContext,
): RustType | undefined {
  return rustTypeFromCarrierInContextAtPosition(carrier, context, false);
}

function rustTypeFromCarrierInContextAtPosition(
  carrier: TargetTypeRef | undefined,
  context: RustTypeRenderingContext,
  includePreciseCapture: boolean,
): RustType | undefined {
  const selectedCarrier = carrier === undefined || context.genericSubstitutions === undefined
    ? carrier
    : substituteRustTargetGenerics(carrier, context.genericSubstitutions);
  const resolveSourceTypePath = (value: { readonly fileName: string; readonly typeName: string }): string | undefined => {
    const moduleName = context.moduleNameByFileName.get(value.fileName);
    if (moduleName === undefined) {
      return undefined;
    }
    const typeName = context.input.program.names.nameForSourceType(value.fileName, value.typeName);
    if (typeName === undefined) {
      return undefined;
    }
    const externalCrate = context.externalCrateNameByFileName.get(value.fileName);
    return externalCrate !== undefined && externalCrate !== context.crateName
      ? context.externalItemPathByIdentity.get(
          rustSourceItemIdentity(value.fileName, typeName),
        )
      : moduleName === context.moduleName ? typeName : `crate::${moduleName}::${typeName}`;
  };
  const resolveStructuralShape = (shapeCarrier: TargetTypeRef): RustType | undefined => {
    const definition = context.input.program.structuralShapes.definitionForCarrier(shapeCarrier);
    if (definition === undefined) {
      return undefined;
    }
    const substitutions = inferRustTargetGenericSubstitutions(
      definition.carrier,
      shapeCarrier,
      definition.genericIdentities,
    );
    const genericArguments = substitutions === undefined
      ? undefined
      : definition.genericArguments.map((argument) =>
          rustAstGenericArgumentFromSemanticInContext(
            substituteRustGenericArgument(argument, substitutions),
            context,
          ));
    if (genericArguments === undefined || genericArguments.some((argument) => argument === undefined)) {
      return undefined;
    }
    const externalShapeModule = context.externalStructuralShapeModuleByFileName.get(
      definition.ownerFileName,
    );
    const externalShapeCrate = context.externalCrateNameByFileName.get(
      definition.ownerFileName,
    );
    const stateType: RustType = {
      kind: "named",
      path: externalShapeModule !== undefined && externalShapeCrate !== context.crateName
        ? `${externalShapeModule}::${definition.targetName}`
        : context.moduleName === context.structuralShapesModuleName
        ? definition.targetName
        : `crate::${context.structuralShapesModuleName}::${definition.targetName}`,
      ...(genericArguments.length === 0
        ? {}
        : {
            genericArguments: genericArguments as readonly RustAstGenericArgument[],
          }),
    };
    return {
      kind: "named",
      path: "rt::LocalObjectHandle",
      genericArguments: [{ kind: "type", type: stateType }],
    };
  };
  const rendered = rustTypeFromCarrierAtPosition(
    selectedCarrier,
    resolveSourceTypePath,
    resolveStructuralShape,
    includePreciseCapture,
  );
  collectAliasesFromRustType(rendered, (path) => {
    registerAliasFromPath(context, path);
  });
  return rendered;
}

export function rustReturnTypeFromCarrierInContext(
  carrier: TargetTypeRef | undefined,
  context: RustTypeRenderingContext,
): RustType | undefined {
  return isRustNeverCarrier(carrier)
    ? { kind: "never" }
    : rustTypeFromCarrierInContextAtPosition(carrier, context, true);
}

export function rustAstGenericArgumentFromSemanticInContext(
  argument: RustGenericArgument,
  context: RustTypeRenderingContext,
): RustAstGenericArgument | undefined {
  switch (argument.kind) {
    case "lifetime":
      return { kind: "lifetime", lifetime: rustAstLifetimeFromSemantic(argument.value) };
    case "const":
      return { kind: "const", expression: rustAstConstFromSemantic(argument.value) };
    case "type": {
      const type = rustTypeFromCarrierInContext(argument.value, context);
      return type === undefined ? undefined : { kind: "type", type };
    }
  }
}

export function rustAstTraitFromSemanticInContext(
  trait: RustTraitRef,
  context: RustTypeRenderingContext,
): RustType | undefined {
  const argumentsList = trait.arguments.map((argument) =>
    rustAstGenericArgumentFromSemanticInContext(argument, context));
  const constraints = trait.associatedConstraints.map((constraint): RustAstGenericArgument | undefined => {
    const genericArguments = constraint.arguments.map((argument) =>
      rustAstGenericArgumentFromSemanticInContext(argument, context));
    if (genericArguments.some((argument) => argument === undefined)) return undefined;
    if (constraint.kind === "equality") {
      const type = rustTypeFromCarrierInContext(constraint.type, context);
      return type === undefined ? undefined : {
        kind: "associated-equality",
        name: constraint.displayName,
        ...(genericArguments.length === 0 ? {} : { genericArguments: genericArguments as RustAstGenericArgument[] }),
        type,
      };
    }
    const bounds = constraint.bounds.map((bound) => rustAstTypeBoundFromSemanticInContext(bound, context));
    return bounds.some((bound) => bound === undefined) ? undefined : {
      kind: "associated-bounds",
      name: constraint.displayName,
      ...(genericArguments.length === 0 ? {} : { genericArguments: genericArguments as RustAstGenericArgument[] }),
      bounds: bounds as RustTypeBound[],
    };
  });
  if (argumentsList.some((argument) => argument === undefined) ||
    constraints.some((constraint) => constraint === undefined)) return undefined;
  const path = trait.displayPath.join("::");
  registerAliasFromPath(context, path);
  const genericArguments = [...argumentsList, ...constraints] as RustAstGenericArgument[];
  return {
    kind: "named",
    path,
    ...(genericArguments.length === 0 ? {} : { genericArguments }),
  };
}

export function rustAstTypeBoundFromSemanticInContext(
  bound: RustBound,
  context: RustTypeRenderingContext,
): RustTypeBound | undefined {
  switch (bound.kind) {
    case "trait": {
      if (bound.polarity === "negative") return undefined;
      const trait = rustAstTraitFromSemanticInContext(bound.trait, context);
      return trait === undefined ? undefined : {
        kind: "trait",
        trait,
        ...(bound.polarity === "maybe" ? { polarity: "maybe" as const } : {}),
        ...(bound.binder === undefined || bound.binder.lifetimes.length === 0
          ? {}
          : {
              binder: bound.binder.lifetimes.map((parameter) => ({
                kind: "lifetime" as const,
                name: parameter.identity.kind === "parameter" || parameter.identity.kind === "bound"
                  ? parameter.identity.displayName
                  : "_",
                bounds: parameter.bounds.map(rustAstLifetimeFromSemantic),
              })),
            }),
      };
    }
    case "lifetime-outlives":
      return { kind: "lifetime", lifetime: rustAstLifetimeFromSemantic(bound.shorter) };
    case "type-outlives":
      return { kind: "lifetime", lifetime: rustAstLifetimeFromSemantic(bound.lifetime) };
    case "associated-equality":
      return undefined;
  }
}

function rustAstPreciseCaptureBound(
  captures: readonly RustCapturedGeneric[],
): Extract<RustTypeBound, { readonly kind: "precise-capture" }> {
  return {
    kind: "precise-capture",
    captures: captures.map((capture): RustAstGenericArgument =>
      capture.kind === "lifetime"
        ? { kind: "lifetime", lifetime: rustAstLifetimeFromSemantic(capture.value) }
        : capture.kind === "type"
          ? { kind: "type", type: { kind: "named", path: capture.displayName } }
          : { kind: "const", expression: { kind: "path", path: capture.displayName } }),
  };
}

export function rustAstGenericsFromSemanticInContext(
  generics: RustSemanticGenerics,
  context: RustTypeRenderingContext,
): RustAstGenerics | undefined {
  const parameters = generics.parameters.map((parameter): RustAstGenericParameter | undefined => {
    switch (parameter.kind) {
      case "lifetime":
        return parameter.identity.kind === "parameter" || parameter.identity.kind === "bound"
          ? {
              kind: "lifetime",
              name: parameter.identity.displayName,
              bounds: parameter.bounds.map(rustAstLifetimeFromSemantic),
            }
          : undefined;
      case "type": {
        const bounds = parameter.bounds.map((bound) =>
          rustAstTypeBoundFromSemanticInContext(bound, context));
        const defaultType = parameter.defaultType === undefined
          ? undefined
          : rustTypeFromCarrierInContext(parameter.defaultType, context);
        return bounds.some((bound) => bound === undefined) ||
            (parameter.defaultType !== undefined && defaultType === undefined)
          ? undefined
          : {
              kind: "type",
              name: parameter.displayName,
              bounds: bounds as RustTypeBound[],
              ...(defaultType === undefined ? {} : { defaultType }),
            };
      }
      case "const": {
        const type = rustTypeFromCarrierInContext(parameter.type, context);
        return type === undefined
          ? undefined
          : {
              kind: "const",
              name: parameter.displayName,
              type,
              ...(parameter.defaultValue === undefined
                ? {}
                : { defaultValue: rustAstConstFromSemantic(parameter.defaultValue) }),
            };
      }
    }
  });
  if (parameters.some((parameter) => parameter === undefined)) return undefined;
  const wherePredicates = generics.wherePredicates.map((predicate): RustAstGenerics["wherePredicates"][number] | undefined => {
    switch (predicate.kind) {
      case "lifetime":
        return {
          kind: "lifetime",
          lifetime: rustAstLifetimeFromSemantic(predicate.lifetime),
          outlives: predicate.outlives.map(rustAstLifetimeFromSemantic),
        };
      case "type": {
        const type = rustTypeFromCarrierInContext(predicate.type, context);
        const bounds = predicate.bounds.map((bound) =>
          rustAstTypeBoundFromSemanticInContext(bound, context));
        const binder = predicate.binder?.lifetimes.map((parameter) =>
          rustAstLifetimeParameter(parameter));
        return type === undefined || bounds.some((bound) => bound === undefined) ||
            binder?.some((parameter) => parameter === undefined)
          ? undefined
          : {
              kind: "type",
              type,
              bounds: bounds as RustTypeBound[],
              ...(binder === undefined || binder.length === 0
                ? {}
                : { binder: binder as Extract<RustAstGenericParameter, { readonly kind: "lifetime" }>[] }),
            };
      }
      case "equality": {
        const trait = rustTraitWithProjectionEquality(predicate.projection, predicate.value);
        const owner = rustTypeFromCarrierInContext(predicate.projection.owner, context);
        const renderedTrait = trait === undefined
          ? undefined
          : rustAstTraitFromSemanticInContext(trait, context);
        return owner === undefined || renderedTrait === undefined
          ? undefined
          : {
              kind: "type",
              type: owner,
              bounds: [{ kind: "trait", trait: renderedTrait }],
            };
      }
    }
  });
  return wherePredicates.some((predicate) => predicate === undefined)
    ? undefined
    : Object.freeze({
        parameters: Object.freeze(parameters as RustAstGenericParameter[]),
        wherePredicates: Object.freeze(wherePredicates as RustAstGenerics["wherePredicates"]),
      });
}

function rustTraitWithProjectionEquality(
  projection: Extract<RustTypeRef, { readonly kind: "associated-type" }>,
  value: RustTypeRef,
): RustTraitRef | undefined {
  const itemKey = rustSemanticIdentityKey(projection.item);
  const argumentKeys = projection.arguments.map(rustGenericArgumentSemanticKey);
  const valueKey = rustTypeSemanticKey(value);
  let matchingConstraintCount = 0;
  for (const constraint of projection.trait.associatedConstraints) {
    if (rustSemanticIdentityKey(constraint.item) !== itemKey ||
      !rustSemanticKeyListsEqual(
        constraint.arguments.map(rustGenericArgumentSemanticKey),
        argumentKeys,
      )) {
      continue;
    }
    if (constraint.kind !== "equality" || rustTypeSemanticKey(constraint.type) !== valueKey) {
      return undefined;
    }
    matchingConstraintCount += 1;
    if (matchingConstraintCount > 1) return undefined;
  }
  if (matchingConstraintCount === 1) return projection.trait;
  const equality: RustAssociatedConstraint = Object.freeze({
    kind: "equality",
    item: projection.item,
    displayName: projection.displayName,
    arguments: projection.arguments,
    type: value,
  });
  return Object.freeze({
    ...projection.trait,
    associatedConstraints: Object.freeze([
      ...projection.trait.associatedConstraints,
      equality,
    ]),
  });
}

function rustSemanticKeyListsEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function rustAstLifetimeParameter(
  parameter: Extract<import("../../../target-model/semantics/index.js").RustGenericParameter, { readonly kind: "lifetime" }>,
): Extract<RustAstGenericParameter, { readonly kind: "lifetime" }> | undefined {
  return parameter.identity.kind === "parameter" || parameter.identity.kind === "bound"
    ? {
        kind: "lifetime",
        name: parameter.identity.displayName,
        bounds: parameter.bounds.map(rustAstLifetimeFromSemantic),
      }
    : undefined;
}

function rustAstConstBinaryOperator(
  operator: import("../../../target-model/semantics/index.js").RustConstBinaryOperator,
): Extract<RustConstExpression, { readonly kind: "binary" }>["operator"] {
  switch (operator) {
    case "add": return "+";
    case "subtract": return "-";
    case "multiply": return "*";
    case "divide": return "/";
    case "remainder": return "%";
    case "shift-left": return "<<";
    case "shift-right": return ">>";
    case "bit-and": return "&";
    case "bit-or": return "|";
    case "bit-xor": return "^";
  }
}
