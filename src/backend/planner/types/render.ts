import type {
  RustTargetConstArgument,
  RustTargetGenericArgument,
  TargetTypeRef,
} from "../../../target-model/types/model.js";
import { registerAliasFromPath } from "../program/plan-context.js";
import type {
  RustCallGenericArgument,
  RustGenericArgument,
  RustConstArgument,
  RustLifetimeParameter,
  RustTraitReference,
  RustType,
  RustTypeBound,
} from "../../target-ast/nodes.js";
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
import { rustSourceItemIdentity } from "../program/source-package-facades.js";
import { rustExplicitNamedTypeArguments } from "./generic-defaults.js";
import { rustLifetimeToAst } from "./lifetime-syntax.js";
import {
  rustBigIntTargetId,
  rustJsArrayTargetId,
  rustJsArrayConcatItemTargetId,
  rustJsDateTargetId,
  rustJsMapTargetId,
  rustJsRegExpExecArrayTargetId,
  rustJsRegExpIndicesTargetId,
  rustJsRegExpMatchArrayTargetId,
  rustJsRegExpNamedGroupsTargetId,
  rustJsRegExpNamedIndicesTargetId,
  rustJsRegExpStringIteratorTargetId,
  rustJsRegExpTargetId,
  rustJsSetTargetId,
  rustJsStringTargetId,
  rustJsValueTargetId,
  rustLocationTargetId,
  rustCallableTargetId,
  rustGeneratorTargetId,
  rustAsyncGeneratorTargetId,
  rustIteratorResultTargetId,
  rustNullTargetId,
  rustUndefinedTargetId,
  rustJsErrorTargetId,
  rustProgramErrorTargetId,
  rustFixedArrayCarrierValue,
  rustOptionTargetId,
  rustNamedTypeCarrierValue,
  rustPrimitiveTypeName,
  substituteRustTargetGenerics,
  rustStringTargetId,
  rustRegExpExecArrayTargetId,
  rustRegExpIndicesTargetId,
  rustRegExpMatchArrayTargetId,
  rustRegExpNamedGroupsTargetId,
  rustRegExpNamedIndicesTargetId,
  rustRegExpStringIteratorTargetId,
  isRustNeverCarrier,
  rustOnlyTypeGenericArguments,
} from "../../../target-model/types/index.js";

const namedCarrierPaths: Readonly<Record<string, string>> = {
  [rustBigIntTargetId]: "rt::BigInt",
  [rustOptionTargetId]: "Option",
  [rustLocationTargetId]: "rt::Location",
  [rustGeneratorTargetId]: "rt::Generator",
  [rustAsyncGeneratorTargetId]: "rt::AsyncGenerator",
  [rustIteratorResultTargetId]: "rt::IteratorResult",
  [rustNullTargetId]: "rt::Null",
  [rustUndefinedTargetId]: "rt::Undefined",
  [rustJsErrorTargetId]: "rt::JsError",
  [rustProgramErrorTargetId]: "rt::TsonicError",
  [rustJsValueTargetId]: "js_abi::JsValue",
  [rustJsArrayTargetId]: "js_abi::JsArray",
  [rustJsArrayConcatItemTargetId]: "js_abi::JsArrayConcatItem",
  [rustJsMapTargetId]: "js_abi::JsMap",
  [rustJsSetTargetId]: "js_abi::JsSet",
  [rustJsDateTargetId]: "js_abi::JsDate",
  [rustJsStringTargetId]: "js_abi::JsString",
  [rustJsRegExpTargetId]: "js_abi::JsRegExp",
  [rustRegExpExecArrayTargetId]: "js_abi::RegExpExecArray",
  [rustJsRegExpExecArrayTargetId]: "js_abi::JsRegExpExecArray",
  [rustRegExpMatchArrayTargetId]: "js_abi::RegExpMatchArray",
  [rustJsRegExpMatchArrayTargetId]: "js_abi::JsRegExpMatchArray",
  [rustRegExpIndicesTargetId]: "js_abi::RegExpIndices",
  [rustJsRegExpIndicesTargetId]: "js_abi::JsRegExpIndices",
  [rustRegExpNamedGroupsTargetId]: "js_abi::RegExpNamedGroups",
  [rustJsRegExpNamedGroupsTargetId]: "js_abi::JsRegExpNamedGroups",
  [rustRegExpNamedIndicesTargetId]: "js_abi::RegExpNamedIndices",
  [rustJsRegExpNamedIndicesTargetId]: "js_abi::JsRegExpNamedIndices",
  [rustRegExpStringIteratorTargetId]: "js_abi::RegExpStringIterator",
  [rustJsRegExpStringIteratorTargetId]: "js_abi::JsRegExpStringIterator",
};

export const rustStrRefType: RustType = {
  kind: "reference",
  referent: { kind: "str" },
  mutable: false,
};

export function rustTypeFromCarrier(
  carrier: TargetTypeRef | undefined,
  resolveSourceTypePath?: (value: { readonly fileName: string; readonly typeName: string }) => string | undefined,
  resolveStructuralShape?: (carrier: TargetTypeRef) => RustType | undefined,
): RustType | undefined {
  if (carrier === undefined) {
    return undefined;
  }
  if (isRustNeverCarrier(carrier)) {
    return undefined;
  }
  if (carrier.kind === "source-primitive") {
    const name = rustPrimitiveTypeName(carrier.name);
    return name === undefined ? undefined : { kind: "primitive", name };
  }
  if (carrier.kind === "target-named" && carrier.id === rustStringTargetId) {
    return { kind: "string" };
  }
  if (carrier.kind === "target-named" && carrier.id === rustCallableTargetId) {
    const callableTypeArguments = rustOnlyTypeGenericArguments(carrier.genericArguments);
    const [argumentsCarrier, resultCarrier] = callableTypeArguments ?? [];
    if (callableTypeArguments?.length !== 2 || argumentsCarrier?.kind !== "tuple" ||
      resultCarrier === undefined) {
      return undefined;
    }
    const argumentsType = rustTypeFromCarrier(argumentsCarrier, resolveSourceTypePath, resolveStructuralShape);
    const resultType = rustTypeFromCarrier(resultCarrier, resolveSourceTypePath, resolveStructuralShape);
    return argumentsType === undefined || resultType === undefined
      ? undefined
      : {
          kind: "named",
          path: "rt::Callable",
          genericArguments: typeGenericArguments([
            argumentsType,
            {
              kind: "named",
              path: "rt::TsonicResult",
              genericArguments: typeGenericArguments([resultType]),
            },
          ]),
        };
  }
  if (carrier.kind === "target-named") {
    const path = namedCarrierPaths[carrier.id];
    if (path === undefined) {
      return undefined;
    }
    const genericArguments = rustGenericArgumentsFromCarrier(
      carrier.genericArguments,
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
    return { kind: "named", path: carrier.name };
  }
  if (carrier.kind === "reference") {
    const referent = carrier.referent.kind === "target-named" &&
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
  if (carrier.kind === "closure" && carrier.lifetimeBinder !== undefined) {
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
            trait: "Fn",
            binder: rustLifetimeBinderToAst(carrier.lifetimeBinder),
            parameters: parameters as RustType[],
            result,
          }],
          outlives: Object.freeze([]),
          captures: Object.freeze([]),
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
  if (structuralObject !== undefined) {
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
      const path = resolveSourceTypePath(value);
      const genericArguments = rustGenericArgumentsFromCarrier(
        value.genericArguments,
        resolveSourceTypePath,
        resolveStructuralShape,
      );
      return path === undefined || genericArguments === undefined
        ? undefined
        : {
            kind: "named",
            path,
            ...(genericArguments.length === 0
              ? {}
              : { genericArguments }),
          };
    }
    const union = rustSourceUnionCarrierValue(carrier);
    if (union !== undefined) {
      const path = resolveSourceTypePath(union);
      return path === undefined ? undefined : { kind: "named", path };
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
    return bounds.some((bound) => bound === undefined)
      ? undefined
      : {
          kind: "impl-trait",
          bounds: (bounds as RustTraitReference[]).map((reference): RustTypeBound => ({
            kind: "trait-type",
            reference,
          })),
          outlives: carrier.outlives.map(rustLifetimeToAst),
          captures: carrier.captures.map(rustLifetimeToAst),
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
  resolveSourceTypePath?: (value: { readonly fileName: string; readonly typeName: string }) => string | undefined,
  resolveStructuralShape?: (carrier: TargetTypeRef) => RustType | undefined,
): RustTraitReference | undefined {
  if (carrier.kind !== "trait-ref") return undefined;
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
          path: carrier.path,
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
  resolveSourceTypePath?: (value: { readonly fileName: string; readonly typeName: string }) => string | undefined,
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
        readonly names: import("../../../target-model/names/model.js").RustNamePlan;
        readonly structuralShapes: import("../../../analysis/objects/structural-shape-plan.js").RustStructuralShapePlan;
      };
    };
}

export function rustTypeFromCarrierInContext(
  carrier: TargetTypeRef | undefined,
  context: RustTypeRenderingContext,
  position: "general" | "parameter" | "return" = "general",
): RustType | undefined {
  const selectedCarrier = carrier === undefined ||
      context.typeParameterSubstitutions === undefined &&
      context.lifetimeSubstitutions === undefined
    ? carrier
    : substituteRustTargetGenerics(
        carrier,
        context.typeParameterSubstitutions ?? new Map(),
        context.lifetimeSubstitutions ?? new Map(),
      );
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
    const genericArguments = definition.genericParameters.map((parameter) =>
      parameter.kind === "lifetime"
        ? rustTargetGenericArgumentToAstInContext({
            kind: "lifetime",
            lifetime: parameter.lifetime,
          }, context)
        : rustTargetGenericArgumentToAstInContext({
            kind: "type",
            type: { kind: "type-parameter", name: parameter.name },
          }, context));
    if (genericArguments.some((argument) => argument === undefined)) {
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
        : { genericArguments: genericArguments as readonly RustGenericArgument[] }),
    };
    return {
      kind: "named",
      path: "rt::ObjectHandle",
      genericArguments: typeGenericArguments([stateType]),
    };
  };
  const rendered = rustTypeFromCarrier(
    selectedCarrier,
    resolveSourceTypePath,
    resolveStructuralShape,
  );
  if (!rustTypeIsLegalInPosition(rendered, position)) {
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

export function rustReturnTypeFromCarrierInContext(
  carrier: TargetTypeRef | undefined,
  context: {
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
        readonly names: import("../../../target-model/names/model.js").RustNamePlan;
        readonly structuralShapes: import("../../../analysis/objects/structural-shape-plan.js").RustStructuralShapePlan;
      };
    };
  },
): RustType | undefined {
  return isRustNeverCarrier(carrier)
    ? { kind: "never" }
    : rustTypeFromCarrierInContext(carrier, context, "return");
}

function rustTypeIsLegalInPosition(
  type: RustType | undefined,
  position: "general" | "parameter" | "return",
): boolean {
  if (type === undefined) return true;
  const containsImplTrait = rustTypeContainsImplTrait(type);
  return !containsImplTrait || position !== "general" && type.kind === "impl-trait";
}

function rustTypeContainsImplTrait(type: RustType): boolean {
  switch (type.kind) {
    case "impl-trait":
      return true;
    case "named":
      return rustGenericArgumentsContainImplTrait(type.genericArguments);
    case "qualified":
      return rustTypeContainsImplTrait(type.owner) ||
        (type.trait !== undefined && rustTypeContainsImplTrait(type.trait)) ||
        rustGenericArgumentsContainImplTrait(type.genericArguments);
    case "trait-object":
      return rustTypeContainsImplTrait(type.principal.trait) ||
        type.autoTraits.some((trait) => rustTypeContainsImplTrait(trait.trait));
    case "reference":
      return rustTypeContainsImplTrait(type.referent);
    case "raw-pointer":
      return rustTypeContainsImplTrait(type.pointee);
    case "fixed-array":
    case "slice":
      return rustTypeContainsImplTrait(type.element);
    case "function-pointer":
      return type.parameters.some(rustTypeContainsImplTrait) ||
        rustTypeContainsImplTrait(type.result);
    case "tuple":
      return type.elements.some(rustTypeContainsImplTrait);
    case "infer":
    case "primitive":
    case "string":
    case "str":
    case "unit":
    case "never":
      return false;
  }
}

function rustGenericArgumentsContainImplTrait(
  arguments_: readonly RustGenericArgument[] | undefined,
): boolean {
  return (arguments_ ?? []).some((argument) => {
    switch (argument.kind) {
      case "type":
        return rustTypeContainsImplTrait(argument.type);
      case "associated-equality":
        return rustGenericArgumentsContainImplTrait(argument.genericArguments) ||
          rustTypeContainsImplTrait(argument.type);
      case "associated-bounds":
        return rustGenericArgumentsContainImplTrait(argument.genericArguments) ||
          argument.bounds.some(rustTypeBoundContainsImplTrait);
      case "lifetime":
      case "const":
        return false;
    }
  });
}

function rustTypeBoundContainsImplTrait(bound: RustTypeBound): boolean {
  switch (bound.kind) {
    case "trait-type":
      return rustTypeContainsImplTrait(bound.reference.trait);
    case "callable":
      return bound.parameters.some(rustTypeContainsImplTrait) ||
        rustTypeContainsImplTrait(bound.result);
    case "trait":
    case "lifetime":
    case "maybe-sized":
      return false;
  }
}

export function collectAliasesFromRustType(
  type: RustType | undefined,
  register: (path: string) => void,
): void {
  if (type === undefined) {
    return;
  }
  if (type.kind === "named") {
    register(type.path);
    collectAliasesFromRustGenericArguments(type.genericArguments, register);
    return;
  }
  if (type.kind === "qualified") {
    collectAliasesFromRustType(type.owner, register);
    collectAliasesFromRustType(type.trait, register);
    collectAliasesFromRustGenericArguments(type.genericArguments, register);
    return;
  }
  if (type.kind === "trait-object") {
    collectAliasesFromRustType(type.principal.trait, register);
    for (const trait of type.autoTraits) collectAliasesFromRustType(trait.trait, register);
    return;
  }
  if (type.kind === "impl-trait") {
    for (const bound of type.bounds) collectAliasesFromRustTypeBound(bound, register);
    return;
  }
  if (type.kind === "slice") {
    collectAliasesFromRustType(type.element, register);
    return;
  }
  if (type.kind === "reference") {
    collectAliasesFromRustType(type.referent, register);
    return;
  }
  if (type.kind === "function-pointer") {
    for (const parameter of type.parameters) {
      collectAliasesFromRustType(parameter, register);
    }
    collectAliasesFromRustType(type.result, register);
    return;
  }
  if (type.kind === "fixed-array") {
    collectAliasesFromRustType(type.element, register);
    return;
  }
  if (type.kind === "tuple") {
    for (const element of type.elements) {
      collectAliasesFromRustType(element, register);
    }
  }
}

function collectAliasesFromRustGenericArguments(
  arguments_: readonly RustGenericArgument[] | undefined,
  register: (path: string) => void,
): void {
  for (const argument of arguments_ ?? []) {
    switch (argument.kind) {
      case "type":
        collectAliasesFromRustType(argument.type, register);
        break;
      case "associated-equality":
        collectAliasesFromRustGenericArguments(argument.genericArguments, register);
        collectAliasesFromRustType(argument.type, register);
        break;
      case "associated-bounds":
        collectAliasesFromRustGenericArguments(argument.genericArguments, register);
        for (const bound of argument.bounds) {
          collectAliasesFromRustTypeBound(bound, register);
        }
        break;
      case "lifetime":
      case "const":
        break;
    }
  }
}

function collectAliasesFromRustTypeBound(
  bound: RustTypeBound,
  register: (path: string) => void,
): void {
  switch (bound.kind) {
    case "trait":
      register(bound.path);
      return;
    case "trait-type":
      collectAliasesFromRustType(bound.reference.trait, register);
      return;
    case "callable":
      for (const parameter of bound.parameters) {
        collectAliasesFromRustType(parameter, register);
      }
      collectAliasesFromRustType(bound.result, register);
      return;
    case "lifetime":
    case "maybe-sized":
      return;
  }
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
  const rendered = rustTargetGenericArgumentToAstInContext(argument, context);
  return rendered?.kind === "type" || rendered?.kind === "const"
    ? rendered
    : undefined;
}

function rustLifetimeBinderToAst(
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
  resolveSourceTypePath?: (value: { readonly fileName: string; readonly typeName: string }) => string | undefined,
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
