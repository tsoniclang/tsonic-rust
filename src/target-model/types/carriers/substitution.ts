import { isDenseDataArray } from "../../metadata/closed-data.js";
import { rustFixedArrayCarrierValue, rustFixedArrayTargetType, rustNamedTargetType, rustNamedTypeCarrierValue } from "./native.js";
import { rustSourceTypeCarrier, rustSourceTypeCarrierValue, rustSourceUnionCarrierValue, rustSourceUnionTargetType, rustStructuralObjectCarrierValue, rustStructuralObjectTargetType } from "./source-types.js";
import { rustTargetTypeRefEquals } from "../equality.js";
import type { TargetTypeRef } from "../model.js";
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
): TargetTypeRef {
  const substituteLifetime = (lifetime: RustLifetimeRef): RustLifetimeRef =>
    lifetimeSubstitutions.get(rustLifetimeKey(lifetime)) ?? lifetime;
  switch (type.kind) {
    case "type-parameter":
      return substitutions.get(type.name) ?? type;
    case "target-named":
      return {
        ...type,
        ...(type.lifetimeArguments === undefined
          ? {}
          : { lifetimeArguments: type.lifetimeArguments.map(substituteLifetime) }),
        ...(type.typeArguments === undefined
          ? {}
          : { typeArguments: type.typeArguments.map((argument) =>
              substituteRustTargetGenerics(argument, substitutions, lifetimeSubstitutions)) }),
      };
    case "array":
      return { ...type, element: substituteRustTargetGenerics(type.element, substitutions, lifetimeSubstitutions) };
    case "slice":
      return { ...type, element: substituteRustTargetGenerics(type.element, substitutions, lifetimeSubstitutions) };
    case "tuple":
      return { ...type, elements: type.elements.map((element) => substituteRustTargetGenerics(element, substitutions, lifetimeSubstitutions)) };
    case "reference":
      return {
        ...type,
        ...(type.lifetime === undefined ? {} : { lifetime: substituteLifetime(type.lifetime) }),
        referent: substituteRustTargetGenerics(type.referent, substitutions, lifetimeSubstitutions),
      };
    case "pointer":
      return { ...type, pointee: substituteRustTargetGenerics(type.pointee, substitutions, lifetimeSubstitutions) };
    case "function-pointer":
      return {
        ...type,
        args: type.args.map((argument) => substituteRustTargetGenerics(argument, substitutions, lifetimeSubstitutions)),
        result: substituteRustTargetGenerics(type.result, substitutions, lifetimeSubstitutions),
      };
    case "closure":
      return {
        ...type,
        args: type.args.map((argument) => substituteRustTargetGenerics(argument, substitutions, lifetimeSubstitutions)),
        result: substituteRustTargetGenerics(type.result, substitutions, lifetimeSubstitutions),
      };
    case "trait-object":
      return {
        ...type,
        principal: substituteRustTargetGenerics(type.principal, substitutions, lifetimeSubstitutions),
        autoTraits: type.autoTraits.map((trait) =>
          substituteRustTargetGenerics(trait, substitutions, lifetimeSubstitutions)),
        ...(type.lifetime === undefined ? {} : { lifetime: substituteLifetime(type.lifetime) }),
      };
    case "impl-trait":
      return {
        ...type,
        bounds: type.bounds.map((bound) =>
          substituteRustTargetGenerics(bound, substitutions, lifetimeSubstitutions)),
        captures: type.captures.map(substituteLifetime),
      };
    case "associated-type":
      return {
        ...type,
        owner: substituteRustTargetGenerics(type.owner, substitutions, lifetimeSubstitutions),
        ...(type.lifetimeArguments === undefined
          ? {}
          : { lifetimeArguments: type.lifetimeArguments.map(substituteLifetime) }),
        ...(type.typeArguments === undefined
          ? {}
          : { typeArguments: type.typeArguments.map((argument) =>
              substituteRustTargetGenerics(argument, substitutions, lifetimeSubstitutions)) }),
      };
    case "target-specific": {
      const sourceType = rustSourceTypeCarrierValue(type);
      if (sourceType !== undefined) {
        return rustSourceTypeCarrier(
          sourceType.fileName,
          sourceType.typeName,
          sourceType.shape,
          {
            lifetimes: sourceType.lifetimeArguments.map(substituteLifetime),
            types: sourceType.typeArguments.map((argument) =>
              substituteRustTargetGenerics(argument, substitutions, lifetimeSubstitutions)),
          },
        );
      }
      const structuralObject = rustStructuralObjectCarrierValue(type);
      if (structuralObject !== undefined) {
        return rustStructuralObjectTargetType(structuralObject.ownerFileName, structuralObject.fields.map((field) => ({
          ...field,
          type: substituteRustTargetGenerics(field.type, substitutions, lifetimeSubstitutions),
        })));
      }
      const sourceUnion = rustSourceUnionCarrierValue(type);
      if (sourceUnion !== undefined) {
        return rustSourceUnionTargetType(
          sourceUnion.fileName,
          sourceUnion.typeName,
          sourceUnion.variants.map((variant) => ({
            ...variant,
            carrier: substituteRustTargetGenerics(variant.carrier, substitutions, lifetimeSubstitutions),
          })),
        );
      }
      const namedType = rustNamedTypeCarrierValue(type);
      if (namedType !== undefined) {
        return rustNamedTargetType(
          namedType.id,
          namedType.path,
          namedType.typeArguments.map((argument) =>
            substituteRustTargetGenerics(argument, substitutions, lifetimeSubstitutions)),
          namedType.traits,
        );
      }
      const fixedArray = rustFixedArrayCarrierValue(type);
      return fixedArray === undefined
        ? type
        : rustFixedArrayTargetType(
            substituteRustTargetGenerics(fixedArray.element, substitutions, lifetimeSubstitutions),
            fixedArray.length,
          );
    }
    default:
      return type;
  }
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
      return type.typeArguments?.some((argument) =>
        visitRustTargetTypeParameters(argument, visit)) === true;
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
    case "associated-type":
      return visitRustTargetTypeParameters(type.owner, visit);
    case "target-specific": {
      const sourceType = rustSourceTypeCarrierValue(type);
      if (sourceType !== undefined) {
        return sourceType.typeArguments.some((argument) =>
          visitRustTargetTypeParameters(argument, visit));
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
        return namedType.typeArguments.some((argument) =>
          visitRustTargetTypeParameters(argument, visit));
      }
      const fixedArray = rustFixedArrayCarrierValue(type);
      return fixedArray !== undefined &&
        visitRustTargetTypeParameters(fixedArray.element, visit);
    }
    default:
      return false;
  }
}

export function inferRustTargetTypeParameterBindings(
  pattern: TargetTypeRef,
  actual: TargetTypeRef,
  parameterNames: ReadonlySet<string>,
): ReadonlyMap<string, TargetTypeRef> | undefined {
  const bindings = new Map<string, TargetTypeRef>();
  return match(pattern, actual) ? bindings : undefined;

  function match(left: TargetTypeRef, right: TargetTypeRef): boolean {
    if (left.kind === "type-parameter" && parameterNames.has(left.name)) {
      const existing = bindings.get(left.name);
      if (existing === undefined) {
        bindings.set(left.name, right);
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
        const leftArguments = left.typeArguments ?? [];
        const rightArguments = right.typeArguments ?? [];
        return leftArguments.length === rightArguments.length &&
          leftArguments.every((argument, index) => match(argument, rightArguments[index]!));
      }
      case "array":
        return right.kind === "array" && left.rank === right.rank && match(left.element, right.element);
      case "slice":
        return right.kind === "slice" && match(left.element, right.element);
      case "tuple":
        return right.kind === "tuple" && left.elements.length === right.elements.length &&
          left.elements.every((element, index) => match(element, right.elements[index]!));
      case "reference":
        return right.kind === "reference" && left.mutable === right.mutable &&
          left.lifetime === right.lifetime && match(left.referent, right.referent);
      case "pointer":
        return right.kind === "pointer" && left.mutability === right.mutability && match(left.pointee, right.pointee);
      case "function-pointer":
        return right.kind === "function-pointer" && stringListsEqual(left.abi, right.abi) &&
          left.args.length === right.args.length && left.args.every((argument, index) => match(argument, right.args[index]!)) &&
          match(left.result, right.result);
      case "closure":
        return right.kind === "closure" && left.args.length === right.args.length &&
          left.args.every((argument, index) => match(argument, right.args[index]!)) &&
          match(left.result, right.result);
      case "associated-type":
        return right.kind === "associated-type" && left.name === right.name && match(left.owner, right.owner);
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
            leftSource.typeArguments.length === rightSource.typeArguments.length &&
            leftSource.typeArguments.every((argument, index) =>
              match(argument, rightSource.typeArguments[index]!));
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
                match(field.type, other.type);
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
                match(variant.carrier, other.carrier);
            });
        }
        const leftNamed = rustNamedTypeCarrierValue(left);
        const rightNamed = rustNamedTypeCarrierValue(right);
        if (leftNamed !== undefined || rightNamed !== undefined) {
          return leftNamed !== undefined && rightNamed !== undefined &&
            leftNamed.id === rightNamed.id &&
            leftNamed.path === rightNamed.path &&
            leftNamed.typeArguments.length === rightNamed.typeArguments.length &&
            leftNamed.typeArguments.every((argument, index) =>
              match(argument, rightNamed.typeArguments[index]!));
        }
        const leftArray = rustFixedArrayCarrierValue(left);
        const rightArray = rustFixedArrayCarrierValue(right);
        if (leftArray !== undefined || rightArray !== undefined) {
          return leftArray !== undefined && rightArray !== undefined &&
            leftArray.length === rightArray.length &&
            match(leftArray.element, rightArray.element);
        }
        return rustTargetTypeRefEquals(left, right);
      }
      default:
        return rustTargetTypeRefEquals(left, right);
    }
  }
}

function stringListsEqual(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  if (left === right) {
    return true;
  }
  return left !== undefined && right !== undefined && isDenseDataArray(left) && isDenseDataArray(right) &&
    left.length === right.length &&
    left.every((entry, index) => entry === right[index]);
}
