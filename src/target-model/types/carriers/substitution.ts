import { isDenseDataArray } from "../../metadata/closed-data.js";
import { rustFixedArrayCarrierValue, rustFixedArrayTargetType, rustNamedTargetType, rustNamedTypeCarrierValue } from "./native.js";
import { rustSourceTypeCarrier, rustSourceTypeCarrierValue, rustSourceUnionCarrierValue, rustSourceUnionTargetType, rustStructuralObjectCarrierValue, rustStructuralObjectTargetType } from "./source-types.js";
import { rustTargetTypeRefEquals } from "../equality.js";
import type {
  RustTargetConstArgument,
  RustTargetGenericArgument,
  RustTargetTraitRef,
  TargetTypeRef,
} from "../model.js";
import { rustLifetimeKey, rustLifetimesEqual } from "../../lifetimes/index.js";
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

export function rustTargetTypeContainsTypeParameter(
  type: TargetTypeRef,
  selectedNames: ReadonlySet<string>,
): boolean {
  return visitRustTargetTypeParameters(type, (name) => selectedNames.has(name));
}

export function rustTargetTypeParameterNames(type: TargetTypeRef): readonly string[] {
  const names = new Set<string>();
  visitRustTargetTypeParameters(type, (name) => {
    names.add(name);
    return false;
  });
  return Object.freeze([...names].sort());
}

function visitRustTargetTypeParameters(
  type: TargetTypeRef,
  visit: (name: string) => boolean,
): boolean {
  switch (type.kind) {
    case "type-parameter":
      return visit(type.name);
    case "target-named":
      return visitGenericArgumentTypes(type.genericArguments, visit);
    case "array":
      return visitRustTargetTypeParameters(type.element, visit);
    case "slice":
      return visitRustTargetTypeParameters(type.element, visit);
    case "tuple":
      return type.elements.some((element) =>
        visitRustTargetTypeParameters(element, visit));
    case "reference":
      return visitRustTargetTypeParameters(type.referent, visit);
    case "pointer":
      return visitRustTargetTypeParameters(type.pointee, visit);
    case "function-pointer":
    case "closure":
      return type.args.some((argument) =>
        visitRustTargetTypeParameters(argument, visit)) ||
        visitRustTargetTypeParameters(type.result, visit);
    case "trait-ref":
      return visitGenericArgumentTypes(type.genericArguments, visit) ||
        type.associatedConstraints.some((constraint) =>
          visitGenericArgumentTypes(constraint.genericArguments, visit) ||
          (constraint.kind === "equality"
            ? visitRustTargetTypeParameters(constraint.type, visit)
            : constraint.traits.some((trait) =>
                visitRustTargetTypeParameters(trait, visit))));
    case "associated-type":
      return visitRustTargetTypeParameters(type.owner, visit) ||
        (type.trait !== undefined && visitRustTargetTypeParameters(type.trait, visit)) ||
        visitGenericArgumentTypes(type.genericArguments, visit);
    case "target-specific": {
      const sourceType = rustSourceTypeCarrierValue(type);
      if (sourceType !== undefined) {
        return visitGenericArgumentTypes(sourceType.genericArguments, visit);
      }
      const structuralObject = rustStructuralObjectCarrierValue(type);
      if (structuralObject !== undefined) {
        return structuralObject.fields.some((field) =>
          visitRustTargetTypeParameters(field.type, visit));
      }
      const sourceUnion = rustSourceUnionCarrierValue(type);
      if (sourceUnion !== undefined) {
        return sourceUnion.variants.some((variant) =>
          visitRustTargetTypeParameters(variant.carrier, visit));
      }
      const namedType = rustNamedTypeCarrierValue(type);
      if (namedType !== undefined) {
        return visitGenericArgumentTypes(namedType.genericArguments, visit);
      }
      const fixedArray = rustFixedArrayCarrierValue(type);
      return fixedArray !== undefined &&
        visitRustTargetTypeParameters(fixedArray.element, visit);
    }
    default:
      return false;
  }
}

function visitGenericArgumentTypes(
  arguments_: readonly RustTargetGenericArgument[] | undefined,
  visit: (name: string) => boolean,
): boolean {
  return arguments_?.some((argument) =>
    argument.kind === "type" && visitRustTargetTypeParameters(argument.type, visit)) === true;
}

export interface RustTargetGenericReferences {
  readonly typeNames: readonly string[];
  readonly lifetimes: readonly Extract<
    RustLifetimeRef,
    { readonly kind: "parameter" | "bound" }
  >[];
  readonly lifetimeIdentities: readonly string[];
  readonly constIdentities: readonly string[];
}

export function rustTargetGenericReferences(
  type: TargetTypeRef,
): RustTargetGenericReferences {
  const typeNames = new Set<string>();
  const lifetimes = new Map<string, Extract<
    RustLifetimeRef,
    { readonly kind: "parameter" | "bound" }
  >>();
  const constIdentities = new Set<string>();
  visitType(type, new Set());
  return Object.freeze({
    typeNames: Object.freeze([...typeNames].sort()),
    lifetimes: Object.freeze([...lifetimes]
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([, lifetime]) => lifetime)),
    lifetimeIdentities: Object.freeze([...lifetimes.keys()].sort()),
    constIdentities: Object.freeze([...constIdentities].sort()),
  });

  function visitLifetime(
    lifetime: RustLifetimeRef | undefined,
    bound: ReadonlySet<string>,
  ): void {
    if (lifetime === undefined) return;
    const identity = rustLifetimeKey(lifetime);
    if ((lifetime.kind === "parameter" || lifetime.kind === "bound") &&
      !bound.has(identity)) {
      const existing = lifetimes.get(identity);
      if (existing !== undefined && existing.name !== lifetime.name) {
        throw new Error("One Rust lifetime identity has contradictory target names.");
      }
      lifetimes.set(identity, lifetime);
    }
  }

  function visitConst(value: RustTargetConstArgument): void {
    if (value.kind === "parameter") constIdentities.add(value.identity);
  }

  function visitArguments(
    values: readonly RustTargetGenericArgument[] | undefined,
    bound: ReadonlySet<string>,
  ): void {
    for (const value of values ?? []) {
      if (value.kind === "type") visitType(value.type, bound);
      else if (value.kind === "lifetime") visitLifetime(value.lifetime, bound);
      else visitConst(value.value);
    }
  }

  function nestedBoundLifetimes(
    binder: import("../../lifetimes/index.js").RustLifetimeBinder | undefined,
    outer: ReadonlySet<string>,
  ): ReadonlySet<string> {
    if (binder === undefined) return outer;
    const nested = new Set(outer);
    for (const parameter of binder.parameters) {
      nested.add(rustLifetimeKey(parameter.lifetime));
      for (const lifetime of parameter.outlives) visitLifetime(lifetime, nested);
    }
    return nested;
  }

  function visitType(value: TargetTypeRef, bound: ReadonlySet<string>): void {
    switch (value.kind) {
      case "type-parameter":
        typeNames.add(value.name);
        return;
      case "target-named":
        visitArguments(value.genericArguments, bound);
        return;
      case "array":
      case "slice":
        visitType(value.element, bound);
        return;
      case "tuple":
        value.elements.forEach((element) => visitType(element, bound));
        return;
      case "reference":
        visitLifetime(value.lifetime, bound);
        visitType(value.referent, bound);
        return;
      case "pointer":
        visitType(value.pointee, bound);
        return;
      case "function-pointer":
      case "closure": {
        const nested = nestedBoundLifetimes(value.lifetimeBinder, bound);
        value.args.forEach((argument) => visitType(argument, nested));
        visitType(value.result, nested);
        return;
      }
      case "trait-ref": {
        const nested = nestedBoundLifetimes(value.lifetimeBinder, bound);
        visitArguments(value.genericArguments, nested);
        for (const constraint of value.associatedConstraints) {
          visitArguments(constraint.genericArguments, nested);
          if (constraint.kind === "equality") {
            visitType(constraint.type, nested);
          } else {
            constraint.traits.forEach((trait) => visitType(trait, nested));
            constraint.outlives.forEach((lifetime) => visitLifetime(lifetime, nested));
          }
        }
        return;
      }
      case "trait-object":
        visitLifetime(value.lifetime, bound);
        visitType(value.principal, bound);
        value.autoTraits.forEach((trait) => visitType(trait, bound));
        return;
      case "impl-trait":
        value.bounds.forEach((trait) => visitType(trait, bound));
        value.outlives.forEach((lifetime) => visitLifetime(lifetime, bound));
        value.captures.forEach((lifetime) => visitLifetime(lifetime, bound));
        return;
      case "associated-type":
        visitType(value.owner, bound);
        if (value.trait !== undefined) visitType(value.trait, bound);
        visitArguments(value.genericArguments, bound);
        return;
      case "target-specific": {
        const sourceType = rustSourceTypeCarrierValue(value);
        if (sourceType !== undefined) {
          visitArguments(sourceType.genericArguments, bound);
          return;
        }
        const structural = rustStructuralObjectCarrierValue(value);
        if (structural !== undefined) {
          structural.fields.forEach((field) => visitType(field.type, bound));
          return;
        }
        const union = rustSourceUnionCarrierValue(value);
        if (union !== undefined) {
          union.variants.forEach((variant) => visitType(variant.carrier, bound));
          return;
        }
        const named = rustNamedTypeCarrierValue(value);
        if (named !== undefined) {
          visitArguments(named.genericArguments, bound);
          return;
        }
        const fixedArray = rustFixedArrayCarrierValue(value);
        if (fixedArray !== undefined) {
          visitType(fixedArray.element, bound);
          visitConst(fixedArray.length);
        }
        return;
      }
      default:
        return;
    }
  }
}

export function inferRustTargetTypeParameterBindings(
  pattern: TargetTypeRef,
  actual: TargetTypeRef,
  parameterNames: ReadonlySet<string>,
): ReadonlyMap<string, TargetTypeRef> | undefined {
  return inferRustTargetGenericBindings(pattern, actual, {
    typeNames: parameterNames,
    lifetimeIdentities: new Set(),
    constIdentities: new Set(),
  })?.types;
}

export interface RustTargetGenericParameterSet {
  readonly typeNames: ReadonlySet<string>;
  readonly lifetimeIdentities: ReadonlySet<string>;
  readonly constIdentities: ReadonlySet<string>;
}

export interface RustTargetGenericBindings {
  readonly types: ReadonlyMap<string, TargetTypeRef>;
  readonly lifetimes: ReadonlyMap<string, RustLifetimeRef>;
  readonly consts: ReadonlyMap<string, RustTargetConstArgument>;
}

interface LifetimeInferenceContext {
  readonly leftToRight: ReadonlyMap<string, string>;
  readonly rightToLeft: ReadonlyMap<string, string>;
}

const emptyLifetimeInferenceContext: LifetimeInferenceContext = Object.freeze({
  leftToRight: new Map(),
  rightToLeft: new Map(),
});

export function inferRustTargetGenericBindings(
  pattern: TargetTypeRef,
  actual: TargetTypeRef,
  parameters: RustTargetGenericParameterSet,
): RustTargetGenericBindings | undefined {
  const types = new Map<string, TargetTypeRef>();
  const lifetimes = new Map<string, RustLifetimeRef>();
  const consts = new Map<string, RustTargetConstArgument>();
  return match(pattern, actual, emptyLifetimeInferenceContext)
    ? Object.freeze({ types, lifetimes, consts })
    : undefined;

  function matchLifetime(
    left: RustLifetimeRef | undefined,
    right: RustLifetimeRef | undefined,
    context: LifetimeInferenceContext,
  ): boolean {
    if (left === undefined || right === undefined) return left === right;
    const identity = rustLifetimeKey(left);
    if (left.kind === "bound" && right.kind === "bound") {
      const rightIdentity = rustLifetimeKey(right);
      const selectedRight = context.leftToRight.get(identity);
      const selectedLeft = context.rightToLeft.get(rightIdentity);
      if (selectedRight !== undefined || selectedLeft !== undefined) {
        return selectedRight === rightIdentity && selectedLeft === identity;
      }
    }
    if (!parameters.lifetimeIdentities.has(identity)) {
      return rustLifetimesEqual(left, right);
    }
    const existing = lifetimes.get(identity);
    if (existing === undefined) {
      lifetimes.set(identity, right);
      return true;
    }
    return rustLifetimesEqual(existing, right);
  }

  function matchConst(
    left: RustTargetConstArgument,
    right: RustTargetConstArgument,
  ): boolean {
    if (left.kind !== "parameter" ||
      !parameters.constIdentities.has(left.identity)) {
      return constArgumentsEqual(left, right);
    }
    const existing = consts.get(left.identity);
    if (existing === undefined) {
      consts.set(left.identity, right);
      return true;
    }
    return constArgumentsEqual(existing, right);
  }

  function matchBinder(
    left: import("../../lifetimes/index.js").RustLifetimeBinder | undefined,
    right: import("../../lifetimes/index.js").RustLifetimeBinder | undefined,
    parent: LifetimeInferenceContext,
  ): LifetimeInferenceContext | undefined {
    if (left === undefined || right === undefined) {
      return left === right ? parent : undefined;
    }
    if (left.parameters.length !== right.parameters.length) return undefined;
    const leftToRight = new Map(parent.leftToRight);
    const rightToLeft = new Map(parent.rightToLeft);
    for (let index = 0; index < left.parameters.length; index += 1) {
      const leftIdentity = rustLifetimeKey(left.parameters[index]!.lifetime);
      const rightIdentity = rustLifetimeKey(right.parameters[index]!.lifetime);
      if (leftToRight.has(leftIdentity) || rightToLeft.has(rightIdentity)) {
        return undefined;
      }
      leftToRight.set(leftIdentity, rightIdentity);
      rightToLeft.set(rightIdentity, leftIdentity);
    }
    const nested = Object.freeze({ leftToRight, rightToLeft });
    return left.parameters.every((parameter, index) => {
      const other = right.parameters[index]!;
      return parameter.outlives.length === other.outlives.length &&
        parameter.outlives.every((lifetime, lifetimeIndex) =>
          matchLifetime(lifetime, other.outlives[lifetimeIndex], nested));
    })
      ? nested
      : undefined;
  }

  function match(
    left: TargetTypeRef,
    right: TargetTypeRef,
    lifetimeContext: LifetimeInferenceContext,
  ): boolean {
    if (left.kind === "type-parameter" && parameters.typeNames.has(left.name)) {
      const existing = types.get(left.name);
      if (existing === undefined) {
        types.set(left.name, right);
        return true;
      }
      return rustTargetTypeRefEquals(existing, right);
    }
    if (left.kind !== right.kind) {
      return false;
    }
    switch (left.kind) {
      case "target-named": {
        if (right.kind !== "target-named" || left.id !== right.id) {
          return false;
        }
        return matchGenericArguments(
          left.genericArguments,
          right.genericArguments,
          (pattern, actual) => match(pattern, actual, lifetimeContext),
          (pattern, actual) => matchLifetime(pattern, actual, lifetimeContext),
          matchConst,
        );
      }
      case "array":
        return right.kind === "array" && left.rank === right.rank &&
          match(left.element, right.element, lifetimeContext);
      case "slice":
        return right.kind === "slice" && match(left.element, right.element, lifetimeContext);
      case "tuple":
        return right.kind === "tuple" && left.elements.length === right.elements.length &&
          left.elements.every((element, index) =>
            match(element, right.elements[index]!, lifetimeContext));
      case "reference":
        return right.kind === "reference" && left.mutable === right.mutable &&
          matchLifetime(left.lifetime, right.lifetime, lifetimeContext) &&
          match(left.referent, right.referent, lifetimeContext);
      case "pointer":
        return right.kind === "pointer" && left.mutability === right.mutability &&
          match(left.pointee, right.pointee, lifetimeContext);
      case "function-pointer": {
        if (right.kind !== "function-pointer" || !stringListsEqual(left.abi, right.abi) ||
          left.isUnsafe !== right.isUnsafe || left.args.length !== right.args.length) return false;
        const nested = matchBinder(left.lifetimeBinder, right.lifetimeBinder, lifetimeContext);
        return nested !== undefined && left.args.every((argument, index) =>
          match(argument, right.args[index]!, nested)) &&
          match(left.result, right.result, nested);
      }
      case "trait-ref": {
        if (right.kind !== "trait-ref" || left.id !== right.id ||
          left.path !== right.path) return false;
        const nested = matchBinder(left.lifetimeBinder, right.lifetimeBinder, lifetimeContext);
        return nested !== undefined &&
          matchGenericArguments(
            left.genericArguments,
            right.genericArguments,
            (pattern, actual) => match(pattern, actual, nested),
            (pattern, actual) => matchLifetime(pattern, actual, nested),
            matchConst,
          ) &&
          left.associatedConstraints.length === right.associatedConstraints.length &&
          left.associatedConstraints.every((constraint, index) => {
            const other = right.associatedConstraints[index];
            if (other === undefined || constraint.kind !== other.kind ||
              constraint.identity !== other.identity || constraint.name !== other.name ||
              !matchGenericArguments(
                constraint.genericArguments,
                other.genericArguments,
                (pattern, actual) => match(pattern, actual, nested),
                (pattern, actual) => matchLifetime(pattern, actual, nested),
                matchConst,
              )) return false;
            return constraint.kind === "equality"
              ? other.kind === "equality" && match(constraint.type, other.type, nested)
              : other.kind === "bounds" &&
                  constraint.traits.length === other.traits.length &&
                  constraint.traits.every((trait, traitIndex) =>
                    match(trait, other.traits[traitIndex]!, nested)) &&
                  constraint.outlives.length === other.outlives.length &&
                  constraint.outlives.every((lifetime, lifetimeIndex) =>
                    matchLifetime(lifetime, other.outlives[lifetimeIndex], nested));
          });
      }
      case "closure": {
        if (right.kind !== "closure" || left.args.length !== right.args.length) return false;
        const nested = matchBinder(left.lifetimeBinder, right.lifetimeBinder, lifetimeContext);
        return nested !== undefined && left.args.every((argument, index) =>
          match(argument, right.args[index]!, nested)) &&
          match(left.result, right.result, nested);
      }
      case "associated-type":
        return right.kind === "associated-type" && left.name === right.name &&
          optionalTypesMatch(
            left.trait,
            right.trait,
            (pattern, actual) => match(pattern, actual, lifetimeContext),
          ) &&
          matchGenericArguments(
            left.genericArguments,
            right.genericArguments,
            (pattern, actual) => match(pattern, actual, lifetimeContext),
            (pattern, actual) => matchLifetime(pattern, actual, lifetimeContext),
            matchConst,
          ) &&
          match(left.owner, right.owner, lifetimeContext);
      case "trait-object":
        return right.kind === "trait-object" &&
          matchLifetime(left.lifetime, right.lifetime, lifetimeContext) &&
          match(left.principal, right.principal, lifetimeContext) &&
          left.autoTraits.length === right.autoTraits.length &&
          left.autoTraits.every((trait, index) =>
            match(trait, right.autoTraits[index]!, lifetimeContext));
      case "impl-trait":
        return right.kind === "impl-trait" && left.id === right.id &&
          left.bounds.length === right.bounds.length &&
          left.bounds.every((bound, index) =>
            match(bound, right.bounds[index]!, lifetimeContext)) &&
          left.outlives.length === right.outlives.length &&
          left.outlives.every((lifetime, index) =>
            matchLifetime(lifetime, right.outlives[index], lifetimeContext)) &&
          left.captures.length === right.captures.length &&
          left.captures.every((lifetime, index) =>
            matchLifetime(lifetime, right.captures[index], lifetimeContext));
      case "target-specific": {
        if (right.kind !== "target-specific") {
          return false;
        }
        const leftSource = rustSourceTypeCarrierValue(left);
        const rightSource = rustSourceTypeCarrierValue(right);
        if (leftSource !== undefined || rightSource !== undefined) {
          return leftSource !== undefined && rightSource !== undefined &&
            leftSource.fileName === rightSource.fileName &&
            leftSource.typeName === rightSource.typeName &&
            leftSource.shape === rightSource.shape &&
            matchGenericArguments(
              leftSource.genericArguments,
              rightSource.genericArguments,
              (pattern, actual) => match(pattern, actual, lifetimeContext),
              (pattern, actual) => matchLifetime(pattern, actual, lifetimeContext),
              matchConst,
            );
        }
        const leftStructural = rustStructuralObjectCarrierValue(left);
        const rightStructural = rustStructuralObjectCarrierValue(right);
        if (leftStructural !== undefined || rightStructural !== undefined) {
          return leftStructural !== undefined && rightStructural !== undefined &&
            leftStructural.fields.length === rightStructural.fields.length &&
            leftStructural.fields.every((field, index) => {
              const other = rightStructural.fields[index];
              return other !== undefined && field.sourceName === other.sourceName &&
                field.presence === other.presence &&
                field.readonly === other.readonly &&
                field.accessor?.getter === other.accessor?.getter &&
                field.accessor?.setter === other.accessor?.setter &&
                field.method === other.method &&
                match(field.type, other.type, lifetimeContext);
            });
        }
        const leftUnion = rustSourceUnionCarrierValue(left);
        const rightUnion = rustSourceUnionCarrierValue(right);
        if (leftUnion !== undefined || rightUnion !== undefined) {
          return leftUnion !== undefined && rightUnion !== undefined &&
            leftUnion.fileName === rightUnion.fileName &&
            leftUnion.typeName === rightUnion.typeName &&
            leftUnion.variants.length === rightUnion.variants.length &&
            leftUnion.variants.every((variant, index) => {
              const other = rightUnion.variants[index];
              return other !== undefined && variant.name === other.name &&
                match(variant.carrier, other.carrier, lifetimeContext);
            });
        }
        const leftNamed = rustNamedTypeCarrierValue(left);
        const rightNamed = rustNamedTypeCarrierValue(right);
        if (leftNamed !== undefined || rightNamed !== undefined) {
          return leftNamed !== undefined && rightNamed !== undefined &&
            leftNamed.id === rightNamed.id &&
            leftNamed.path === rightNamed.path &&
            matchGenericArguments(
              leftNamed.genericArguments,
              rightNamed.genericArguments,
              (pattern, actual) => match(pattern, actual, lifetimeContext),
              (pattern, actual) => matchLifetime(pattern, actual, lifetimeContext),
              matchConst,
            );
        }
        const leftArray = rustFixedArrayCarrierValue(left);
        const rightArray = rustFixedArrayCarrierValue(right);
        if (leftArray !== undefined || rightArray !== undefined) {
          return leftArray !== undefined && rightArray !== undefined &&
            matchConst(leftArray.length, rightArray.length) &&
            match(leftArray.element, rightArray.element, lifetimeContext);
        }
        return rustTargetTypeRefEquals(left, right);
      }
      default:
        return rustTargetTypeRefEquals(left, right);
    }
  }
}

function matchGenericArguments(
  left: readonly RustTargetGenericArgument[] | undefined,
  right: readonly RustTargetGenericArgument[] | undefined,
  matchType: (left: TargetTypeRef, right: TargetTypeRef) => boolean,
  matchLifetime: (
    left: RustLifetimeRef | undefined,
    right: RustLifetimeRef | undefined,
  ) => boolean,
  matchConst: (
    left: RustTargetConstArgument,
    right: RustTargetConstArgument,
  ) => boolean,
): boolean {
  const leftArguments = left ?? [];
  const rightArguments = right ?? [];
  return leftArguments.length === rightArguments.length &&
    leftArguments.every((argument, index) => {
      const other = rightArguments[index];
      if (other === undefined || argument.kind !== other.kind) return false;
      switch (argument.kind) {
        case "lifetime":
          return other.kind === "lifetime" &&
            matchLifetime(argument.lifetime, other.lifetime);
        case "type":
          return other.kind === "type" && matchType(argument.type, other.type);
        case "const":
          return other.kind === "const" && matchConst(argument.value, other.value);
      }
    });
}

function constArgumentsEqual(
  left: RustTargetConstArgument,
  right: RustTargetConstArgument,
): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "infer":
      return true;
    case "integer":
    case "char":
    case "boolean":
      return right.kind === left.kind && left.value === right.value;
    case "parameter":
      return right.kind === left.kind && left.identity === right.identity;
  }
}

function optionalTypesMatch(
  left: TargetTypeRef | undefined,
  right: TargetTypeRef | undefined,
  matchType: (left: TargetTypeRef, right: TargetTypeRef) => boolean,
): boolean {
  return left === undefined || right === undefined
    ? left === right
    : matchType(left, right);
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

function stringListsEqual(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  if (left === right) {
    return true;
  }
  return left !== undefined && right !== undefined && isDenseDataArray(left) && isDenseDataArray(right) &&
    left.length === right.length &&
    left.every((entry, index) => entry === right[index]);
}
