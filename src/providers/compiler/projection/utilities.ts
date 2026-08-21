import { createHash } from "node:crypto";
import { sourceTypeFor, targetTypeFor } from "./types.js";
import { substituteRustCompilerType } from "../model/rustdoc-types.js";
import type { ProjectionContext } from "./model.js";
import type { ProviderTypeExpression } from "@tsonic/tsts";
import type { RustCompilerType, RustCompilerTypeParameter, RustCompilerStandardTypeLocation } from "../model/model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

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
    typeArguments,
  };
}

export function digestText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function requireCurrentType(context: ProjectionContext): NonNullable<ProjectionContext["currentType"]> {
  if (context.currentType === undefined) {
    throw new Error("Rust Self type occurs outside a projected type declaration.");
  }
  return context.currentType;
}

export function isRustStringPath(type: Extract<RustCompilerType, { readonly kind: "path" }>): boolean {
  return type.name === "String" &&
    (type.crateName === "alloc" || type.crateName === "std") &&
    type.modulePath[type.modulePath.length - 1] === "string" &&
    type.typeArguments.length === 0;
}

export function isRustOptionPath(type: Extract<RustCompilerType, { readonly kind: "path" }>): boolean {
  return type.crateName === "core" &&
    type.modulePath.length === 1 &&
    type.modulePath[0] === "option" &&
    type.name === "Option" &&
    type.typeArguments.length === 1;
}

export function standardSourceTypeArguments(
  type: Extract<RustCompilerType, { readonly kind: "path" }>,
  location: RustCompilerStandardTypeLocation,
  context: ProjectionContext,
  position: "parameter" | "result",
): readonly ProviderTypeExpression[] {
  const count = requireStandardSourceTypeArgumentCount(type, location);
  return Object.freeze(type.typeArguments.slice(0, count)
    .map((argument) => sourceTypeFor(argument, context, position, true)));
}

export function standardTargetTypeArguments(
  type: Extract<RustCompilerType, { readonly kind: "path" }>,
  location: RustCompilerStandardTypeLocation,
  context: ProjectionContext,
  position: "parameter" | "result",
): readonly TargetTypeRef[] {
  const count = requireStandardSourceTypeArgumentCount(type, location);
  return Object.freeze(type.typeArguments.slice(0, count)
    .map((argument) => targetTypeFor(argument, context, position, true)));
}

function requireStandardSourceTypeArgumentCount(
  type: Extract<RustCompilerType, { readonly kind: "path" }>,
  location: RustCompilerStandardTypeLocation,
): number {
  const count = location.sourceTypeArgumentCount;
  if (type.typeArguments.length < count) {
    throw new Error(
      `Rust standard-library type '${rustCompilerTypeText(type)}' supplies ${type.typeArguments.length} ` +
      `type arguments for source arity ${count}.`,
    );
  }
  return count;
}

export function sourceVisibleTypeParameters(
  parameters: readonly RustCompilerTypeParameter[],
): readonly RustCompilerTypeParameter[] {
  const firstDefault = parameters.findIndex((parameter) => parameter.defaultType !== undefined);
  if (firstDefault < 0) {
    return parameters;
  }
  if (parameters.slice(firstDefault).some((parameter) => parameter.defaultType === undefined)) {
    throw new Error("Rust default type parameters must form one trailing source-omittable suffix.");
  }
  return Object.freeze(parameters.slice(0, firstDefault));
}

export function withDefaultTypeBindings(
  context: ProjectionContext,
  parameters: readonly RustCompilerTypeParameter[],
): ProjectionContext {
  const firstDefault = parameters.findIndex((parameter) => parameter.defaultType !== undefined);
  if (firstDefault < 0) {
    return context;
  }
  if (parameters.slice(firstDefault).some((parameter) => parameter.defaultType === undefined)) {
    throw new Error("Rust default type parameters must form one trailing source-omittable suffix.");
  }
  const bindings = new Map(context.defaultTypeBindings ?? []);
  for (const parameter of parameters.slice(firstDefault)) {
    const defaultType = parameter.defaultType;
    if (defaultType === undefined) {
      throw new Error(`Rust default type parameter '${parameter.name}' has no default type.`);
    }
    bindings.set(parameter.name, substituteRustCompilerType(defaultType, bindings));
  }
  return { ...context, defaultTypeBindings: bindings };
}

export function rustCompilerTypeNamesCurrentType(
  type: RustCompilerType,
  context: ProjectionContext,
): boolean {
  if (type.kind === "self") {
    return true;
  }
  const current = requireCurrentType(context);
  if (type.kind !== "path" ||
    canonicalCompilerTypePathKey(type) !== canonicalPathKey(current.canonicalPath) ||
    type.typeArguments.length < current.typeParameters.length) {
    return false;
  }
  return current.typeParameters.every((name, index) => {
    const argument = type.typeArguments[index];
    return argument?.kind === "generic" && argument.name === name;
  });
}

export function canonicalCompilerTypePathKey(
  type: Extract<RustCompilerType, { readonly kind: "path" }>,
): string {
  return canonicalPathKey([type.crateName, ...type.modulePath, type.name]);
}

export function canonicalPathKey(path: readonly string[]): string {
  return path.join("\0");
}

export function typeRequirementKey(
  requirement: RustCompilerTypeParameter["requirements"][number],
): string {
  return typeof requirement === "string" ? requirement : `trait:${requirement.path}`;
}

export function rustCompilerTypeText(type: Extract<RustCompilerType, { readonly kind: "path" }>): string {
  return [type.crateName, ...type.modulePath, type.name].join("::");
}

export function uniqueText(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort(compareText));
}

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
