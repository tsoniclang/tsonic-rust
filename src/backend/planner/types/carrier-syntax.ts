import type { RustTargetConstArgument, RustProgramErrorOwner, RustTargetGenericArgument, TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustGenericArgument, RustConstArgument, RustLifetimeParameter, RustTraitReference, RustType, RustTypeBound } from "../../target-ast/syntax/nodes.js";
import { type RustLifetimeBinder } from "../../../target-model/lifetimes/index.js";
import { rustProgramErrorOwner } from "../../../target-model/types/carriers/program-errors.js";
import { rustProducerErrorReference } from "../../../target-model/types/carriers/producer-errors.js";
import { rustNativeErrorJoinReference, type RustNativeErrorJoinReference } from "../../../target-model/types/native-error-joins.js";
import { rustGenericCallableValue } from "../../../target-model/types/carriers/generic-callables.js";
import { rustFrameCallableValue } from "../../../target-model/types/carriers/frame-callables.js";
import { rustClassConstructorInstance } from "../../../target-model/types/carriers/class-constructors.js";
import { bindRustCallableInputLifetimes } from "../../../target-model/types/carriers/callable-input-lifetimes.js";
import { rustSourceTypeCarrierValue, rustSourceUnionCarrierValue, rustStructuralObjectCarrierValue, rustBuiltInCarrierDefinitions,
  rustCallableTargetId, rustCallableInputTargetId, rustFixedArrayCarrierValue, rustNamedTypeCarrierValue, rustPrimitiveTypeName,
  rustStringTargetId, rustStrTargetId, isRustNeverCarrier, isRustAbsenceCarrier, rustOnlyTypeGenericArguments,
  rustJsPromiseTargetId, rustUnitTargetType, rustProgramErrorTargetId } from "../../../target-model/types/index.js";
import { rustLifetimeToAst } from "./lifetime-syntax.js";
import { rustExplicitNamedTypeArguments } from "./generic-defaults.js";
import { getRustGeneratorProtocol } from "../../../target-model/types/carriers/callables.js";
import { rustGeneratorTargetId, rustAsyncGeneratorTargetId, rustBorrowedGeneratorTargetId,
  rustBorrowedAsyncGeneratorTargetId } from "../../../target-model/types/carriers/source-types.js";

export const rustStrRefType: RustType = {
  kind: "reference",
  referent: { kind: "str" },
  mutable: false,
};

export interface RustSourceTypeRendering {
  readonly payloadArgumentsFor: (carrier: TargetTypeRef) => readonly RustTargetGenericArgument[] | undefined;
  readonly typeParameterNames?: ReadonlyMap<string, string>;
  readonly pathFor: (value: { readonly fileName: string; readonly typeName: string }) => string | undefined;
  readonly additionalArgumentsFor: (carrier: TargetTypeRef) => readonly RustGenericArgument[];
  readonly programErrorType?: (owner: RustProgramErrorOwner) => RustType | undefined;
  readonly producerErrorType?: (carrier: TargetTypeRef) => RustType | undefined;
  readonly nativeErrorJoinType?: (reference: RustNativeErrorJoinReference) => RustType | undefined;
}

export function rustTypeFromCarrier(
  carrier: TargetTypeRef | undefined,
  resolveSourceTypePath?: RustSourceTypeRendering,
  resolveStructuralShape?: (carrier: TargetTypeRef) => RustType | undefined,
  position: "general" | "parameter" | "return" = "general",
): RustType | undefined {
  if (carrier === undefined) {
    return undefined;
  }
  const producerError = rustProducerErrorReference(carrier);
  if (producerError !== undefined) return resolveSourceTypePath?.producerErrorType?.(carrier);
  const joinedError = rustNativeErrorJoinReference(carrier);
  if (joinedError !== undefined) return resolveSourceTypePath?.nativeErrorJoinType?.(joinedError);
  if (carrier.kind === "trait-ref") {
    const reference = rustTraitReferenceFromCarrier(carrier, resolveSourceTypePath, resolveStructuralShape, position);
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
      ? bindRustCallableInputLifetimes(argumentsCarrier.elements, resultCarrier, { kind: "invocation" }) : undefined;
    if (carrier.id === rustCallableInputTargetId && signature === undefined) return undefined;
    const argumentsType = rustTypeFromCarrier(signature === undefined ? argumentsCarrier :
      { kind: "tuple", elements: signature.parameters }, resolveSourceTypePath, resolveStructuralShape, position);
    const resultType = rustTypeFromCarrier(signature?.result ?? resultCarrier, resolveSourceTypePath, resolveStructuralShape, position);
    const packageResult = rustProgramErrorOwner(errorCarrier)?.kind === "logical";
    const errorType = errorCarrier === undefined || packageResult ? undefined
      : rustTypeFromCarrier(errorCarrier, resolveSourceTypePath, resolveStructuralShape, position);
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
    if ((carrier.id === rustGeneratorTargetId || carrier.id === rustAsyncGeneratorTargetId ||
      carrier.id === rustBorrowedGeneratorTargetId || carrier.id === rustBorrowedAsyncGeneratorTargetId) &&
      getRustGeneratorProtocol(carrier)?.physical === undefined) return undefined;
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
      position,
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
      : rustTypeFromCarrier(carrier.referent, resolveSourceTypePath, resolveStructuralShape, position);
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
    const element = rustTypeFromCarrier(carrier.element, resolveSourceTypePath, resolveStructuralShape, position);
    return element === undefined ? undefined : { kind: "slice", element };
  }
  if (carrier.kind === "pointer" &&
    (carrier.mutability === "const" || carrier.mutability === "mut")) {
    const pointee = rustTypeFromCarrier(carrier.pointee, resolveSourceTypePath, resolveStructuralShape, position);
    return pointee === undefined
      ? undefined
      : { kind: "raw-pointer", pointee, mutable: carrier.mutability === "mut" };
  }
  if (carrier.kind === "function-pointer") {
    const parameters = carrier.args.map((argument) =>
      rustTypeFromCarrier(argument, resolveSourceTypePath, resolveStructuralShape, position));
    const result = rustReturnTypeFromCarrier(
      carrier.result,
      resolveSourceTypePath,
      resolveStructuralShape,
      position,
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
      rustTypeFromCarrier(argument, resolveSourceTypePath, resolveStructuralShape, position));
    const result = rustReturnTypeFromCarrier(
      carrier.result,
      resolveSourceTypePath,
      resolveStructuralShape,
      position,
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
    const element = rustTypeFromCarrier(fixedArray.element, resolveSourceTypePath, resolveStructuralShape, position);
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
      position,
    );
    return genericArguments === undefined
      ? undefined
      : {
          kind: "named",
          path: namedType.path,
          identity: namedType.id,
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
    const element = rustTypeFromCarrier(carrier.element, resolveSourceTypePath, resolveStructuralShape, position);
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
      rustTypeFromCarrier(element, resolveSourceTypePath, resolveStructuralShape, position));
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
        position,
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
      const arguments_ = resolveSourceTypePath.payloadArgumentsFor(carrier);
      const genericArguments = arguments_ === undefined ? undefined : rustGenericArgumentsFromCarrier(
        arguments_, resolveSourceTypePath, resolveStructuralShape, position,
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
      position,
    );
    const autoTraits = carrier.autoTraits.map((trait) => rustTraitReferenceFromCarrier(
      trait,
      resolveSourceTypePath,
      resolveStructuralShape,
      position,
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
      position,
    ));
    const captures = rustGenericArgumentsFromCarrier(
      carrier.captures,
      resolveSourceTypePath,
      resolveStructuralShape,
      position,
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
          ...(position === "parameter" ? {} : { captures }),
        };
  }
  if (carrier.kind === "associated-type") {
    const owner = rustTypeFromCarrier(
      carrier.owner,
      resolveSourceTypePath,
      resolveStructuralShape,
      position,
    );
    const traitReference = carrier.trait === undefined
      ? undefined
      : rustTraitReferenceFromCarrier(
          carrier.trait,
          resolveSourceTypePath,
          resolveStructuralShape,
          position,
        );
    const genericArguments = rustGenericArgumentsFromCarrier(
      carrier.genericArguments,
      resolveSourceTypePath,
      resolveStructuralShape,
      position,
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
  position: "general" | "parameter" | "return" = "general",
): RustTraitReference | undefined {
  if (carrier.kind !== "trait-ref") return undefined;
  const path = carrier.sourceItem === undefined ? carrier.path : resolveSourceTypePath?.pathFor(carrier.sourceItem);
  if (path === undefined) return undefined;
  const genericArguments = rustGenericArgumentsFromCarrier(
    carrier.genericArguments,
    resolveSourceTypePath,
    resolveStructuralShape,
    position,
  );
  if (genericArguments === undefined) return undefined;
  const associatedConstraints = carrier.associatedConstraints.map((constraint) => {
    const arguments_ = rustGenericArgumentsFromCarrier(
      constraint.genericArguments,
      resolveSourceTypePath,
      resolveStructuralShape,
      position,
    );
    if (arguments_ === undefined) return undefined;
    if (constraint.kind === "equality") {
      const type = rustTypeFromCarrier(
        constraint.type,
        resolveSourceTypePath,
        resolveStructuralShape,
        position,
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
      position,
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
  position: "general" | "parameter" | "return" = "general",
): RustType | undefined {
  return isRustNeverCarrier(carrier)
    ? { kind: "never" }
    : rustTypeFromCarrier(carrier, resolveSourceTypePath, resolveStructuralShape, position);
}

export function isFloatCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "source-primitive" && (carrier.name === "float32" || carrier.name === "float64");
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

export function rustGenericArgumentsFromCarrier(
  arguments_: readonly RustTargetGenericArgument[] | undefined,
  resolveSourceTypePath?: RustSourceTypeRendering,
  resolveStructuralShape?: (carrier: TargetTypeRef) => RustType | undefined,
  position: "general" | "parameter" | "return" = "general",
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
      position,
    );
    if (type === undefined) return undefined;
    result.push({ kind: "type", type });
  }
  return Object.freeze(result);
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

export function typeGenericArguments(types: readonly RustType[]): readonly RustGenericArgument[] {
  return Object.freeze(types.map((type) => ({ kind: "type" as const, type })));
}
