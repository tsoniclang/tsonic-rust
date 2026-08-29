import { isDenseDataArray } from "../../metadata/closed-data.js";
import {
  rustFixedArrayCarrierValue,
  rustNamedTypeCarrierValue,
} from "./native.js";
import {
  rustSourceTypeCarrierValue,
  rustSourceUnionCarrierValue,
  rustStructuralObjectCarrierValue,
} from "./source-types.js";
import { rustTargetTypeRefEquals } from "../equality.js";
import type {
  RustTargetConstArgument,
  RustTargetGenericArgument,
  TargetTypeRef,
} from "../model.js";
import { rustLifetimeKey, rustLifetimesEqual } from "../../lifetimes/index.js";
import type { RustLifetimeRef } from "../../lifetimes/index.js";

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

export interface RustTargetGenericInferenceOptions {
  readonly callScopedElisionBindings?: ReadonlyMap<string, RustLifetimeRef>;
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
  options: RustTargetGenericInferenceOptions = {},
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
    if (left === undefined) return right === undefined;
    const identity = rustLifetimeKey(left);
    if (right === undefined) {
      if (!parameters.lifetimeIdentities.has(identity)) return false;
      const existing = lifetimes.get(identity);
      if (existing !== undefined) return true;
      const inferred = options.callScopedElisionBindings?.get(identity);
      if (inferred === undefined) return false;
      lifetimes.set(identity, inferred);
      return true;
    }
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
          matchGenericArguments(
            left.captures,
            right.captures,
            (pattern, actual) => match(pattern, actual, lifetimeContext),
            (pattern, actual) => matchLifetime(pattern, actual, lifetimeContext),
            matchConst,
          );
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

function stringListsEqual(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  if (left === right) {
    return true;
  }
  return left !== undefined && right !== undefined && isDenseDataArray(left) && isDenseDataArray(right) &&
    left.length === right.length &&
    left.every((entry, index) => entry === right[index]);
}
