import {
  rustFixedArrayCarrierValue,
  rustNamedTypeCarrierValue,
} from "./native.js";
import {
  rustSourceTypeCarrierValue,
  rustSourceUnionCarrierValue,
  rustStructuralObjectCarrierValue,
} from "./source-types.js";
import { rustGenericCallableValue } from "./generic-callables.js";
import { rustClassConstructorFreeArguments } from "./class-constructors.js";
import type {
  RustTargetConstArgument,
  RustTargetGenericArgument,
  TargetTypeRef,
} from "../model.js";
import { rustLifetimeKey, rustPlaceholderLifetime } from "../../lifetimes/index.js";
import type { RustLifetimeRef } from "../../lifetimes/index.js";

export function rustTargetTypeContainsTypeParameter(
  type: TargetTypeRef,
  selectedIdentities: ReadonlySet<string>,
): boolean {
  return rustTargetTypeParameterIdentities(type).some(identity => selectedIdentities.has(identity));
}

export function rustTargetTypeParameterIdentities(type: TargetTypeRef): readonly string[] {
  return rustTargetGenericReferences(type).typeIdentities;
}

export function visitRustTargetTypeParameters(
  type: TargetTypeRef,
  visit: (parameter: Extract<TargetTypeRef, { readonly kind: "type-parameter" }>) => boolean,
): boolean {
  return rustTargetGenericReferences(type).typeParameters.some(visit);
}

export interface RustTargetGenericReferences {
  readonly typeIdentities: readonly string[];
  readonly typeParameters: readonly Extract<TargetTypeRef, { readonly kind: "type-parameter" }>[];
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
  readonly elisionInputs: readonly RustLifetimeRef[];
  readonly constIdentities: readonly string[];
}

export function rustTargetGenericReferences(
  type: TargetTypeRef,
): RustTargetGenericReferences {
  const typeParameters = new Map<string, Extract<TargetTypeRef, { readonly kind: "type-parameter" }>>();
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
  const elisionLifetimes = new Map<string, RustLifetimeRef>();
  const anonymousElisions: RustLifetimeRef[] = [];
  let signatureDepth = 0;
  let metadataDepth = 0;
  visitType(type, new Set());
  return Object.freeze({
    typeIdentities: Object.freeze([...typeParameters.keys()]),
    typeParameters: Object.freeze([...typeParameters.values()]),
    lifetimes: Object.freeze([...lifetimes]
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([, lifetime]) => lifetime)),
    lifetimeIdentities: Object.freeze([...lifetimes.keys()].sort()),
    callScopedElisions: Object.freeze([...callScopedElisions]
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([, lifetime]) => lifetime)),
    hasUnnameableLifetime,
    elisionInputs: Object.freeze([...elisionLifetimes.values(), ...anonymousElisions]),
    constIdentities: Object.freeze([...constIdentities].sort()),
  });

  function visitLifetime(
    lifetime: RustLifetimeRef | undefined,
    bound: ReadonlySet<string>,
  ): void {
    if (lifetime === undefined) return;
    const identity = rustLifetimeKey(lifetime);
    if (metadataDepth === 0 && !bound.has(identity)) {
      if (lifetime.kind === "placeholder") {
        if (signatureDepth === 0) anonymousElisions.push(lifetime);
      } else {
        elisionLifetimes.set(identity, lifetime);
      }
    }
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
        if (value.optionalStorageValue === undefined) typeParameters.set(value.identity, value);
        else visitType(value.optionalStorageValue, bound);
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
        if (value.lifetime === undefined) {
          hasUnnameableLifetime = true;
          if (signatureDepth === 0 && metadataDepth === 0) anonymousElisions.push(rustPlaceholderLifetime);
        }
        visitLifetime(value.lifetime, bound);
        visitType(value.referent, bound);
        return;
      case "pointer":
        visitType(value.pointee, bound);
        return;
      case "function-pointer":
      case "closure": {
        const nested = nestedBoundLifetimes(value.lifetimeBinder, bound);
        signatureDepth += 1;
        value.args.forEach((argument) => visitType(argument, nested));
        visitType(value.result, nested);
        signatureDepth -= 1;
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
        const constructorArguments = rustClassConstructorFreeArguments(value);
        if (constructorArguments !== undefined) {
          visitArguments(constructorArguments, bound);
          return;
        }
        const callable = rustGenericCallableValue(value);
        if (callable !== undefined) {
          callable.environment.forEach(argument => visitType(argument, bound));
          return;
        }
        const sourceType = rustSourceTypeCarrierValue(value);
        if (sourceType !== undefined) {
          visitArguments(sourceType.genericArguments, bound);
          return;
        }
        const structural = rustStructuralObjectCarrierValue(value);
        if (structural !== undefined) {
          structural.bases.forEach(base => visitType(base, bound));
          structural.fields.forEach((field) => visitType(field.type, bound));
          if (structural.construction !== undefined) visitType(structural.construction, bound);
          return;
        }
        const union = rustSourceUnionCarrierValue(value);
        if (union !== undefined) {
          visitArguments(union.genericArguments, bound);
          return;
        }
        const named = rustNamedTypeCarrierValue(value);
        if (named !== undefined) {
          visitArguments(named.genericArguments, bound);
          metadataDepth += 1;
          visitArguments(named.genericDefaults, bound);
          named.upcasts.forEach((upcast) => visitType(upcast.target, bound));
          metadataDepth -= 1;
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
