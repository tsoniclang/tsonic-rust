import {
  rustFixedArrayCarrierValue,
  rustNamedTypeCarrierValue,
} from "./native.js";
import {
  rustSourceTypeCarrierValue,
  rustSourceUnionCarrierValue,
  rustStructuralObjectCarrierValue,
} from "./source-types.js";
import type {
  RustTargetConstArgument,
  RustTargetGenericArgument,
  TargetTypeRef,
} from "../model.js";
import { rustLifetimeKey } from "../../lifetimes/index.js";
import type { RustLifetimeRef } from "../../lifetimes/index.js";

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
        return visitGenericArgumentTypes(namedType.genericArguments, visit) ||
          visitGenericArgumentTypes(namedType.genericDefaults, visit);
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
  readonly callScopedElisions: readonly Extract<
    RustLifetimeRef,
    { readonly kind: "call-scoped-elision" }
  >[];
  readonly hasUnnameableLifetime: boolean;
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
  const callScopedElisions = new Map<string, Extract<
    RustLifetimeRef,
    { readonly kind: "call-scoped-elision" }
  >>();
  const constIdentities = new Set<string>();
  let hasUnnameableLifetime = false;
  visitType(type, new Set());
  return Object.freeze({
    typeNames: Object.freeze([...typeNames].sort()),
    lifetimes: Object.freeze([...lifetimes]
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([, lifetime]) => lifetime)),
    lifetimeIdentities: Object.freeze([...lifetimes.keys()].sort()),
    callScopedElisions: Object.freeze([...callScopedElisions]
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([, lifetime]) => lifetime)),
    hasUnnameableLifetime,
    constIdentities: Object.freeze([...constIdentities].sort()),
  });

  function visitLifetime(
    lifetime: RustLifetimeRef | undefined,
    bound: ReadonlySet<string>,
  ): void {
    if (lifetime === undefined) return;
    const identity = rustLifetimeKey(lifetime);
    if (lifetime.kind === "call-scoped-elision") {
      callScopedElisions.set(identity, lifetime);
      hasUnnameableLifetime = true;
      return;
    }
    if (lifetime.kind === "placeholder") {
      hasUnnameableLifetime = true;
      return;
    }
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
        if (value.lifetime === undefined) hasUnnameableLifetime = true;
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
        visitArguments(value.captures, bound);
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
          visitArguments(named.genericDefaults, bound);
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
