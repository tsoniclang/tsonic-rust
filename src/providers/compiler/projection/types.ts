import {
  rustFixedArrayType,
  rustNeverTargetType,
  rustOptionTargetType,
  rustPathTargetType,
  rustRawPointerTargetType,
  rustReferenceTargetType,
  rustSequenceTargetType,
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
  rustTupleTargetType,
  rustBuiltinTraitForCanonicalPath,
  rustFnOnceOutputIdentity,
  rustTypeParameterTargetType,
  rustUnitTargetType,
} from "../../../target-model/types/index.js";
import {
  canonicalPathKey,
  importedSourceType,
  isRustOptionPath,
  isRustStringPath,
  requireCurrentType,
  rustCompilerTypeText,
  sourceBoundIsAccessible,
  standardSourceTypeArguments,
  standardTargetTypeArguments,
} from "./utilities.js";
import {
  compilerModuleSpecifier,
  compilerTargetTypeId,
  rustPath,
} from "./operations.js";
import { compilerAssociatedSourceExportName } from "../model/rustdoc-items.js";
import { rustConstPointerExport, rustMutPointerExport } from "../../../source/extension/source-extension.js";
import { rustTypesModule } from "../../../source/profiles/source-modules.js";
import { rustSourceTypeExportIds } from "../../../source/semantics/identity.js";
import { sourcePrimitiveByRustName } from "./model.js";
import type { ProjectionContext } from "./model.js";
import type { ProviderTypeExpression } from "@tsonic/tsts";
import type {
  RustCompilerBound,
  RustCompilerConstExpression,
  RustCompilerGenericArgument,
  RustCompilerLifetime,
  RustCompilerTraitReference,
  RustCompilerType,
} from "../model/model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type {
  RustBound,
  RustConstExpr,
  RustGenericArgument,
  RustGenericParameter,
  RustGenerics,
  RustLifetimeRef,
  RustSemanticIdentity,
  RustTraitRef,
  RustWherePredicate,
} from "../../../target-model/semantics/index.js";
import { rustStaticLifetime } from "../../../target-model/semantics/index.js";
import { rustFunctionPointerTargetType, rustOpaqueTargetType } from "../../../target-model/types/constructors.js";
import { standardRustCallableTraitRole } from "./standard-library-policy.js";

export function sourceTypeFor(
  type: RustCompilerType,
  context: ProjectionContext,
  position: "parameter" | "result",
  nested = false,
): ProviderTypeExpression {
  const substituted = type.kind === "type-parameter"
    ? context.defaultTypeBindings?.types.get(type.identity.itemId)
    : undefined;
  if (substituted !== undefined) return sourceTypeFor(substituted, context, position, nested);
  switch (type.kind) {
    case "unit": return { kind: "void" };
    case "never": return { kind: "never" };
    case "primitive": {
      if (type.name === "str") return { kind: "string" };
      if (type.name === "char") {
        return importedSourceType(context, rustTypesModule, rustSourceTypeExportIds.rustChar, []);
      }
      const primitive = sourcePrimitiveByRustName.get(type.name);
      if (primitive === undefined) throw new Error(`Rust primitive '${type.name}' has no source primitive contract.`);
      return { kind: "source-primitive", name: primitive };
    }
    case "type-parameter":
      return sourceTypeParameterFor(type, context, position);
    case "self": return requireCurrentType(context).sourceType;
    case "tuple": return { kind: "tuple", elementTypes: type.elements.map((element) => sourceTypeFor(element, context, position, true)) };
    case "array":
    case "slice": return { kind: "array", elementType: sourceTypeFor(type.element, context, position, true) };
    case "reference":
      return importedSourceType(context, rustTypesModule,
        type.mutable ? rustSourceTypeExportIds.mutableReference : rustSourceTypeExportIds.sharedReference,
        [sourceTypeFor(type.target, context, position, true), sourceLifetimeFor(type.lifetime, context)]);
    case "raw-pointer":
      return importedSourceType(context, rustTypesModule, type.mutable ? rustMutPointerExport : rustConstPointerExport,
        [sourceTypeFor(type.target, context, position, true)]);
    case "function-pointer":
      return importedSourceType(context, rustTypesModule, rustSourceTypeExportIds.functionPointer, [
        { kind: "tuple", elementTypes: type.parameters.map((parameter) => sourceTypeFor(parameter, context, position, true)) },
        sourceTypeFor(type.result, context, position, true),
        { kind: "literal", value: type.abi },
        { kind: "literal", value: type.safety === "unsafe" },
        { kind: "literal", value: type.variadic },
      ]);
    case "trait-object": {
      const traits = [type.principal, ...type.autoTraits].map((trait) =>
        sourceTraitFor(trait, context, position));
      const sourceTraits: ProviderTypeExpression = traits.length === 1
        ? traits[0]!
        : { kind: "intersection", types: traits };
      return importedSourceType(context, rustTypesModule, rustSourceTypeExportIds.dynamicTrait, [
        sourceTraits,
        sourceLifetimeFor(type.lifetime, context),
      ]);
    }
    case "opaque": {
      const traitBounds = type.bounds.filter((bound): bound is Extract<RustCompilerBound, {
        readonly kind: "trait";
      }> => bound.kind === "trait" && bound.polarity === "required");
      if (traitBounds.length === 0) {
        throw new Error("Rust opaque type has no exact principal source bound.");
      }
      const sourceBounds = traitBounds.map((bound) => sourceTraitFor(bound.trait, context, position));
      return importedSourceType(context, rustTypesModule, rustSourceTypeExportIds.opaqueType, [
        sourceBounds.length === 1
          ? sourceBounds[0]!
          : { kind: "intersection", types: sourceBounds },
        importedSourceType(context, rustTypesModule, rustSourceTypeExportIds.captureSet, [
          { kind: "tuple", elementTypes: type.captures.map((capture) => sourceGenericArgumentFor(capture, context, position)) },
        ]),
      ]);
    }
    case "associated-type":
      return sourceAssociatedTypeFor(type, context, position);
    case "path": {
      if (isRustStringPath(type)) return { kind: "string" };
      if (isRustOptionPath(type)) {
        const [argument] = type.arguments;
        if (type.arguments.length !== 1 || argument?.kind !== "type") {
          throw new Error("Rust Option must carry exactly one type argument.");
        }
        return {
          kind: "union",
          types: [sourceTypeFor(argument.value, context, position, true), { kind: "undefined" }],
        };
      }
      const standard = context.standardItems.get(canonicalPathKey(type.identity.canonicalPath));
      if (standard?.kind === "trait") {
        throw new Error(`Rust trait '${type.identity.canonicalPath.join("::")}' was selected in a type-path position.`);
      }
      if (standard !== undefined) {
        if (standard.sourceAvailability === "unavailable") {
          throw new Error(`Rust standard type '${type.identity.canonicalPath.join("::")}' has no public source contract.`);
        }
        const arguments_ = standardSourceTypeArguments(type, standard, context, position);
        const localName = context.localStandardTypeNames.get(canonicalPathKey(type.identity.canonicalPath));
        return importedSourceType(context,
          localName === undefined ? standard.sourceModuleSpecifier : context.owner.moduleSpecifier,
          localName ?? standard.sourceExportName,
          arguments_);
      }
      if (type.crateName !== context.dependency.crateName) {
        throw new Error(`External Rust type '${rustCompilerTypeText(type)}' has no imported provider contract.`);
      }
      const moduleSpecifier = compilerModuleSpecifier(context.dependency.alias, type.modulePath);
      if (moduleSpecifier !== context.owner.moduleSpecifier) {
        const names = context.imports.get(moduleSpecifier) ?? new Set<string>();
        names.add(type.name);
        context.imports.set(moduleSpecifier, names);
      }
      return {
        kind: "provider-ref",
        moduleSpecifier,
        exportName: type.name,
        ...(type.arguments.length === 0 ? {} : {
          typeArguments: type.arguments.map((argument) => sourceGenericArgumentFor(argument, context, position)),
        }),
      };
    }
  }
}

function sourceTypeParameterFor(
  type: Extract<RustCompilerType, { readonly kind: "type-parameter" }>,
  context: ProjectionContext,
  position: "parameter" | "result",
): ProviderTypeExpression {
  const parameter = context.genericParameters?.get(type.identity.itemId);
  if (parameter?.kind !== "type" || parameter.declarationKind === "explicit") {
    return {
      kind: "type-parameter",
      name: requireSourceGenericName(type.identity.itemId, context),
    };
  }
  const requiredTraits = parameter.bounds.flatMap((bound) =>
    sourceBoundIsAccessible(bound, context) && bound.kind === "trait" && bound.polarity === "required"
      ? [sourceTraitFor(bound.trait, context, position)]
      : []);
  if (requiredTraits.length === 0) return { kind: "unknown" };
  if (requiredTraits.length === 1) return requiredTraits[0]!;
  return { kind: "intersection", types: requiredTraits };
}

function sourceAssociatedTypeFor(
  type: Extract<RustCompilerType, { readonly kind: "associated-type" }>,
  context: ProjectionContext,
  position: "parameter" | "result",
): ProviderTypeExpression {
  const standard = context.standardItems.get(canonicalPathKey(type.trait.identity.canonicalPath));
  if (standard !== undefined && standard.kind !== "trait") {
    throw new Error(
      `Rust associated type owner '${type.trait.identity.canonicalPath.join("::")}' is not a trait.`,
    );
  }
  if (standard?.sourceAvailability === "unavailable") {
    throw new Error(
      `Rust associated type owner '${type.trait.identity.canonicalPath.join("::")}' has no public source contract.`,
    );
  }
  const moduleSpecifier = standard?.sourceModuleSpecifier ?? (() => {
    const path = type.trait.identity.canonicalPath;
    if (path[0] !== context.dependency.crateName) {
      throw new Error(
        `External Rust associated type '${type.displayName}' has no imported provider contract.`,
      );
    }
    return compilerModuleSpecifier(context.dependency.alias, path.slice(1, -1));
  })();
  return importedSourceType(
    context,
    moduleSpecifier,
    compilerAssociatedSourceExportName(type.item.itemId, type.displayName),
    [
      ...type.trait.arguments.map((argument) =>
        sourceGenericArgumentFor(argument, context, position)),
      sourceTypeFor(type.owner, context, position, true),
      ...type.arguments.map((argument) =>
        sourceGenericArgumentFor(argument, context, position)),
    ],
  );
}

export function sourceGenericArgumentFor(
  argument: RustCompilerGenericArgument,
  context: ProjectionContext,
  position: "parameter" | "result",
): ProviderTypeExpression {
  switch (argument.kind) {
    case "type": return sourceTypeFor(argument.value, context, position, true);
    case "lifetime": return sourceLifetimeFor(argument.value, context);
    case "const": return sourceConstFor(argument.value, context);
  }
}

export function targetTypeFor(
  type: RustCompilerType,
  context: ProjectionContext,
  position: "parameter" | "result",
  nested = false,
): TargetTypeRef {
  const substituted = type.kind === "type-parameter"
    ? context.defaultTypeBindings?.types.get(type.identity.itemId)
    : undefined;
  if (substituted !== undefined) return targetTypeFor(substituted, context, position, nested);
  switch (type.kind) {
    case "unit": return rustUnitTargetType();
    case "never": return rustNeverTargetType();
    case "primitive": {
      if (type.name === "str") return Object.freeze({ kind: "str" });
      if (type.name === "char") return Object.freeze({ kind: "primitive", name: "char" });
      const primitive = sourcePrimitiveByRustName.get(type.name);
      if (primitive === undefined) throw new Error(`Rust primitive '${type.name}' has no target carrier contract.`);
      return rustSourcePrimitiveTargetType(primitive);
    }
    case "type-parameter":
      return rustTypeParameterTargetType(
        compilerProjectionIdentity(context, type.identity.itemId),
        requireSourceGenericName(type.identity.itemId, context),
      );
    case "self": return requireCurrentType(context).carrier;
    case "tuple": return rustTupleTargetType(type.elements.map((element) =>
      targetTypeFor(element, context, position, true)));
    case "array": return rustFixedArrayType(targetTypeFor(type.element, context, position, true), targetConstFor(type.length, context));
    case "slice": return nested
      ? Object.freeze({ kind: "slice", element: targetTypeFor(type.element, context, position, true) })
      : rustSequenceTargetType(targetTypeFor(type.element, context, position, true));
    case "reference": return rustReferenceTargetType(targetTypeFor(type.target, context, position, true), type.mutable, targetLifetimeFor(type.lifetime, context));
    case "raw-pointer": return rustRawPointerTargetType(targetTypeFor(type.target, context, position, true), type.mutable);
    case "function-pointer": return rustFunctionPointerTargetType({
      ...(type.binder === undefined ? {} : { binder: targetBinderFor(type.binder, context) }),
      parameters: type.parameters.map((parameter) => targetTypeFor(parameter, context, position, true)),
      result: targetTypeFor(type.result, context, position, true),
      abi: compilerAbi(type.abi),
      safety: type.safety,
      variadic: type.variadic,
    });
    case "trait-object": return Object.freeze({
      kind: "trait-object",
      principal: targetTraitFor(type.principal, context, position),
      autoTraits: Object.freeze(type.autoTraits.map((trait) => targetTraitFor(trait, context, position))),
      lifetime: targetLifetimeFor(type.lifetime, context),
    });
    case "opaque": return rustOpaqueTargetType({
      identity: compilerProjectionIdentity(context, type.identity.itemId),
      bounds: type.bounds.map((bound) => targetBoundFor(bound, context, position)),
      captures: Object.freeze(type.captures.map((capture) => {
        const selected = targetGenericArgumentFor(capture, context, position);
        if (selected.kind === "lifetime") return { kind: "lifetime" as const, value: selected.value };
        if (selected.kind === "type" && selected.value.kind === "type-parameter") return { kind: "type" as const, identity: selected.value.identity, displayName: selected.value.displayName };
        if (selected.kind === "const" && selected.value.kind === "parameter") return { kind: "const" as const, identity: selected.value.identity, displayName: selected.value.displayName };
        throw new Error("Rust opaque capture is not a generic identity.");
      })),
    });
    case "associated-type": return Object.freeze({
      kind: "associated-type",
      owner: targetTypeFor(type.owner, context, position, true),
      trait: targetTraitFor(type.trait, context, position),
      item: compilerProjectionIdentity(context, type.item.itemId),
      displayName: type.displayName,
      arguments: Object.freeze(type.arguments.map((argument) => targetGenericArgumentFor(argument, context, position))),
    });
    case "path": {
      if (isRustStringPath(type)) return rustStringTargetType();
      if (isRustOptionPath(type)) {
        const [argument] = type.arguments;
        if (type.arguments.length !== 1 || argument?.kind !== "type") {
          throw new Error("Rust Option must carry exactly one target type argument.");
        }
        return rustOptionTargetType(targetTypeFor(argument.value, context, position, true));
      }
      const standard = context.standardItems.get(canonicalPathKey(type.identity.canonicalPath));
      if (standard?.kind === "trait") {
        throw new Error(`Rust trait '${type.identity.canonicalPath.join("::")}' was selected in a type-path position.`);
      }
      if (standard !== undefined) {
        if (standard.sourceAvailability === "unavailable") {
          throw new Error(`Rust standard type '${type.identity.canonicalPath.join("::")}' has no public target path.`);
        }
        const arguments_ = standardTargetTypeArguments(type, standard, context, position);
        const path = standard.targetPath.join("::");
        return rustPathTargetType({
          identity: compilerProjectionIdentity(context, standard.targetId),
          displayPath: standard.targetPath,
          arguments: arguments_,
        });
      }
      if (type.crateName !== context.dependency.crateName) throw new Error(`External Rust type '${rustCompilerTypeText(type)}' has no target carrier contract.`);
      const id = compilerTargetTypeId(context.dependency, type.identity.canonicalPath);
      const path = rustPath(context.dependency.targetCrateName, type.modulePath, type.name);
      return rustPathTargetType({
        identity: compilerProjectionIdentity(context, id),
        displayPath: path.split("::"),
        arguments: type.arguments.map((argument) => targetGenericArgumentFor(argument, context, position)),
      });
    }
  }
}

export function targetGenericArgumentFor(
  argument: RustCompilerGenericArgument,
  context: ProjectionContext,
  position: "parameter" | "result",
): RustGenericArgument {
  switch (argument.kind) {
    case "type": return Object.freeze({ kind: "type", value: targetTypeFor(argument.value, context, position, true) });
    case "lifetime": return Object.freeze({ kind: "lifetime", value: targetLifetimeFor(argument.value, context) });
    case "const": return Object.freeze({ kind: "const", value: targetConstFor(argument.value, context) });
  }
}

export function compilerProjectionIdentity(context: ProjectionContext, itemId: string): RustSemanticIdentity {
  return Object.freeze({
    kind: "provider",
    providerId: context.owner.providerId,
    providerVersion: context.owner.providerVersion,
    compilationSnapshotId: context.owner.compilationSnapshotId,
    itemId,
  });
}

export function parameterPassing(type: RustCompilerType): {
  readonly type: RustCompilerType;
  readonly sourceMode: "by-value" | "borrow-shared" | "borrow-mut";
  readonly targetMode: "value" | "ref" | "mut-ref";
} {
  if (type.kind !== "reference") return { type, sourceMode: "by-value", targetMode: "value" };
  return type.mutable
    ? { type: type.target, sourceMode: "borrow-mut", targetMode: "mut-ref" }
    : { type: type.target, sourceMode: "borrow-shared", targetMode: "ref" };
}

function sourceLifetimeFor(lifetime: RustCompilerLifetime, context: ProjectionContext): ProviderTypeExpression {
  switch (lifetime.kind) {
    case "static": return importedSourceType(context, rustTypesModule, rustSourceTypeExportIds.staticLifetime, []);
    case "parameter": return { kind: "type-parameter", name: requireSourceGenericName(lifetime.identity.itemId, context) };
    case "bound": return { kind: "type-parameter", name: requireSourceGenericName(lifetime.parameterId, context) };
    case "elided": return importedSourceType(context, rustTypesModule, rustSourceTypeExportIds.life, []);
  }
}

function sourceConstFor(expression: RustCompilerConstExpression, context: ProjectionContext): ProviderTypeExpression {
  switch (expression.kind) {
    case "literal": {
      if (typeof expression.value === "bigint") {
        const number = Number(expression.value);
        if (!Number.isSafeInteger(number)) throw new Error("Rust const bigint is outside TypeScript literal range.");
        return { kind: "literal", value: number };
      }
      return { kind: "literal", value: expression.value };
    }
    case "parameter": return {
      kind: "type-parameter",
      name: requireSourceGenericName(expression.identity.itemId, context),
    };
    case "item": throw new Error(`Rust associated const '${expression.identity.itemId}' has no source type argument contract.`);
    case "inferred": throw new Error("Inferred Rust const argument cannot be projected to source.");
    case "unary":
    case "binary": throw new Error("Computed Rust const argument cannot be projected to a TypeScript type literal.");
  }
}

export function sourceTraitFor(trait: RustCompilerTraitReference, context: ProjectionContext, position: "parameter" | "result"): ProviderTypeExpression {
  const path = trait.identity.canonicalPath;
  const standard = context.standardItems.get(canonicalPathKey(path));
  if (standard !== undefined) {
    if (standard.kind !== "trait") {
      throw new Error(`Rust item '${path.join("::")}' was selected as both a type and a trait.`);
    }
    if (standard.sourceAvailability === "unavailable") {
      throw new Error(`Rust standard trait '${path.join("::")}' has no public source contract.`);
    }
    if (standard.sourceStability === "unstable") {
      throw new Error(`Rust unstable standard trait '${path.join("::")}' has no public source contract.`);
    }
    const callableRole = standardRustCallableTraitRole(path);
    if (callableRole !== undefined) {
      const callable = compilerCallableTraitProjection(trait, standard, path);
      if (callable === undefined) {
        throw new Error(
          `Rust callable trait '${path.join("::")}' has no exact source-visible output contract.`,
        );
      }
      return importedSourceType(
        context,
        standard.sourceModuleSpecifier,
        standard.sourceExportName,
        [
          sourceCallableArgumentTupleFor(callable.arguments, context, position),
          sourceTypeFor(callable.output, context, position, true),
        ],
      );
    }
    if (trait.arguments.length < standard.requiredSourceGenericArgumentCount) {
      throw new Error(
        `Rust standard trait '${path.join("::")}' has fewer generic arguments than its required public source arity.`,
      );
    }
    const sourceArgumentCount = Math.min(
      trait.arguments.length,
      standard.sourceGenericArgumentCount,
    );
    return importedSourceType(
      context,
      standard.sourceModuleSpecifier,
      standard.sourceExportName,
      trait.arguments.slice(0, sourceArgumentCount)
        .map((argument) => sourceGenericArgumentFor(argument, context, position)),
    );
  }
  if (path[0] !== context.dependency.crateName) throw new Error(`External Rust trait '${path.join("::")}' has no source provider contract.`);
  const moduleSpecifier = compilerModuleSpecifier(context.dependency.alias, path.slice(1, -1));
  return importedSourceType(context, moduleSpecifier, path[path.length - 1]!,
    trait.arguments.map((argument) => sourceGenericArgumentFor(argument, context, position)));
}

function targetLifetimeFor(lifetime: RustCompilerLifetime, context: ProjectionContext): RustLifetimeRef {
  switch (lifetime.kind) {
    case "static": return rustStaticLifetime;
    case "parameter": return Object.freeze({ kind: "parameter", identity: compilerProjectionIdentity(context, lifetime.identity.itemId), displayName: lifetime.displayName });
    case "bound": return Object.freeze({ kind: "bound", binderId: lifetime.binderId, parameterId: lifetime.parameterId, displayName: lifetime.displayName });
    case "elided": return Object.freeze({ kind: "inferred-region", regionId: `${lifetime.ownerId}:${lifetime.position}` });
  }
}

function targetConstFor(expression: RustCompilerConstExpression, context: ProjectionContext): RustConstExpr {
  switch (expression.kind) {
    case "literal": {
      switch (expression.literalKind) {
        case "boolean":
          return Object.freeze({
            kind: "literal",
            literalKind: "boolean",
            value: expression.value,
          });
        case "integer":
          return Object.freeze({
            kind: "literal",
            literalKind: "integer",
            value: expression.value,
          });
        case "character":
          return Object.freeze({
            kind: "literal",
            literalKind: "character",
            value: expression.value,
          });
      }
    }
    case "parameter": return Object.freeze({
      kind: "parameter",
      identity: compilerProjectionIdentity(context, expression.identity.itemId),
      displayName: expression.displayName,
    });
    case "item": return Object.freeze({
      kind: "item",
      identity: compilerProjectionIdentity(context, expression.identity.itemId),
      displayPath: expression.displayPath,
    });
    case "inferred": return Object.freeze({ kind: "inferred" });
    case "unary": return Object.freeze({ kind: "unary", operator: expression.operator, operand: targetConstFor(expression.operand, context) });
    case "binary": return Object.freeze({ kind: "binary", operator: expression.operator, left: targetConstFor(expression.left, context), right: targetConstFor(expression.right, context) });
  }
}

export function targetTraitFor(trait: RustCompilerTraitReference, context: ProjectionContext, position: "parameter" | "result"): RustTraitRef {
  const standard = context.standardItems.get(canonicalPathKey(trait.identity.canonicalPath));
  if (standard !== undefined && standard.kind !== "trait") {
    throw new Error(`Rust item '${trait.identity.canonicalPath.join("::")}' was selected as both a type and a trait.`);
  }
  if (standard?.sourceAvailability === "unavailable") {
    throw new Error(`Rust standard trait '${trait.identity.canonicalPath.join("::")}' has no public target path.`);
  }
  const builtin = rustBuiltinTraitForCanonicalPath(trait.identity.canonicalPath);
  const callableRole = standardRustCallableTraitRole(trait.identity.canonicalPath);
  const callable = callableRole === undefined || standard === undefined
    ? undefined
    : compilerCallableTraitProjection(trait, standard, trait.identity.canonicalPath);
  return Object.freeze({
    identity: builtin?.identity ?? compilerProjectionIdentity(context, standard?.targetId ?? trait.identity.itemId),
    displayPath: standard?.targetPath ?? (trait.identity.canonicalPath[0] === context.dependency.crateName
      ? Object.freeze([context.dependency.targetCrateName, ...trait.identity.canonicalPath.slice(1)])
      : trait.identity.canonicalPath),
    arguments: Object.freeze((callable === undefined ? trait.arguments : [callable.arguments])
      .map((argument) => targetGenericArgumentFor(argument, context, position))),
    associatedConstraints: Object.freeze(callable === undefined
      ? trait.associatedConstraints.map((constraint) =>
          targetAssociatedConstraintFor(constraint, context, position))
      : [callable.outputConstraint === undefined
          ? Object.freeze({
              kind: "equality" as const,
              item: rustFnOnceOutputIdentity,
              displayName: callableRole!.resultSourceName,
              arguments: Object.freeze([]),
              type: targetTypeFor(callable.output, context, position, true),
            })
          : targetAssociatedConstraintFor(callable.outputConstraint, context, position)]),
  });
}

function compilerCallableTraitProjection(
  trait: RustCompilerTraitReference,
  standard: Extract<import("../model/model.js").RustCompilerStandardItemLocation, { readonly sourceAvailability: "available" }>,
  path: readonly string[],
): {
  readonly arguments: RustCompilerGenericArgument;
  readonly output: RustCompilerType;
  readonly outputConstraint?: Extract<import("../model/model.js").RustCompilerAssociatedConstraint, { readonly kind: "equality" }>;
} | undefined {
  const parenthesizedArguments = trait.arguments.length ===
      standard.sourceGenericArgumentCount + 1 &&
    trait.associatedConstraints.length === 0
    ? trait.arguments
    : undefined;
  const argumentTuple = parenthesizedArguments?.[0];
  const output = parenthesizedArguments?.[1];
  if (parenthesizedArguments !== undefined &&
    standard.sourceGenericArgumentCount === 1 &&
    argumentTuple?.kind === "type" &&
    (argumentTuple.value.kind === "unit" || argumentTuple.value.kind === "tuple") &&
    output?.kind === "type") {
    return Object.freeze({ arguments: argumentTuple, output: output.value });
  }
  const [constraint] = trait.associatedConstraints;
  const [arguments_] = trait.arguments;
  if (standard.sourceGenericArgumentCount === 1 && trait.arguments.length === 1 &&
    arguments_ !== undefined && trait.associatedConstraints.length === 1 &&
    constraint?.kind === "equality" && constraint.arguments.length === 0) {
    return Object.freeze({
      arguments: arguments_,
      output: constraint.type,
      outputConstraint: constraint,
    });
  }
  if (standard.sourceGenericArgumentCount === 1 && trait.arguments.length === 1 &&
    arguments_ !== undefined && trait.associatedConstraints.length === 0) {
    return undefined;
  }
  throw new Error(
    `Rust callable trait '${path.join("::")}' has no exact argument-tuple and output contract.`,
  );
}

function sourceCallableArgumentTupleFor(
  argument: RustCompilerGenericArgument,
  context: ProjectionContext,
  position: "parameter" | "result",
): ProviderTypeExpression {
  if (argument.kind !== "type" ||
    (argument.value.kind !== "unit" && argument.value.kind !== "tuple")) {
    throw new Error("Rust callable trait argument contract is not one canonical tuple type.");
  }
  return {
    kind: "tuple",
    elementTypes: argument.value.kind === "unit"
      ? []
      : argument.value.elements.map((element) => sourceTypeFor(element, context, position, true)),
  };
}

function targetAssociatedConstraintFor(
  constraint: import("../model/model.js").RustCompilerAssociatedConstraint,
  context: ProjectionContext,
  position: "parameter" | "result",
): RustTraitRef["associatedConstraints"][number] {
  return constraint.kind === "equality"
    ? Object.freeze({
        kind: "equality" as const,
        item: compilerProjectionIdentity(context, constraint.item.itemId),
        displayName: constraint.displayName,
        arguments: Object.freeze(constraint.arguments.map((argument) =>
          targetGenericArgumentFor(argument, context, position))),
        type: targetTypeFor(constraint.type, context, position, true),
      })
    : Object.freeze({
        kind: "bounds" as const,
        item: compilerProjectionIdentity(context, constraint.item.itemId),
        displayName: constraint.displayName,
        arguments: Object.freeze(constraint.arguments.map((argument) =>
          targetGenericArgumentFor(argument, context, position))),
        bounds: Object.freeze(constraint.bounds.map((bound) =>
          targetBoundFor(bound, context, position))),
      });
}

export function targetBoundFor(bound: RustCompilerBound, context: ProjectionContext, position: "parameter" | "result"): RustBound {
  switch (bound.kind) {
    case "trait": return Object.freeze({
      kind: "trait",
      ...(bound.binder === undefined ? {} : { binder: targetBinderFor(bound.binder, context) }),
      trait: targetTraitFor(bound.trait, context, position),
      polarity: bound.polarity,
    });
    case "lifetime-outlives": return Object.freeze({ kind: "lifetime-outlives", longer: targetLifetimeFor(bound.longer, context), shorter: targetLifetimeFor(bound.shorter, context) });
    case "type-outlives": return Object.freeze({ kind: "type-outlives", type: targetTypeFor(bound.type, context, position, true), lifetime: targetLifetimeFor(bound.lifetime, context) });
    case "associated-equality": {
      const projection = targetTypeFor(bound.projection, context, position, true);
      if (projection.kind !== "associated-type") throw new Error("Rust associated equality projection lost its kind.");
      return Object.freeze({ kind: "associated-equality", projection, value: targetTypeFor(bound.value, context, position, true) });
    }
    case "precise-capture":
      throw new Error("Rust compiler precise captures must be canonicalized onto their owning opaque type before target projection.");
  }
}

export function targetGenericsFor(
  generics: import("../model/model.js").RustCompilerGenerics,
  context: ProjectionContext,
): RustGenerics {
  const parameters = generics.parameters.map((parameter): RustGenericParameter => {
    if (parameter.kind === "lifetime") {
      return Object.freeze({
        kind: "lifetime",
        identity: targetLifetimeFor(parameter.identity, context),
        bounds: Object.freeze(parameter.bounds.map((bound) => targetLifetimeFor(bound, context))),
      });
    }
    if (parameter.kind === "type") {
      return Object.freeze({
        kind: "type",
        identity: compilerProjectionIdentity(context, parameter.identity.itemId),
        displayName: parameter.displayName,
        bounds: Object.freeze(parameter.bounds.map((bound) => targetBoundFor(bound, context, "parameter"))),
        ...(parameter.defaultType === undefined
          ? {}
          : { defaultType: targetTypeFor(parameter.defaultType, context, "parameter", true) }),
      });
    }
    return Object.freeze({
      kind: "const",
      identity: compilerProjectionIdentity(context, parameter.identity.itemId),
      displayName: parameter.displayName,
      type: targetTypeFor(parameter.type, context, "parameter", true),
      ...(parameter.defaultValue === undefined
        ? {}
        : { defaultValue: targetConstFor(parameter.defaultValue, context) }),
    });
  });
  const wherePredicates = generics.wherePredicates.map((predicate): RustWherePredicate => {
    if (predicate.kind === "lifetime") {
      return Object.freeze({
        kind: "lifetime",
        lifetime: targetLifetimeFor(predicate.lifetime, context),
        outlives: Object.freeze(predicate.outlives.map((lifetime) => targetLifetimeFor(lifetime, context))),
      });
    }
    if (predicate.kind === "equality") {
      const projection = targetTypeFor(predicate.projection, context, "parameter", true);
      if (projection.kind !== "associated-type") {
        throw new Error("Rust generic equality projection lost its associated-type identity.");
      }
      return Object.freeze({
        kind: "equality",
        projection,
        value: targetTypeFor(predicate.value, context, "parameter", true),
      });
    }
    return Object.freeze({
      kind: "type",
      ...(predicate.binder === undefined
        ? {}
        : { binder: targetBinderFor(predicate.binder, context) }),
      type: targetTypeFor(predicate.type, context, "parameter", true),
      bounds: Object.freeze(predicate.bounds.map((bound) => targetBoundFor(bound, context, "parameter"))),
    });
  });
  return Object.freeze({
    parameters: Object.freeze(parameters),
    wherePredicates: Object.freeze(wherePredicates),
  });
}

function requireSourceGenericName(identity: string, context: ProjectionContext): string {
  const name = context.genericNames?.get(identity);
  if (name === undefined) {
    throw new Error(`Rust generic identity '${identity}' has no exact source-visible name.`);
  }
  return name;
}

function targetBinderFor(
  binder: import("../model/model.js").RustCompilerBinder,
  context: ProjectionContext,
): import("../../../target-model/semantics/index.js").RustBinder {
  return Object.freeze({
    id: binder.id,
    lifetimes: Object.freeze(binder.lifetimes.map((parameter) => Object.freeze({
      kind: "lifetime" as const,
      identity: targetLifetimeFor(parameter.identity, context),
      bounds: Object.freeze(parameter.bounds.map((bound) => targetLifetimeFor(bound, context))),
    }))),
  });
}

function compilerAbi(abi: string): import("../../../target-model/semantics/index.js").RustAbi {
  if (rustAbiNames.has(abi)) return abi as import("../../../target-model/semantics/index.js").RustAbi;
  throw new Error(`Rust ABI '${abi}' has no exact target contract.`);
}

const rustAbiNames = new Set([
  "Rust", "C", "C-unwind", "system", "system-unwind", "cdecl", "stdcall", "fastcall",
  "vectorcall", "thiscall", "aapcs", "win64", "sysv64", "efiapi",
]);
