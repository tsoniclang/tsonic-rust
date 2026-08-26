import { createHash } from "node:crypto";
import { sourceGenericArgumentFor, targetGenericArgumentFor } from "./types.js";
import {
  rustCompilerTypeArguments,
  substituteRustCompilerType,
} from "../model/rustdoc-types.js";
import type { ProjectionContext } from "./model.js";
import type { ProviderTypeExpression } from "@tsonic/tsts";
import type {
  RustCompilerBound,
  RustCompilerGenericParameter,
  RustCompilerGenerics,
  RustCompilerStandardItemLocation,
  RustCompilerType,
} from "../model/model.js";
import type { RustGenericArgument } from "../../../target-model/semantics/index.js";

export function importedSourceType(
  context: ProjectionContext,
  moduleSpecifier: string,
  exportName: string,
  typeArguments: readonly ProviderTypeExpression[],
): ProviderTypeExpression {
  const names = context.imports.get(moduleSpecifier) ?? new Set<string>();
  names.add(exportName);
  context.imports.set(moduleSpecifier, names);
  return {
    kind: "provider-ref",
    moduleSpecifier,
    exportName,
    ...(typeArguments.length === 0 ? {} : { typeArguments }),
  };
}

export function digestText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function requireCurrentType(context: ProjectionContext): NonNullable<ProjectionContext["currentType"]> {
  if (context.currentType === undefined) throw new Error("Rust Self type occurs outside a projected type declaration.");
  return context.currentType;
}

export function isRustStringPath(type: Extract<RustCompilerType, { readonly kind: "path" }>): boolean {
  return type.name === "String" && (type.crateName === "alloc" || type.crateName === "std") &&
    type.modulePath[type.modulePath.length - 1] === "string" && type.arguments.length === 0;
}

export function isRustOptionPath(type: Extract<RustCompilerType, { readonly kind: "path" }>): boolean {
  return type.crateName === "core" && type.modulePath.length === 1 && type.modulePath[0] === "option" &&
    type.name === "Option" && rustCompilerTypeArguments(type.arguments).length === 1;
}

export function standardSourceTypeArguments(
  type: Extract<RustCompilerType, { readonly kind: "path" }>,
  location: RustCompilerStandardItemLocation,
  context: ProjectionContext,
  position: "parameter" | "result",
): readonly ProviderTypeExpression[] {
  if (location.sourceAvailability === "unavailable") {
    throw new Error(`Rust standard-library item '${location.canonicalPath.join("::")}' has no public source contract.`);
  }
  const count = requireStandardSourceArgumentCount(type, location);
  return Object.freeze(type.arguments.slice(0, count).map((argument) =>
    sourceGenericArgumentFor(argument, context, position)));
}

export function standardTargetTypeArguments(
  type: Extract<RustCompilerType, { readonly kind: "path" }>,
  location: RustCompilerStandardItemLocation,
  context: ProjectionContext,
  position: "parameter" | "result",
): readonly RustGenericArgument[] {
  if (location.sourceAvailability === "unavailable") {
    throw new Error(`Rust standard-library item '${location.canonicalPath.join("::")}' has no public target path.`);
  }
  const count = requireStandardSourceArgumentCount(type, location);
  return Object.freeze(type.arguments.slice(0, count).map((argument) =>
    targetGenericArgumentFor(argument, context, position)));
}

export function sourceVisibleGenericParameters(
  generics: RustCompilerGenerics,
  context?: ProjectionContext,
): readonly RustCompilerGenericParameter[] {
  const parameters = generics.parameters.filter((parameter) =>
    parameter.kind !== "type" || parameter.declarationKind === "explicit");
  if (context === undefined) return Object.freeze(parameters);
  const firstUnavailable = parameters.findIndex((parameter) =>
    parameter.kind === "type" && sourceGenericParameterHasDefault(parameter) &&
    parameter.bounds.some((bound) => !sourceBoundIsAccessible(bound, context)));
  if (firstUnavailable < 0) return Object.freeze(parameters);
  if (parameters.slice(firstUnavailable).some((parameter) =>
    !sourceGenericParameterHasDefault(parameter))) {
    throw new Error("Rust source-inaccessible generic bounds do not form a defaulted trailing suffix.");
  }
  return Object.freeze(parameters.slice(0, firstUnavailable));
}

export function sourceGenericParameterHasDefault(
  parameter: RustCompilerGenericParameter,
): boolean {
  if (parameter.kind === "lifetime") return false;
  if (parameter.kind === "const") return parameter.defaultValue !== undefined;
  return parameter.defaultType !== undefined && !rustCompilerTypeContainsSelf(parameter.defaultType);
}

function rustCompilerTypeContainsSelf(type: RustCompilerType): boolean {
  const argumentContainsSelf = (argument: import("../model/model.js").RustCompilerGenericArgument): boolean =>
    argument.kind === "type" && rustCompilerTypeContainsSelf(argument.value);
  const traitContainsSelf = (trait: import("../model/model.js").RustCompilerTraitReference): boolean =>
    trait.arguments.some(argumentContainsSelf) || trait.associatedConstraints.some((constraint) =>
      constraint.arguments.some(argumentContainsSelf) ||
      (constraint.kind === "equality"
        ? rustCompilerTypeContainsSelf(constraint.type)
        : constraint.bounds.some(boundContainsSelf)));
  const boundContainsSelf = (bound: import("../model/model.js").RustCompilerBound): boolean => {
    switch (bound.kind) {
      case "trait": return traitContainsSelf(bound.trait);
      case "type-outlives": return rustCompilerTypeContainsSelf(bound.type);
      case "associated-equality":
        return rustCompilerTypeContainsSelf(bound.projection) || rustCompilerTypeContainsSelf(bound.value);
      case "precise-capture": return bound.captures.some(argumentContainsSelf);
      case "lifetime-outlives": return false;
    }
  };
  switch (type.kind) {
    case "self": return true;
    case "unit":
    case "never":
    case "primitive":
    case "type-parameter": return false;
    case "tuple": return type.elements.some(rustCompilerTypeContainsSelf);
    case "array":
    case "slice": return rustCompilerTypeContainsSelf(type.element);
    case "reference":
    case "raw-pointer": return rustCompilerTypeContainsSelf(type.target);
    case "function-pointer":
      return type.parameters.some(rustCompilerTypeContainsSelf) || rustCompilerTypeContainsSelf(type.result);
    case "path": return type.arguments.some(argumentContainsSelf);
    case "associated-type":
      return rustCompilerTypeContainsSelf(type.owner) || traitContainsSelf(type.trait) ||
        type.arguments.some(argumentContainsSelf);
    case "trait-object":
      return traitContainsSelf(type.principal) || type.autoTraits.some(traitContainsSelf);
    case "opaque":
      return type.bounds.some(boundContainsSelf) || type.captures.some(argumentContainsSelf);
  }
}

export function sourceBoundIsAccessible(
  bound: RustCompilerBound,
  context: ProjectionContext,
): boolean {
  if (bound.kind !== "trait") return true;
  const location = context.standardItems.get(canonicalPathKey(bound.trait.identity.canonicalPath));
  return location === undefined ||
    (location.sourceAvailability === "available" && location.sourceStability !== "unstable");
}

export function withDefaultTypeBindings(
  context: ProjectionContext,
  generics: RustCompilerGenerics,
  retainedParameters: readonly RustCompilerGenericParameter[] = Object.freeze([]),
): ProjectionContext {
  const types = new Map(context.defaultTypeBindings?.types ?? []);
  const lifetimes = new Map(context.defaultTypeBindings?.lifetimes ?? []);
  const consts = new Map(context.defaultTypeBindings?.consts ?? []);
  const substitutions = { types, lifetimes, consts };
  const retained = new Set(retainedParameters.map(genericParameterIdentity));
  for (const parameter of generics.parameters) {
    if (retained.has(genericParameterIdentity(parameter))) continue;
    if (parameter.kind === "type" && parameter.defaultType !== undefined) {
      types.set(parameter.identity.itemId, substituteRustCompilerType(parameter.defaultType, substitutions));
    } else if (parameter.kind === "const" && parameter.defaultValue !== undefined) {
      consts.set(parameter.identity.itemId, parameter.defaultValue);
    }
  }
  return types.size === 0 && lifetimes.size === 0 && consts.size === 0
    ? context
    : { ...context, defaultTypeBindings: Object.freeze(substitutions) };
}

export function rustCompilerTypeNamesCurrentType(type: RustCompilerType, context: ProjectionContext): boolean {
  const current = requireCurrentType(context);
  if (type.kind === "self") return type.owner.itemId === current.identity.itemId;
  if (type.kind !== "path" || type.identity.itemId !== current.identity.itemId ||
    canonicalPathKey(type.identity.canonicalPath) !== canonicalPathKey(current.canonicalPath) ||
    type.arguments.length < current.genericParameters.length) return false;
  return current.genericParameters.every((parameter, index) => {
    const argument = type.arguments[index];
    if (parameter.kind === "lifetime") {
      return argument?.kind === "lifetime" && argument.value.kind === "parameter" &&
        parameter.identity.kind === "parameter" &&
        argument.value.identity.itemId === parameter.identity.identity.itemId;
    }
    if (parameter.kind === "type") {
      return argument?.kind === "type" && argument.value.kind === "type-parameter" &&
        argument.value.identity.itemId === parameter.identity.itemId;
    }
    return argument?.kind === "const" && argument.value.kind === "parameter" &&
      argument.value.identity.itemId === parameter.identity.itemId;
  });
}

export function canonicalPathKey(path: readonly string[]): string {
  return path.join("\0");
}

export function rustCompilerTypeText(type: Extract<RustCompilerType, { readonly kind: "path" }>): string {
  return type.identity.canonicalPath.join("::");
}

export function uniqueText(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort(compareText));
}

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function genericSourceName(
  parameter: RustCompilerGenericParameter,
  index: number,
): string {
  const base = parameter.kind === "lifetime"
    ? parameter.identity.kind === "parameter" || parameter.identity.kind === "bound"
      ? `L_${parameter.identity.displayName}`
      : "L_static"
    : parameter.kind === "const"
      ? `N_${parameter.displayName}`
      : parameter.displayName;
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(base) ? base : `G${index}`;
}

export function genericNameMap(
  parameters: readonly RustCompilerGenericParameter[],
  occupiedNames: ReadonlySet<string> = new Set(),
): ReadonlyMap<string, string> {
  const selected = new Map<string, string>();
  const occupied = new Set(occupiedNames);
  parameters.forEach((parameter, index) => {
    const base = genericSourceName(parameter, index);
    let name = base;
    let suffix = 2;
    while (occupied.has(name)) {
      name = `${base}_${suffix}`;
      suffix += 1;
    }
    occupied.add(name);
    selected.set(genericParameterIdentity(parameter), name);
  });
  return selected;
}

export function genericParameterIdentity(parameter: RustCompilerGenericParameter): string {
  if (parameter.kind === "lifetime") {
    if (parameter.identity.kind !== "parameter" && parameter.identity.kind !== "bound") {
      throw new Error("Rust lifetime generic parameter has no declaration identity.");
    }
    return parameter.identity.kind === "parameter"
      ? parameter.identity.identity.itemId
      : parameter.identity.parameterId;
  }
  return parameter.identity.itemId;
}

function requireStandardSourceArgumentCount(
  type: Extract<RustCompilerType, { readonly kind: "path" }>,
  location: Extract<RustCompilerStandardItemLocation, { readonly sourceAvailability: "available" }>,
): number {
  const required = location.requiredSourceGenericArgumentCount;
  if (type.arguments.length < required) {
    throw new Error(
      `Rust standard-library type '${rustCompilerTypeText(type)}' supplies ${type.arguments.length} generic arguments for required source arity ${required}.`,
    );
  }
  return Math.min(type.arguments.length, location.sourceGenericArgumentCount);
}
