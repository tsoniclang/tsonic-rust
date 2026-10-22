import { importedSourceType, requireSourceGenericName, withProjectionGenericParameters } from "../utilities.js";
import { compilerModuleSpecifier } from "../operations.js";
import { sourceTypeFor, targetTypeFor } from "./types.js";
import { rustTypesModule } from "../../../../target-model/identities/source.js";
import { rustSourceTypeExportIds } from "../../../../target-model/identities/source.js";
import type { ProviderTypeExpression, ProviderTypeParameterDeclaration } from "@tsonic/tsts";
import type { RustCompilerConstArgument, RustCompilerGenericArgument, RustCompilerGenericParameter, RustCompilerLifetime, RustCompilerLifetimeBinder } from "../../model/model.js";
import type { ProjectionContext } from "./context.js";
import type { RustTargetConstArgument, RustTargetGenericArgument } from "../../../../target-model/types/model.js";
import type { RustProviderGenericParameter } from "../../../../target-model/operations/model.js";
import { rustLifetimeKey } from "../../../../target-model/lifetimes/index.js";
import type { RustLifetimeBinder, RustLifetimeRef } from "../../../../target-model/lifetimes/index.js";

export function sourceGenericArgumentFor(
  argument: RustCompilerGenericArgument,
  context: ProjectionContext,
  position: "parameter" | "result",
): ProviderTypeExpression {
  switch (argument.kind) {
    case "type":
      return sourceTypeFor(argument.type, context, position);
    case "lifetime": {
      const selected = sourceLifetimeFor(argument.lifetime, context);
      return selected ?? importedSourceType(
        context,
        rustTypesModule,
        rustSourceTypeExportIds.life,
        [],
      );
    }
    case "const":
      return sourceConstFor(argument.value, context);
  }
}

export function targetGenericArgumentFor(
  argument: RustCompilerGenericArgument,
  context: ProjectionContext,
  position: "parameter" | "result",
  pathResolution: "source-visible" | "target-default" = "source-visible",
): RustTargetGenericArgument {
  switch (argument.kind) {
    case "type":
      return {
        kind: "type",
        type: targetTypeFor(argument.type, context, position, true, pathResolution),
      };
    case "lifetime": {
      const lifetime = targetLifetimeFor(argument.lifetime, context);
      if (lifetime === undefined) {
        throw new Error(
          "An elided Rust lifetime cannot occupy an explicit generic argument slot.",
        );
      }
      return { kind: "lifetime", lifetime };
    }
    case "const":
      return { kind: "const", value: targetConstFor(argument.value, context) };
  }
}

export function providerGenericParametersFor(
  parameters: readonly RustCompilerGenericParameter[],
  context: ProjectionContext,
): readonly ProviderTypeParameterDeclaration[] {
  const selectedContext = withProjectionGenericParameters(context, parameters);
  return Object.freeze(parameters.map((parameter): ProviderTypeParameterDeclaration => {
    const name = sourceGenericParameterName(parameter, selectedContext);
    if (parameter.kind === "lifetime") {
      return Object.freeze({
        name,
        constraints: Object.freeze([
          importedSourceType(
            selectedContext,
            rustTypesModule,
            rustSourceTypeExportIds.life,
            [],
          ),
          ...parameter.outlives.map((lifetime) =>
            importedSourceType(
              selectedContext,
              rustTypesModule,
              rustSourceTypeExportIds.outlives,
              [requireSourceLifetimeFor(lifetime, selectedContext, "lifetime outlives")],
            )),
        ]),
      });
    }
    if (parameter.kind === "const") {
      const scalar = parameter.type.kind === "primitive" ? parameter.type.name : undefined;
      const constraint: ProviderTypeExpression = scalar !== undefined &&
          /^(?:[iu](?:8|16|32|64|128|size))$/.test(scalar)
        ? { kind: "union", types: [{ kind: "number" }, { kind: "bigint" }] }
        : sourceTypeFor(parameter.type, selectedContext, "parameter");
      return Object.freeze({
        name,
        constraints: Object.freeze([constraint]),
        ...(parameter.defaultValue === undefined
          ? {}
          : { defaultType: sourceConstFor(parameter.defaultValue, selectedContext) }),
      });
    }
    const constraints = [
      ...parameter.outlives.map((lifetime) =>
        importedSourceType(
          selectedContext,
          rustTypesModule,
          rustSourceTypeExportIds.validFor,
          [requireSourceLifetimeFor(lifetime, selectedContext, "type outlives")],
        )),
      ...(parameter.maybeSized
        ? [importedSourceType(
            selectedContext,
            rustTypesModule,
            rustSourceTypeExportIds.maybeSized,
            [],
          )]
        : []),
    ];
    return Object.freeze({
      name,
      ...(constraints.length === 0 ? {} : { constraints: Object.freeze(constraints) }),
      ...(parameter.defaultType === undefined
        ? {}
        : {
            defaultType: sourceTypeFor(
              parameter.defaultType,
              selectedContext,
              "parameter",
            ),
          }),
    });
  }));
}

export function providerGenericBindingsFor(
  parameters: readonly RustCompilerGenericParameter[],
  context: ProjectionContext,
): readonly RustProviderGenericParameter[] {
  const selected = withProjectionGenericParameters(context, parameters);
  return Object.freeze(parameters.map((parameter): RustProviderGenericParameter => {
    const sourceName = sourceGenericParameterName(parameter, selected);
    if (parameter.kind === "lifetime") {
      const lifetime = targetLifetimeFor(parameter.lifetime, selected);
      if (lifetime === undefined) {
        throw new Error("A provider lifetime parameter cannot be elided.");
      }
      return Object.freeze({
        kind: "lifetime",
        sourceName,
        targetIdentity: rustLifetimeKey(lifetime),
      });
    }
    if (parameter.kind === "const") {
      return Object.freeze({
        kind: "const",
        sourceName,
        targetIdentity: parameter.identity.itemId,
        ...(parameter.defaultValue === undefined
          ? {}
          : {
              defaultArgument: Object.freeze({
                kind: "const" as const,
                value: targetConstFor(parameter.defaultValue, selected),
              }),
            }),
      });
    }
    return Object.freeze({
      kind: "type",
      sourceName,
      targetIdentity: parameter.identity.itemId,
      ...(parameter.maybeSized ? { maybeSized: true as const } : {}),
      ...(parameter.defaultType === undefined
        ? {}
        : {
            defaultArgument: Object.freeze({
              kind: "type" as const,
              type: targetTypeFor(parameter.defaultType, selected, "parameter", true),
            }),
          }),
    });
  }));
}

export function sourceGenericParameterNames(
  parameters: readonly RustCompilerGenericParameter[],
  context: ProjectionContext,
): readonly string[] {
  const selected = withProjectionGenericParameters(context, parameters);
  return Object.freeze(parameters.map((parameter) =>
    sourceGenericParameterName(parameter, selected)));
}

export function sourceGenericParameterArguments(
  parameters: readonly RustCompilerGenericParameter[],
  context: ProjectionContext,
): readonly ProviderTypeExpression[] {
  const selected = withProjectionGenericParameters(context, parameters);
  return Object.freeze(parameters.map((parameter): ProviderTypeExpression => ({
    kind: "type-parameter",
    name: sourceGenericParameterName(parameter, selected),
  })));
}

export function targetGenericParameterArguments(
  parameters: readonly RustCompilerGenericParameter[],
  context: ProjectionContext,
): readonly RustTargetGenericArgument[] {
  const selected = withProjectionGenericParameters(context, parameters);
  return Object.freeze(parameters.map((parameter): RustTargetGenericArgument => {
    if (parameter.kind === "lifetime") {
      const lifetime = targetLifetimeFor(parameter.lifetime, selected);
      if (lifetime === undefined) {
        throw new Error("A declared Rust lifetime parameter cannot be elided.");
      }
      return { kind: "lifetime", lifetime };
    }
    if (parameter.kind === "type") {
      return {
        kind: "type",
        type: targetTypeFor({ kind: "generic", identity: parameter.identity, name: parameter.name }, selected, "parameter"),
      };
    }
    return {
      kind: "const",
      value: {
        kind: "parameter",
        identity: parameter.identity.itemId,
        name: requireSourceGenericName(parameter.identity.itemId, selected),
      },
    };
  }));
}

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
      return Number.isSafeInteger(selected) && String(selected) === value.value
        ? { kind: "literal", value: selected }
        : { kind: "bigint-literal", value: value.value };
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
  if (context.localTypeLocations.has(canonicalPath.join("\0"))) {
    return context.owner.moduleSpecifier;
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
  return context.localTypeLocations.get(canonicalPath.join("\0"))?.targetPath.join("::") ?? [
    context.dependency.targetCrateName,
    ...canonicalPath.slice(1),
  ].join("::");
}
