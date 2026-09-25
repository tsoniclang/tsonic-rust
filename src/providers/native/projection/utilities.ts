import { createHash } from "node:crypto";
import {
  sourceGenericArgumentFor,
  targetGenericArgumentFor,
} from "./types.js";
import {
  createRustCompilerSubstitutions,
  compilerTypeRequirementCanonicalPath,
  substituteRustCompilerArgument,
  substituteRustCompilerType,
} from "../model/rustdoc-types.js";
import type { ProjectionContext } from "./model.js";
import type { ProviderTypeExpression } from "@tsonic/tsts";
import type {
  RustCompilerConstArgument,
  RustCompilerGenericArgument,
  RustCompilerGenericParameter,
  RustCompilerStandardTypeLocation,
  RustCompilerType,
  RustCompilerTypeRequirement,
} from "../model/model.js";
import type { RustTargetGenericArgument } from "../../../target-model/types/model.js";

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

export function requireCurrentType(
  context: ProjectionContext,
): NonNullable<ProjectionContext["currentType"]> {
  if (context.currentType === undefined) {
    throw new Error("Rust Self type occurs outside a projected type declaration.");
  }
  return context.currentType;
}

export function isRustStringPath(
  type: Extract<RustCompilerType, { readonly kind: "path" }>,
): boolean {
  return type.name === "String" &&
    (type.crateName === "alloc" || type.crateName === "std") &&
    type.modulePath[type.modulePath.length - 1] === "string" &&
    type.genericArguments.length === 0;
}

export function isRustOptionPath(
  type: Extract<RustCompilerType, { readonly kind: "path" }>,
): boolean {
  return type.crateName === "core" &&
    type.modulePath.length === 1 &&
    type.modulePath[0] === "option" &&
    type.name === "Option" &&
    type.genericArguments.length === 1 &&
    type.genericArguments[0]?.kind === "type";
}

export function standardSourceGenericArguments(
  type: Extract<RustCompilerType, { readonly kind: "path" }>,
  location: RustCompilerStandardTypeLocation,
  context: ProjectionContext,
  position: "parameter" | "result",
): readonly ProviderTypeExpression[] {
  requireGenericApplication(type, location);
  return Object.freeze(type.genericArguments.map((argument) =>
    sourceGenericArgumentFor(argument, context, position)));
}

export function standardTargetGenericArguments(
  type: Extract<RustCompilerType, { readonly kind: "path" }>,
  location: RustCompilerStandardTypeLocation,
  context: ProjectionContext,
  position: "parameter" | "result",
): readonly RustTargetGenericArgument[] {
  requireGenericApplication(type, location);
  const substitutions = createRustCompilerSubstitutions(
    location.genericParameters,
    type.genericArguments,
  );
  return Object.freeze(location.genericParameters.map((parameter) =>
    targetGenericArgumentFor(
      compilerArgumentForParameter(parameter, substitutions),
      context,
      position,
      "target-default",
    )));
}

export function standardTargetGenericDefaults(
  type: Extract<RustCompilerType, { readonly kind: "path" }>,
  location: RustCompilerStandardTypeLocation,
  context: ProjectionContext,
  position: "parameter" | "result",
): readonly RustTargetGenericArgument[] {
  requireGenericApplication(type, location);
  const firstDefault = location.genericParameters.findIndex(genericParameterHasDefault);
  if (firstDefault < 0) return Object.freeze([]);
  const defaultParameters = location.genericParameters.slice(firstDefault);
  if (defaultParameters.some((parameter) => !genericParameterHasDefault(parameter))) {
    throw new Error("Rust generic defaults must form one trailing target-omittable suffix.");
  }
  const substitutions = createRustCompilerSubstitutions(
    location.genericParameters,
    type.genericArguments,
  );
  return Object.freeze(defaultParameters.map((parameter) =>
    targetGenericArgumentFor(
      substituteRustCompilerArgument(
        compilerDefaultArgumentForParameter(parameter),
        substitutions,
      ),
      context,
      position,
      "target-default",
    )));
}

export function withProjectionGenericParameters(
  context: ProjectionContext,
  parameters: readonly RustCompilerGenericParameter[],
): ProjectionContext {
  const names = new Map(context.genericNames ?? []);
  const occupied = new Set(names.values());
  for (const parameter of parameters) {
    const identity = genericParameterIdentity(parameter);
    const name = genericParameterName(parameter);
    const existing = names.get(identity);
    if (existing !== undefined && existing !== name) {
      throw new Error(`Rust generic identity '${identity}' has conflicting source names.`);
    }
    if (existing === undefined && occupied.has(name)) {
      throw new Error(`Rust generic source name '${name}' is declared by more than one identity.`);
    }
    names.set(identity, name);
    occupied.add(name);
  }
  return Object.freeze({ ...context, genericNames: names });
}

export function withDefaultGenericBindings(
  context: ProjectionContext,
  parameters: readonly RustCompilerGenericParameter[],
): ProjectionContext {
  const bindings = {
    types: new Map(context.defaultGenericBindings?.types ?? []),
    lifetimes: new Map(context.defaultGenericBindings?.lifetimes ?? []),
    consts: new Map(context.defaultGenericBindings?.consts ?? []),
  };
  for (const parameter of parameters) {
    if (parameter.kind === "type" && parameter.defaultType !== undefined) {
      bindings.types.set(
        parameter.identity.itemId,
        substituteRustCompilerType(parameter.defaultType, bindings),
      );
    } else if (parameter.kind === "const" && parameter.defaultValue !== undefined) {
      bindings.consts.set(
        parameter.identity.itemId,
        substituteConstArgument(parameter.defaultValue, bindings.consts),
      );
    }
  }
  return Object.freeze({
    ...context,
    defaultGenericBindings: Object.freeze(bindings),
  });
}

export function requireSourceGenericName(
  identity: string,
  context: ProjectionContext,
): string {
  const selected = context.genericNames?.get(identity);
  if (selected === undefined) {
    throw new Error(`Rust generic identity '${identity}' has no source-visible declaration.`);
  }
  return selected;
}

export function rustCompilerTypeConstructsCurrentType(
  type: RustCompilerType,
  context: ProjectionContext,
): boolean {
  if (type.kind === "self") return true;
  const current = requireCurrentType(context);
  if (type.kind !== "path" ||
    canonicalCompilerTypePathKey(type) !== canonicalPathKey(current.canonicalPath) ||
    type.genericArguments.length > current.genericParameters.length) {
    return false;
  }
  if (type.genericArguments.some((argument, index) =>
    argument.kind !== current.genericParameters[index]?.kind)) return false;
  return current.genericParameters.slice(type.genericArguments.length)
    .every(genericParameterHasDefault);
}

export function canonicalCompilerTypePathKey(
  type: Extract<RustCompilerType, { readonly kind: "path" }>,
): string {
  return canonicalPathKey(type.identity.canonicalPath);
}

export function canonicalPathKey(path: readonly string[]): string {
  return path.join("\0");
}

export function typeRequirementKey(requirement: RustCompilerTypeRequirement): string {
  return requirement === "clone" || requirement === "copy"
    ? requirement
    : `trait:${compilerTypeRequirementCanonicalPath(requirement).join("::")}`;
}

export function rustCompilerTypeText(
  type: Extract<RustCompilerType, { readonly kind: "path" }>,
): string {
  return type.identity.canonicalPath.join("::");
}

export function uniqueText(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort(compareText));
}

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requireGenericApplication(
  type: Extract<RustCompilerType, { readonly kind: "path" }>,
  location: RustCompilerStandardTypeLocation,
): void {
  if (type.genericArguments.length > location.genericParameters.length ||
    type.genericArguments.some((argument, index) =>
      argument.kind !== location.genericParameters[index]?.kind) ||
    location.genericParameters.slice(type.genericArguments.length)
      .some((parameter) => !genericParameterHasDefault(parameter))) {
    throw new Error(
      `Rust standard-library type '${rustCompilerTypeText(type)}' has a generic application that does not match its exact declaration.`,
    );
  }
}

function genericParameterHasDefault(parameter: RustCompilerGenericParameter): boolean {
  return parameter.kind === "type"
    ? parameter.defaultType !== undefined
    : parameter.kind === "const" && parameter.defaultValue !== undefined;
}

function genericParameterIdentity(parameter: RustCompilerGenericParameter): string {
  return parameter.kind === "lifetime"
    ? parameter.lifetime.kind === "parameter"
      ? parameter.lifetime.identity.itemId
      : parameter.lifetime.identity
    : parameter.identity.itemId;
}

function genericParameterName(parameter: RustCompilerGenericParameter): string {
  return parameter.kind === "lifetime" ? parameter.lifetime.name : parameter.name;
}

function compilerArgumentForParameter(
  parameter: RustCompilerGenericParameter,
  substitutions: import("../model/rustdoc-types.js").RustCompilerSubstitutions,
): RustCompilerGenericArgument {
  if (parameter.kind === "lifetime") {
    if (parameter.lifetime.kind !== "parameter") {
      throw new Error("Rust standard type lifetime parameter has no stable identity.");
    }
    const lifetime = substitutions.lifetimes.get(parameter.lifetime.identity.itemId);
    if (lifetime === undefined) {
      throw new Error("Rust standard type lifetime parameter has no exact argument.");
    }
    return Object.freeze({ kind: "lifetime", lifetime });
  }
  if (parameter.kind === "type") {
    const type = substitutions.types.get(parameter.identity.itemId);
    if (type === undefined) {
      throw new Error(`Rust standard type parameter '${parameter.name}' has no exact argument.`);
    }
    return Object.freeze({ kind: "type", type });
  }
  const value = substitutions.consts.get(parameter.identity.itemId);
  if (value === undefined) {
    throw new Error(`Rust standard const parameter '${parameter.name}' has no exact argument.`);
  }
  return Object.freeze({ kind: "const", value });
}

function compilerDefaultArgumentForParameter(
  parameter: RustCompilerGenericParameter,
): RustCompilerGenericArgument {
  if (parameter.kind === "type" && parameter.defaultType !== undefined) {
    return Object.freeze({ kind: "type", type: parameter.defaultType });
  }
  if (parameter.kind === "const" && parameter.defaultValue !== undefined) {
    return Object.freeze({ kind: "const", value: parameter.defaultValue });
  }
  throw new Error("Rust generic default metadata contains a non-defaulted parameter.");
}

function substituteConstArgument(
  value: RustCompilerConstArgument,
  substitutions: ReadonlyMap<string, RustCompilerConstArgument>,
): RustCompilerConstArgument {
  return value.kind === "parameter"
    ? substitutions.get(value.identity.itemId) ?? value
    : value;
}
