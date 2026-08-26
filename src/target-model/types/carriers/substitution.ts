import { rustFixedArrayCarrierValue, rustFixedArrayTargetType, rustNamedTargetType, rustNamedTypeCarrierValue } from "./native.js";
import { rustSourceTypeCarrier, rustSourceTypeCarrierValue, rustSourceUnionCarrierValue, rustSourceUnionTargetType, rustStructuralObjectCarrierValue, rustStructuralObjectTargetType } from "./source-types.js";
import type {
  RustTargetConstArgument,
  RustTargetGenericArgument,
  RustTargetTraitRef,
  TargetTypeRef,
} from "../model.js";
import { rustLifetimeKey } from "../../lifetimes/index.js";
import type { RustLifetimeRef } from "../../lifetimes/index.js";

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
): TargetTypeRef {
  const substituteLifetime = (lifetime: RustLifetimeRef): RustLifetimeRef =>
    lifetimeSubstitutions.get(rustLifetimeKey(lifetime)) ?? lifetime;
  switch (type.kind) {
    case "type-parameter":
      return substitutions.get(type.name) ?? type;
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
              ),
            }),
      };
    case "array":
      return {
        ...type,
        element: substituteRustTargetGenerics(
          type.element,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
        ),
      };
    case "slice":
      return {
        ...type,
        element: substituteRustTargetGenerics(
          type.element,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
        ),
      };
    case "tuple":
      return {
        ...type,
        elements: type.elements.map((element) => substituteRustTargetGenerics(
          element,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
        )),
      };
    case "reference":
      return {
        ...type,
        ...(type.lifetime === undefined ? {} : { lifetime: substituteLifetime(type.lifetime) }),
        referent: substituteRustTargetGenerics(
          type.referent,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
        ),
      };
    case "pointer":
      return {
        ...type,
        pointee: substituteRustTargetGenerics(
          type.pointee,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
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
          substituteRustTargetGenerics(
            argument,
            substitutions,
            nestedLifetimes,
            constSubstitutions,
          )),
        result: substituteRustTargetGenerics(
          type.result,
          substitutions,
          nestedLifetimes,
          constSubstitutions,
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
                  ),
                  type: substituteRustTargetGenerics(
                    constraint.type,
                    substitutions,
                    nestedLifetimes,
                    constSubstitutions,
                  ),
                }
              : {
                  ...constraint,
                  genericArguments: substituteGenericArguments(
                    constraint.genericArguments,
                    substitutions,
                    nestedLifetimes,
                    constSubstitutions,
                  ),
                  traits: constraint.traits.map((trait) =>
                    substituteRustTargetTraitRef(
                      trait,
                      substitutions,
                      nestedLifetimes,
                      constSubstitutions,
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
          substituteRustTargetGenerics(
            argument,
            substitutions,
            nestedLifetimes,
            constSubstitutions,
          )),
        result: substituteRustTargetGenerics(
          type.result,
          substitutions,
          nestedLifetimes,
          constSubstitutions,
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
        ),
        autoTraits: type.autoTraits.map((trait) =>
          substituteRustTargetTraitRef(
            trait,
            substitutions,
            lifetimeSubstitutions,
            constSubstitutions,
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
          )),
        outlives: type.outlives.map(substituteLifetime),
        captures: type.captures.map(substituteLifetime),
      };
    case "associated-type":
      return {
        ...type,
        owner: substituteRustTargetGenerics(
          type.owner,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
        ),
        ...(type.trait === undefined
          ? {}
          : {
              trait: substituteRustTargetTraitRef(
                type.trait,
                substitutions,
                lifetimeSubstitutions,
                constSubstitutions,
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
              ),
            }),
      };
    case "target-specific": {
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
          ),
        );
      }
      const structuralObject = rustStructuralObjectCarrierValue(type);
      if (structuralObject !== undefined) {
        return rustStructuralObjectTargetType(structuralObject.ownerFileName, structuralObject.fields.map((field) => ({
          ...field,
          type: substituteRustTargetGenerics(
            field.type,
            substitutions,
            lifetimeSubstitutions,
            constSubstitutions,
          ),
        })));
      }
      const sourceUnion = rustSourceUnionCarrierValue(type);
      if (sourceUnion !== undefined) {
        return rustSourceUnionTargetType(
          sourceUnion.fileName,
          sourceUnion.typeName,
          sourceUnion.variants.map((variant) => ({
            ...variant,
            carrier: substituteRustTargetGenerics(
              variant.carrier,
              substitutions,
              lifetimeSubstitutions,
              constSubstitutions,
            ),
          })),
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
          ),
          substituteGenericArguments(
            namedType.genericDefaults,
            substitutions,
            lifetimeSubstitutions,
            constSubstitutions,
          ),
          namedType.traits,
        );
      }
      const fixedArray = rustFixedArrayCarrierValue(type);
      return fixedArray === undefined
        ? type
        : rustFixedArrayTargetType(
            substituteRustTargetGenerics(
              fixedArray.element,
              substitutions,
              lifetimeSubstitutions,
              constSubstitutions,
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

function substituteRustTargetTraitRef(
  trait: RustTargetTraitRef,
  substitutions: ReadonlyMap<string, TargetTypeRef>,
  lifetimeSubstitutions: ReadonlyMap<string, RustLifetimeRef>,
  constSubstitutions: ReadonlyMap<string, RustTargetConstArgument>,
): RustTargetTraitRef {
  const substituted = substituteRustTargetGenerics(
    trait,
    substitutions,
    lifetimeSubstitutions,
    constSubstitutions,
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
          type: substituteRustTargetGenerics(
            argument.type,
            typeSubstitutions,
            lifetimeSubstitutions,
            constSubstitutions,
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
): RustTargetGenericArgument {
  return substituteGenericArguments(
    [argument],
    typeSubstitutions,
    lifetimeSubstitutions,
    constSubstitutions,
  )[0]!;
}

function lifetimeSubstitutionsOutsideBinder(
  substitutions: ReadonlyMap<string, RustLifetimeRef>,
  binder: import("../../lifetimes/index.js").RustLifetimeBinder | undefined,
): ReadonlyMap<string, RustLifetimeRef> {
  if (binder === undefined || binder.parameters.length === 0) return substitutions;
  const nested = new Map(substitutions);
  for (const parameter of binder.parameters) {
    nested.delete(rustLifetimeKey(parameter.lifetime));
  }
  return nested;
}
