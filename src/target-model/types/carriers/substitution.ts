import { rustFixedArrayCarrierValue, rustFixedArrayTargetType, rustNamedTargetType, rustNamedTypeCarrierValue, rustNamedTypeTraitContract } from "./native.js";
import { rustSourceTypeCarrier, rustSourceTypeCarrierValue, rustSourceUnionCarrierValue, rustSourceUnionTargetType, rustStructuralObjectCarrierValue, rustStructuralObjectTargetType } from "./source-types.js";
import { rustClassConstructorContract, rustClassConstructorTargetType } from "./class-constructors.js";
import type {
  RustTargetConstArgument,
  RustTargetGenericArgument,
  RustTargetTraitRef,
  TargetTypeRef,
} from "../model.js";
import { rustLifetimeKey } from "../../lifetimes/index.js";
import type { RustLifetimeRef } from "../../lifetimes/index.js";
import { rustGenericCallableCarrier, rustGenericCallableValue } from "./generic-callables.js";
import { rustFrameCallableCarrier, rustFrameCallableValue } from "./frame-callables.js";
import { rustSourceOptionalTargetType } from "../projections.js";
import { rustProducerErrorReference, rustProducerErrorTargetType } from "./producer-errors.js";
import { rustNativeErrorJoinReference, rustNativeErrorJoinTargetType } from "../native-error-joins.js";
import { rustTargetCaptureArguments } from "./generic-references.js";
import { rustTargetTypeComponentRole, type RustTargetTypeChildRole, type RustTargetTypeChildSelector } from "./children.js";
import type { RustCallableSignature } from "./callable-signatures.js";

export function substituteRustTargetTypeParameters(
  type: TargetTypeRef,
  substitutions: ReadonlyMap<string, TargetTypeRef>,
): TargetTypeRef {
  return substituteRustTargetGenerics(type, substitutions, new Map());
}

export function substituteRustTargetGenerics(
  type: TargetTypeRef,
  substitutions: ReadonlyMap<string, TargetTypeRef>,
  lifetimeSubstitutions: ReadonlyMap<string, RustLifetimeRef>,
  constSubstitutions: ReadonlyMap<string, RustTargetConstArgument> = new Map(),
  normalize?: (type: TargetTypeRef, source: TargetTypeRef) => TargetTypeRef,
  shouldVisitChild?: RustTargetTypeChildSelector,
): TargetTypeRef {
  const result = substituteCarrierParts(type, substitutions, lifetimeSubstitutions, constSubstitutions, normalize, shouldVisitChild);
  return normalize === undefined ? result : normalize(result, type);
}

export function mapRustTargetTypes(
  type: TargetTypeRef,
  normalize: (type: TargetTypeRef, source: TargetTypeRef) => TargetTypeRef,
  shouldVisitChild?: RustTargetTypeChildSelector,
): TargetTypeRef {
  return substituteRustTargetGenerics(type, new Map(), new Map(), new Map(), normalize, shouldVisitChild);
}

function substituteCarrierParts(
  type: TargetTypeRef,
  substitutions: ReadonlyMap<string, TargetTypeRef>,
  lifetimeSubstitutions: ReadonlyMap<string, RustLifetimeRef>,
  constSubstitutions: ReadonlyMap<string, RustTargetConstArgument>,
  normalize?: (type: TargetTypeRef, source: TargetTypeRef) => TargetTypeRef,
  shouldVisitChild?: RustTargetTypeChildSelector,
): TargetTypeRef {
  const substituteChild = (
    child: TargetTypeRef,
    types: ReadonlyMap<string, TargetTypeRef>,
    lifetimes: ReadonlyMap<string, RustLifetimeRef>,
    consts: ReadonlyMap<string, RustTargetConstArgument>,
    normalize?: (type: TargetTypeRef, source: TargetTypeRef) => TargetTypeRef,
    role: RustTargetTypeChildRole = rustTargetTypeComponentRole,
  ): TargetTypeRef => shouldVisitChild?.(type, child, role) === false ? child :
    substituteRustTargetGenerics(child, types, lifetimes, consts, normalize, shouldVisitChild);
  const substituteLifetime = (lifetime: RustLifetimeRef): RustLifetimeRef =>
    lifetimeSubstitutions.get(rustLifetimeKey(lifetime)) ?? lifetime;
  switch (type.kind) {
    case "type-parameter":
      return (() => {
        if (type.optionalStorageValue !== undefined) {
          return rustSourceOptionalTargetType(substituteChild(type.optionalStorageValue,
            substitutions, lifetimeSubstitutions, constSubstitutions, normalize));
        }
        const replacement = substitutions.get(type.identity);
        return replacement === undefined ? type : normalize === undefined
          ? replacement : mapRustTargetTypes(replacement, normalize, shouldVisitChild);
      })();
    case "target-named":
      return {
        ...type,
        ...(type.genericArguments === undefined
          ? {}
          : {
              genericArguments: substituteGenericArguments(
                type.genericArguments,
                substitutions,
                lifetimeSubstitutions,
                constSubstitutions,
                normalize,
                substituteChild,
              ),
            }),
      };
    case "array":
      return {
        ...type,
        element: substituteChild(
          type.element,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
          normalize,
        ),
      };
    case "slice":
      return {
        ...type,
        element: substituteChild(
          type.element,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
          normalize,
        ),
      };
    case "tuple":
      return {
        ...type,
        elements: type.elements.map((element) => substituteChild(
          element,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
          normalize,
        )),
      };
    case "reference":
      return {
        ...type,
        ...(type.lifetime === undefined ? {} : { lifetime: substituteLifetime(type.lifetime) }),
        referent: substituteChild(
          type.referent,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
          normalize,
        ),
      };
    case "pointer":
      return {
        ...type,
        pointee: substituteChild(
          type.pointee,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
          normalize,
        ),
      };
    case "function-pointer":
      return (() => {
        const nestedLifetimes = lifetimeSubstitutionsOutsideBinder(
          lifetimeSubstitutions,
          type.lifetimeBinder,
        );
        return {
        ...type,
        ...(type.lifetimeBinder === undefined
          ? {}
          : {
              lifetimeBinder: {
                ...type.lifetimeBinder,
                parameters: type.lifetimeBinder.parameters.map((parameter) => ({
                  ...parameter,
                  outlives: parameter.outlives.map((lifetime) =>
                    nestedLifetimes.get(rustLifetimeKey(lifetime)) ?? lifetime),
                })),
              },
            }),
        args: type.args.map((argument) =>
          substituteChild(
            argument,
            substitutions,
            nestedLifetimes,
            constSubstitutions,
            normalize,
          )),
        result: substituteChild(
          type.result,
          substitutions,
          nestedLifetimes,
          constSubstitutions,
          normalize,
        ),
        };
      })();
    case "trait-ref":
      return (() => {
        const nestedLifetimes = lifetimeSubstitutionsOutsideBinder(
          lifetimeSubstitutions,
          type.lifetimeBinder,
        );
        return {
          ...type,
          ...(type.lifetimeBinder === undefined
            ? {}
            : {
                lifetimeBinder: {
                  ...type.lifetimeBinder,
                  parameters: type.lifetimeBinder.parameters.map((parameter) => ({
                    ...parameter,
                    outlives: parameter.outlives.map((lifetime) =>
                      nestedLifetimes.get(rustLifetimeKey(lifetime)) ?? lifetime),
                  })),
                },
              }),
          genericArguments: substituteGenericArguments(
            type.genericArguments,
            substitutions,
            nestedLifetimes,
            constSubstitutions,
            normalize,
            substituteChild,
          ),
          associatedConstraints: type.associatedConstraints.map((constraint) =>
            constraint.kind === "equality"
              ? {
                  ...constraint,
                  genericArguments: substituteGenericArguments(
                    constraint.genericArguments,
                    substitutions,
                    nestedLifetimes,
                    constSubstitutions,
                    normalize,
                    substituteChild,
                  ),
                  type: substituteChild(
                    constraint.type,
                    substitutions,
                    nestedLifetimes,
                    constSubstitutions,
                    normalize,
                  ),
                }
              : {
                  ...constraint,
                  genericArguments: substituteGenericArguments(
                    constraint.genericArguments,
                    substitutions,
                    nestedLifetimes,
                    constSubstitutions,
                    normalize,
                    substituteChild,
                  ),
                  traits: constraint.traits.map((trait) =>
                    substituteRustTargetTraitRef(
                      trait,
                      substitutions,
                      nestedLifetimes,
                      constSubstitutions,
                      normalize,
                      substituteChild,
                    )),
                  outlives: constraint.outlives.map((lifetime) =>
                    nestedLifetimes.get(rustLifetimeKey(lifetime)) ?? lifetime),
                }),
        };
      })();
    case "closure":
      return (() => {
        const nestedLifetimes = lifetimeSubstitutionsOutsideBinder(
          lifetimeSubstitutions,
          type.lifetimeBinder,
        );
        return {
        ...type,
        ...(type.lifetimeBinder === undefined
          ? {}
          : {
              lifetimeBinder: {
                ...type.lifetimeBinder,
                parameters: type.lifetimeBinder.parameters.map((parameter) => ({
                  ...parameter,
                  outlives: parameter.outlives.map((lifetime) =>
                    nestedLifetimes.get(rustLifetimeKey(lifetime)) ?? lifetime),
                })),
              },
            }),
        args: type.args.map((argument) =>
          substituteChild(
            argument,
            substitutions,
            nestedLifetimes,
            constSubstitutions,
            normalize,
          )),
        result: substituteChild(
          type.result,
          substitutions,
          nestedLifetimes,
          constSubstitutions,
          normalize,
        ),
        };
      })();
    case "trait-object":
      return {
        ...type,
        principal: substituteRustTargetTraitRef(
          type.principal,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
          normalize,
          substituteChild,
        ),
        autoTraits: type.autoTraits.map((trait) =>
          substituteRustTargetTraitRef(
            trait,
            substitutions,
            lifetimeSubstitutions,
            constSubstitutions,
            normalize,
            substituteChild,
          )),
        ...(type.lifetime === undefined ? {} : { lifetime: substituteLifetime(type.lifetime) }),
      };
    case "impl-trait":
      return {
        ...type,
        bounds: type.bounds.map((bound) =>
          substituteRustTargetTraitRef(
            bound,
            substitutions,
            lifetimeSubstitutions,
            constSubstitutions,
            normalize,
            substituteChild,
          )),
        outlives: type.outlives.map(substituteLifetime),
        captures: rustTargetCaptureArguments(substituteGenericArguments(
          type.captures,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
          normalize,
          substituteChild,
        )),
      };
    case "associated-type":
      return {
        ...type,
        owner: substituteChild(
          type.owner,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
          normalize,
        ),
        ...(type.trait === undefined
          ? {}
          : {
              trait: substituteRustTargetTraitRef(
                type.trait,
                substitutions,
                lifetimeSubstitutions,
                constSubstitutions,
                normalize,
                substituteChild,
              ),
            }),
        ...(type.genericArguments === undefined
          ? {}
          : {
              genericArguments: substituteGenericArguments(
                type.genericArguments,
                substitutions,
                lifetimeSubstitutions,
                constSubstitutions,
                normalize,
                substituteChild,
              ),
            }),
      };
    case "target-specific": {
      const joinedError = rustNativeErrorJoinReference(type);
      if (joinedError !== undefined) {
        const selected = rustNativeErrorJoinTargetType(joinedError.fileName, joinedError.errors.map(error =>
          substituteChild(error, substitutions, lifetimeSubstitutions, constSubstitutions, normalize)));
        if (selected === undefined) throw new Error("Native error substitution exceeds its validated payload contract.");
        return selected;
      }
      const producerError = rustProducerErrorReference(type);
      if (producerError !== undefined) return rustProducerErrorTargetType({ ...producerError,
        genericArguments: substituteGenericArguments(producerError.genericArguments, substitutions,
          lifetimeSubstitutions, constSubstitutions, normalize, substituteChild),
      });
      const constructor = rustClassConstructorContract(type);
      if (constructor !== undefined) {
        const arguments_ = rustSourceTypeCarrierValue(constructor.instance)!.genericArguments;
        const scopedTypes = new Map(substitutions);
        const scopedLifetimes = new Map(lifetimeSubstitutions);
        for (const index of constructor.boundParameterIndexes) {
          const argument = arguments_[index]!;
          if (argument.kind === "type" && argument.type.kind === "type-parameter") scopedTypes.delete(argument.type.identity);
          if (argument.kind === "lifetime") scopedLifetimes.delete(rustLifetimeKey(argument.lifetime));
        }
        return rustClassConstructorTargetType(substituteChild(constructor.instance, scopedTypes,
          scopedLifetimes, constSubstitutions, normalize), constructor.boundParameterIndexes);
      }
      const callable = rustGenericCallableValue(type);
      if (callable !== undefined) return rustGenericCallableCarrier({
        origin: callable.origin,
        signature: substituteCallableSignatureLifetimes(callable.signature, lifetimeSubstitutions),
        environment: callable.environment.map(argument => substituteChild(
          argument, substitutions, lifetimeSubstitutions, constSubstitutions, normalize)),
        retainedEnvironment: callable.retainedEnvironment.map(argument => substituteChild(
          argument, substitutions, lifetimeSubstitutions, constSubstitutions, normalize)),
        ...(callable.physical === undefined ? {} : { physical: { ...callable.physical,
          arguments: substituteGenericArguments(callable.physical.arguments, substitutions,
            lifetimeSubstitutions, constSubstitutions, normalize, substituteChild),
        } }),
      });
      const frame = rustFrameCallableValue(type);
      if (frame !== undefined) return rustFrameCallableCarrier({
        owner: frame.owner.kind === "lexical" ? frame.owner : { ...frame.owner,
          instance: substituteChild(frame.owner.instance, substitutions,
            lifetimeSubstitutions, constSubstitutions, normalize) },
        signature: substituteCallableSignatureLifetimes(frame.signature, lifetimeSubstitutions),
        environment: frame.environment.map(argument => substituteChild(
          argument, substitutions, lifetimeSubstitutions, constSubstitutions, normalize)),
      });
      const sourceType = rustSourceTypeCarrierValue(type);
      if (sourceType !== undefined) {
        return rustSourceTypeCarrier(
          sourceType.fileName,
          sourceType.typeName,
          sourceType.shape,
          substituteGenericArguments(
            sourceType.genericArguments,
            substitutions,
            lifetimeSubstitutions,
            constSubstitutions,
            normalize,
            substituteChild,
          ),
        );
      }
      const structuralObject = rustStructuralObjectCarrierValue(type);
      if (structuralObject !== undefined) {
        return rustStructuralObjectTargetType(structuralObject.ownerFileName, structuralObject.fields.map((field, index) => ({
          ...field,
          type: substituteChild(
            field.type,
            substitutions,
            lifetimeSubstitutions,
            constSubstitutions,
            normalize,
            { kind: "structural-field", index, structural: structuralObject },
          ),
        })), structuralObject.representation, structuralObject.construction === undefined ? undefined :
          substituteChild(structuralObject.construction, substitutions, lifetimeSubstitutions, constSubstitutions, normalize,
            { kind: "structural-construction", structural: structuralObject }),
          structuralObject.bases.map(base => substituteChild(base, substitutions, lifetimeSubstitutions, constSubstitutions, normalize)));
      }
      const sourceUnion = rustSourceUnionCarrierValue(type);
      if (sourceUnion !== undefined) {
        return rustSourceUnionTargetType(
          sourceUnion.fileName,
          sourceUnion.typeName,
          substituteGenericArguments(sourceUnion.genericArguments, substitutions, lifetimeSubstitutions, constSubstitutions, normalize, substituteChild),
          sourceUnion.origin,
          sourceUnion.payloads.kind === "source" ? sourceUnion.payloads : { kind: "physical",
            types: sourceUnion.payloads.types.map(payload => substituteChild(payload,
              substitutions, lifetimeSubstitutions, constSubstitutions, normalize)) },
        );
      }
      const namedType = rustNamedTypeCarrierValue(type);
      if (namedType !== undefined) {
        return rustNamedTargetType(
          namedType.id,
          namedType.path,
          substituteGenericArguments(
            namedType.genericArguments,
            substitutions,
            lifetimeSubstitutions,
            constSubstitutions,
            normalize,
            substituteChild,
          ),
          substituteGenericArguments(
            namedType.genericDefaults,
            substitutions,
            lifetimeSubstitutions,
            constSubstitutions,
            normalize,
            substituteChild,
          ),
          rustNamedTypeTraitContract(namedType.traits.implementations.map(implementation => ({
            trait: substituteRustTargetTraitRef(implementation.trait, substitutions, lifetimeSubstitutions,
              constSubstitutions, normalize, substituteChild),
            requirements: implementation.requirements.map(requirement => ({ ...requirement,
              trait: substituteRustTargetTraitRef(requirement.trait, substitutions, lifetimeSubstitutions,
                constSubstitutions, normalize, substituteChild),
            })),
          }))),
          namedType.upcasts.map((upcast) => ({
            ...upcast,
            target: substituteChild(upcast.target, substitutions, lifetimeSubstitutions, constSubstitutions, normalize),
          })),
        );
      }
      const fixedArray = rustFixedArrayCarrierValue(type);
      return fixedArray === undefined
        ? type
        : rustFixedArrayTargetType(
            substituteChild(
              fixedArray.element,
              substitutions,
              lifetimeSubstitutions,
              constSubstitutions,
              normalize,
            ),
            fixedArray.length.kind === "parameter"
              ? constSubstitutions.get(fixedArray.length.identity) ?? fixedArray.length
              : fixedArray.length,
          );
    }
    default:
      return type;
  }
}

type RustCarrierSubstitution = (
  type: TargetTypeRef,
  substitutions: ReadonlyMap<string, TargetTypeRef>,
  lifetimeSubstitutions: ReadonlyMap<string, RustLifetimeRef>,
  constSubstitutions: ReadonlyMap<string, RustTargetConstArgument>,
  normalize?: (type: TargetTypeRef, source: TargetTypeRef) => TargetTypeRef,
) => TargetTypeRef;

export function substituteRustTargetTraitRef(
  trait: RustTargetTraitRef,
  substitutions: ReadonlyMap<string, TargetTypeRef>,
  lifetimeSubstitutions: ReadonlyMap<string, RustLifetimeRef>,
  constSubstitutions: ReadonlyMap<string, RustTargetConstArgument>,
  normalize: ((type: TargetTypeRef, source: TargetTypeRef) => TargetTypeRef) | undefined = undefined,
  substitute: RustCarrierSubstitution = substituteRustTargetGenerics,
): RustTargetTraitRef {
  const substituted = substitute(
    trait,
    substitutions,
    lifetimeSubstitutions,
    constSubstitutions,
    normalize,
  );
  if (substituted.kind !== "trait-ref") {
    throw new Error("Rust trait substitution changed the exact target trait carrier kind.");
  }
  return substituted;
}

function substituteGenericArguments(
  arguments_: readonly RustTargetGenericArgument[],
  typeSubstitutions: ReadonlyMap<string, TargetTypeRef>,
  lifetimeSubstitutions: ReadonlyMap<string, RustLifetimeRef>,
  constSubstitutions: ReadonlyMap<string, RustTargetConstArgument>,
  normalize: ((type: TargetTypeRef, source: TargetTypeRef) => TargetTypeRef) | undefined,
  substitute: RustCarrierSubstitution,
): readonly RustTargetGenericArgument[] {
  return Object.freeze(arguments_.map((argument): RustTargetGenericArgument => {
    switch (argument.kind) {
      case "lifetime":
        return {
          kind: "lifetime",
          lifetime: lifetimeSubstitutions.get(rustLifetimeKey(argument.lifetime)) ??
            argument.lifetime,
        };
      case "type":
        return {
          kind: "type",
          type: substitute(
            argument.type,
            typeSubstitutions,
            lifetimeSubstitutions,
            constSubstitutions,
            normalize,
          ),
        };
      case "const":
        return argument.value.kind === "parameter"
          ? {
              kind: "const",
              value: constSubstitutions.get(argument.value.identity) ?? argument.value,
            }
          : argument;
    }
  }));
}

export function substituteRustTargetGenericArgument(
  argument: RustTargetGenericArgument,
  typeSubstitutions: ReadonlyMap<string, TargetTypeRef>,
  lifetimeSubstitutions: ReadonlyMap<string, RustLifetimeRef>,
  constSubstitutions: ReadonlyMap<string, RustTargetConstArgument> = new Map(),
  normalize?: (type: TargetTypeRef, source: TargetTypeRef) => TargetTypeRef,
): RustTargetGenericArgument {
  return substituteGenericArguments(
    [argument],
    typeSubstitutions,
    lifetimeSubstitutions,
    constSubstitutions,
    normalize,
    substituteRustTargetGenerics,
  )[0]!;
}

function substituteCallableSignatureLifetimes(
  signature: RustCallableSignature,
  lifetimes: ReadonlyMap<string, RustLifetimeRef>,
): RustCallableSignature {
  if (lifetimes.size === 0) return signature;
  return { ...signature,
    parameters: signature.parameters.map(parameter => substituteRustTargetGenerics(parameter, new Map(), lifetimes)),
    result: substituteRustTargetGenerics(signature.result, new Map(), lifetimes),
  };
}

function lifetimeSubstitutionsOutsideBinder(
  substitutions: ReadonlyMap<string, RustLifetimeRef>,
  binder: import("../../lifetimes/model.js").RustLifetimeBinder | undefined,
): ReadonlyMap<string, RustLifetimeRef> {
  if (binder === undefined || binder.parameters.length === 0) return substitutions;
  const nested = new Map(substitutions);
  for (const parameter of binder.parameters) {
    nested.delete(rustLifetimeKey(parameter.lifetime));
  }
  return nested;
}
