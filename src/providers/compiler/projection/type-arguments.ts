import {
  importedSourceType,
  requireSourceGenericName,
  withProjectionGenericParameters,
} from "./utilities.js";
import { compilerModuleSpecifier } from "./operations.js";
import { rustTypesModule } from "../../../source/profiles/source-modules.js";
import { rustSourceTypeExportIds } from "../../../source/semantics/identity.js";
import type { ProviderTypeExpression } from "@tsonic/tsts";
import type {
  RustCompilerConstArgument,
  RustCompilerGenericParameter,
  RustCompilerLifetime,
  RustCompilerLifetimeBinder,
} from "../model/model.js";
import type { ProjectionContext } from "./model.js";
import type { RustTargetConstArgument } from "../../../target-model/types/model.js";
import type {
  RustLifetimeBinder,
  RustLifetimeRef,
} from "../../../target-model/lifetimes/index.js";

export function sourceLifetimeFor(
  lifetime: RustCompilerLifetime,
  context: ProjectionContext,
): ProviderTypeExpression | undefined {
  switch (lifetime.kind) {
    case "elided":
      return undefined;
    case "static":
      return importedSourceType(
        context,
        rustTypesModule,
        rustSourceTypeExportIds.staticLifetime,
        [],
      );
    case "placeholder":
      return importedSourceType(
        context,
        rustTypesModule,
        rustSourceTypeExportIds.placeholderLifetime,
        [],
      );
    case "parameter":
      return {
        kind: "type-parameter",
        name: requireSourceGenericName(lifetime.identity.itemId, context),
      };
    case "bound":
      return {
        kind: "type-parameter",
        name: requireSourceGenericName(lifetime.identity, context),
      };
  }
}

export function requireSourceLifetimeFor(
  lifetime: RustCompilerLifetime,
  context: ProjectionContext,
  position: string,
): ProviderTypeExpression {
  const selected = sourceLifetimeFor(lifetime, context);
  if (selected === undefined) {
    throw new Error(`Rust ${position} cannot use an elided lifetime.`);
  }
  return selected;
}

export function targetLifetimeFor(
  lifetime: RustCompilerLifetime,
  context: ProjectionContext,
): RustLifetimeRef | undefined {
  switch (lifetime.kind) {
    case "elided":
      return undefined;
    case "static":
      return { kind: "static" };
    case "placeholder":
      return { kind: "placeholder" };
    case "parameter":
      return {
        kind: "parameter",
        identity: lifetime.identity.itemId,
        name: requireSourceGenericName(lifetime.identity.itemId, context),
      };
    case "bound":
      return {
        kind: "bound",
        binderIdentity: lifetime.binderIdentity,
        identity: lifetime.identity,
        name: requireSourceGenericName(lifetime.identity, context),
      };
  }
}

export function requireTargetLifetimes(
  lifetimes: readonly RustCompilerLifetime[],
  context: ProjectionContext,
  position: string,
): readonly RustLifetimeRef[] {
  return Object.freeze(lifetimes.map((lifetime) => {
    const selected = targetLifetimeFor(lifetime, context);
    if (selected === undefined) {
      throw new Error(`Rust ${position} cannot use an elided lifetime.`);
    }
    return selected;
  }));
}

export function targetLifetimeBinderFor(
  binder: RustCompilerLifetimeBinder,
  context: ProjectionContext,
): RustLifetimeBinder {
  return Object.freeze({
    identity: binder.identity,
    parameters: Object.freeze(binder.parameters.map((parameter) => {
      const lifetime = targetLifetimeFor(parameter.lifetime, context);
      if (lifetime?.kind !== "bound") {
        throw new Error(
          `Rust lifetime binder '${binder.identity}' contains a non-bound parameter.`,
        );
      }
      return Object.freeze({
        lifetime,
        outlives: requireTargetLifetimes(
          parameter.outlives,
          context,
          `binder '${binder.identity}' outlives`,
        ),
      });
    })),
  });
}

export function withCompilerLifetimeBinder(
  context: ProjectionContext,
  binder: RustCompilerLifetimeBinder | undefined,
): ProjectionContext {
  return binder === undefined
    ? context
    : withProjectionGenericParameters(context, binder.parameters);
}

export function sourceConstFor(
  value: RustCompilerConstArgument,
  context: ProjectionContext,
): ProviderTypeExpression {
  switch (value.kind) {
    case "integer": {
      const selected = Number(value.value);
      if (!Number.isSafeInteger(selected) || String(selected) !== value.value) {
        throw new Error(
          `Rust const integer '${value.value}' is outside exact TypeScript literal range.`,
        );
      }
      return { kind: "literal", value: selected };
    }
    case "boolean":
    case "char":
      return { kind: "literal", value: value.value };
    case "parameter":
      return {
        kind: "type-parameter",
        name: requireSourceGenericName(value.identity.itemId, context),
      };
    case "infer":
      return { kind: "unknown" };
  }
}

export function targetConstFor(
  value: RustCompilerConstArgument,
  context: ProjectionContext,
): RustTargetConstArgument {
  if (value.kind !== "parameter") return value;
  return {
    kind: "parameter",
    identity: value.identity.itemId,
    name: requireSourceGenericName(value.identity.itemId, context),
  };
}

export function sourceGenericParameterName(
  parameter: RustCompilerGenericParameter,
  context: ProjectionContext,
): string {
  return parameter.kind === "lifetime"
    ? requireSourceGenericName(
        parameter.lifetime.kind === "parameter"
          ? parameter.lifetime.identity.itemId
          : parameter.lifetime.identity,
        context,
      )
    : requireSourceGenericName(parameter.identity.itemId, context);
}

export function compilerModuleSpecifierForIdentity(
  canonicalPath: readonly string[],
  context: ProjectionContext,
): string {
  const crateName = canonicalPath[0];
  if (crateName !== context.dependency.crateName) {
    throw new Error(
      `External Rust item '${canonicalPath.join("::")}' has no imported provider contract.`,
    );
  }
  return compilerModuleSpecifier(
    context.dependency.alias,
    canonicalPath.slice(1, -1),
  );
}

export function targetPathForIdentity(
  canonicalPath: readonly string[],
  context: ProjectionContext,
): string {
  if (canonicalPath[0] !== context.dependency.crateName) {
    throw new Error(
      `External Rust trait '${canonicalPath.join("::")}' has no target path contract.`,
    );
  }
  return [
    context.dependency.targetCrateName,
    ...canonicalPath.slice(1),
  ].join("::");
}
