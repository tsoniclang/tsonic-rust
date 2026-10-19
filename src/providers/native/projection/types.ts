import {
  rustFixedArrayTargetType,
  rustNamedTargetType,
  rustNativeScalarTargetId,
  rustNeverTargetType,
  rustOptionTargetId,
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
  rustUnitTargetType,
} from "../../../target-model/types/index.js";
import {
  canonicalCompilerTypePathKey,
  importedSourceType,
  isRustOptionPath,
  isRustStringPath,
  requireCurrentType,
  requireSourceGenericName,
  rustCompilerTypeText,
  standardSourceGenericArguments,
  targetGenericArgumentsForApplication,
  targetGenericDefaultsForApplication,
} from "./utilities.js";
import {
  compilerAssociatedSourceExportName,
} from "../model/rustdoc-items.js";
import {
  compilerModuleSpecifier,
  compilerTargetTypeId,
  providerFunctionPointerAbi,
  recordCarrierPath,
  rustPath,
} from "./operations.js";
import {
  rustConstPointerExport,
  rustMutPointerExport,
} from "../../../source/extension/source-extension.js";
import { rustTypesModule } from "../../../source/profiles/source-modules.js";
import { rustSourceTypeExportIds } from "../../../source/extension/identity.js";
import { sourcePrimitiveByRustName } from "./model.js";
import type { ProjectionContext } from "./model.js";
import type { ProviderTypeExpression } from "@tsonic/tsts";
import type {
  RustCompilerAssociatedConstraint,
  RustCompilerTraitDispatch,
  RustCompilerType,
} from "../model/model.js";
import type {
  RustTargetAssociatedConstraint,
  RustTargetTraitRef,
  TargetTypeRef,
} from "../../../target-model/types/model.js";
import { isCompilerCallableTrait } from "./callable-generics.js";
import {
  compilerModuleSpecifierForIdentity,
  providerGenericParametersFor,
  requireTargetLifetimes,
  sourceGenericArgumentFor,
  sourceLifetimeFor,
  targetConstFor,
  targetGenericArgumentFor,
  targetLifetimeBinderFor,
  targetLifetimeFor,
  targetPathForIdentity,
  withCompilerLifetimeBinder,
} from "./type-arguments.js";

export function sourceTypeFor(
  type: RustCompilerType,
  context: ProjectionContext,
  position: "parameter" | "result",
): ProviderTypeExpression {
  switch (type.kind) {
    case "unit":
      return { kind: "void" };
    case "primitive": {
      if (type.name === "str") return { kind: "string" };
      if (type.name === "never") return { kind: "never" };
      if (type.name === "char") {
        return importedSourceType(
          context,
          rustTypesModule,
          rustSourceTypeExportIds.scalar,
          [],
        );
      }
      const primitive = sourcePrimitiveByRustName.get(type.name);
      if (primitive === undefined) {
        throw new Error(`Rust primitive '${type.name}' has no source primitive contract.`);
      }
      return { kind: "source-primitive", name: primitive };
    }
    case "generic": {
      const callable = context.callableGenerics?.get(type.identity.itemId);
      if (callable !== undefined) return {
        kind: "function", id: context.allocateFunctionTypeIdentity(),
        parameters: callable.parameters.map((parameter, index) => ({ name: `argument${index}`,
          type: sourceTypeFor(parameter, context, position) })),
        returnType: sourceTypeFor(callable.result, context, position),
      };
      return {
        kind: "type-parameter",
        name: requireSourceGenericName(type.identity.itemId, context),
      };
    }
    case "self":
      return requireCurrentType(context).sourceType;
    case "tuple":
      return {
        kind: "tuple",
        elementTypes: type.elements.map((element) =>
          sourceTypeFor(element, context, position)),
      };
    case "array":
      return {
        kind: "array",
        elementType: sourceTypeFor(type.element, context, position),
      };
    case "slice":
      return importedSourceType(context, rustTypesModule, rustSourceTypeExportIds.slice, [
        sourceTypeFor(type.element, context, position),
      ]);
    case "reference": {
      const lifetime = sourceLifetimeFor(type.lifetime, context);
      return importedSourceType(
        context,
        rustTypesModule,
        type.mutable
          ? rustSourceTypeExportIds.mutableReference
          : rustSourceTypeExportIds.sharedReference,
        [
          sourceTypeFor(type.target, context, position),
          ...(lifetime === undefined ? [] : [lifetime]),
        ],
      );
    }
    case "raw-pointer":
      return importedSourceType(
        context,
        rustTypesModule,
        type.mutable ? rustMutPointerExport : rustConstPointerExport,
        [sourceTypeFor(type.target, context, position)],
      );
    case "function-pointer": {
      if (type.lifetimeBinder === undefined) {
        return importedSourceType(
          context,
          "@tsonic/core/types.js",
          "FunctionPointer",
          [
            {
              kind: "tuple",
              elementTypes: type.parameters.map((parameter) =>
                sourceTypeFor(parameter, context, position)),
            },
            sourceTypeFor(type.result, context, position),
          ],
        );
      }
      const binderContext = withCompilerLifetimeBinder(context, type.lifetimeBinder);
      const typeParameters = providerGenericParametersFor(
        type.lifetimeBinder?.parameters ?? [],
        binderContext,
      );
      return {
        kind: "function",
        id: context.allocateFunctionTypeIdentity(),
        parameters: type.parameters.map((parameter, index) => ({
          name: `argument${index}`,
          type: sourceTypeFor(parameter, binderContext, position),
        })),
        returnType: sourceTypeFor(type.result, binderContext, position),
        ...(typeParameters.length === 0 ? {} : { typeParameters }),
      };
    }
    case "trait-object": {
      const traits = [type.principal, ...type.autoTraits].map((trait) =>
        sourceTraitFor(trait, context, position));
      const lifetime = sourceLifetimeFor(type.lifetime, context);
      return importedSourceType(
        context,
        rustTypesModule,
        rustSourceTypeExportIds.dynamicTrait,
        [
          traits.length === 1
            ? traits[0]!
            : { kind: "intersection", types: traits },
          ...(lifetime === undefined ? [] : [lifetime]),
        ],
      );
    }
    case "opaque": {
      const bounds = type.bounds.map((bound) =>
        sourceTraitFor(bound, context, position));
      if (bounds.length === 0) {
        throw new Error("Rust opaque type has no exact principal source bound.");
      }
      const captures = type.captures.map((capture) =>
        sourceGenericArgumentFor(capture, context, position));
      return importedSourceType(
        context,
        rustTypesModule,
        rustSourceTypeExportIds.opaqueType,
        [
          bounds.length === 1
            ? bounds[0]!
            : { kind: "intersection", types: bounds },
          importedSourceType(
            context,
            rustTypesModule,
            rustSourceTypeExportIds.captureSet,
            [{ kind: "tuple", elementTypes: captures }],
          ),
        ],
      );
    }
    case "associated-type":
      if (type.name === "Output" && type.genericArguments.length === 0 && isCompilerCallableTrait(type.trait)) {
        return { kind: "source-global", name: "ReturnType", typeArguments: [{
          kind: "source-global", name: "Extract", typeArguments: [sourceTypeFor(type.owner, context, position), {
            kind: "function", id: context.allocateFunctionTypeIdentity(),
            parameters: [{ name: "arguments_", rest: true, type: { kind: "array", elementType: { kind: "never" } } }],
            returnType: { kind: "unknown" },
          }],
        }] };
      }
      return sourceAssociatedTypeFor(type, context, position);
    case "path": {
      if (isRustStringPath(type)) return { kind: "string" };
      if (isRustOptionPath(type)) {
        const argument = type.genericArguments[0];
        if (argument?.kind !== "type") {
          throw new Error("Rust Option must carry exactly one source type argument.");
        }
        return {
          kind: "union",
          types: [
            sourceTypeFor(argument.type, context, position),
            { kind: "undefined" },
          ],
        };
      }
      const standard = context.standardTypes.get(
        canonicalCompilerTypePathKey(type),
      );
      const local = context.localTypeLocations.get(canonicalCompilerTypePathKey(type));
      if (standard !== undefined) {
        const arguments_ = standardSourceGenericArguments(
          type,
          standard,
          context,
          position,
        );
        return importedSourceType(
          context,
          local === undefined
            ? standard.sourceModuleSpecifier
            : context.owner.moduleSpecifier,
          local?.sourceExportName ?? standard.sourceExportName,
          arguments_,
        );
      }
      if (type.crateName !== context.dependency.crateName) {
        throw new Error(
          `External Rust type '${rustCompilerTypeText(type)}' has no imported provider contract.`,
        );
      }
      const moduleSpecifier = local === undefined
        ? compilerModuleSpecifier(context.dependency.alias, type.modulePath)
        : context.owner.moduleSpecifier;
      return importedSourceType(
        context,
        moduleSpecifier,
        local?.sourceExportName ?? type.name,
        type.genericArguments.map((argument) =>
          sourceGenericArgumentFor(argument, context, position)),
      );
    }
  }
}

export function targetTypeFor(
  type: RustCompilerType,
  context: ProjectionContext,
  position: "parameter" | "result",
  nested = false,
  pathResolution: "source-visible" | "target-default" = "source-visible",
): TargetTypeRef {
  switch (type.kind) {
    case "unit":
      return rustUnitTargetType();
    case "primitive": {
      if (type.name === "str") return rustStringTargetType();
      if (type.name === "never") return rustNeverTargetType();
      if (type.name === "char") {
        recordCarrierPath(context.carrierPaths, rustNativeScalarTargetId, "char");
        return { kind: "target-named", id: rustNativeScalarTargetId };
      }
      const primitive = sourcePrimitiveByRustName.get(type.name);
      if (primitive === undefined) {
        throw new Error(`Rust primitive '${type.name}' has no target carrier contract.`);
      }
      return rustSourcePrimitiveTargetType(primitive);
    }
    case "generic": {
      const callable = context.callableGenerics?.get(type.identity.itemId);
      if (callable !== undefined) return { kind: "closure", callTrait: callable.callTrait,
        args: callable.parameters.map(parameter => targetTypeFor(parameter, context, position)),
        result: targetTypeFor(callable.result, context, position) };
      return {
        kind: "type-parameter",
        identity: type.identity.itemId,
        name: requireSourceGenericName(type.identity.itemId, context),
      };
    }
    case "self":
      return requireCurrentType(context).carrier;
    case "tuple":
      return {
        kind: "tuple",
        elements: type.elements.map((element) =>
          targetTypeFor(element, context, position, true, pathResolution)),
      };
    case "array":
      return rustFixedArrayTargetType(
        targetTypeFor(type.element, context, position, true, pathResolution),
        targetConstFor(type.length, context),
      );
    case "slice":
      return nested
        ? {
            kind: "slice",
            element: targetTypeFor(type.element, context, position, true, pathResolution),
          }
        : {
            kind: "array",
            element: targetTypeFor(type.element, context, position, true, pathResolution),
          };
    case "reference": {
      const lifetime = targetLifetimeFor(type.lifetime, context);
      return {
        kind: "reference",
        referent: targetTypeFor(type.target, context, position, true, pathResolution),
        mutable: type.mutable,
        ...(lifetime === undefined ? {} : { lifetime }),
      };
    }
    case "raw-pointer":
      return {
        kind: "pointer",
        pointee: targetTypeFor(type.target, context, position, true, pathResolution),
        mutability: type.mutable ? "mut" : "const",
      };
    case "function-pointer": {
      const binderContext = withCompilerLifetimeBinder(context, type.lifetimeBinder);
      return {
        kind: "function-pointer",
        args: type.parameters.map((parameter) =>
          targetTypeFor(parameter, binderContext, position, true, pathResolution)),
        result: targetTypeFor(type.result, binderContext, position, true, pathResolution),
        ...(type.lifetimeBinder === undefined
          ? {}
          : { lifetimeBinder: targetLifetimeBinderFor(type.lifetimeBinder, binderContext) }),
        abi: [providerFunctionPointerAbi(type.abi)],
        ...(type.unsafe ? { isUnsafe: true } : {}),
      };
    }
    case "trait-object": {
      const lifetime = targetLifetimeFor(type.lifetime, context);
      return {
        kind: "trait-object",
        principal: targetTraitFor(type.principal, context, position, pathResolution),
        autoTraits: type.autoTraits.map((trait) =>
          targetTraitFor(trait, context, position, pathResolution)),
        ...(lifetime === undefined ? {} : { lifetime }),
      };
    }
    case "opaque": {
      const outlives = requireTargetLifetimes(type.outlives, context, "opaque outlives");
      const captures = type.captures.map((capture) =>
        targetGenericArgumentFor(capture, context, position, pathResolution));
      return {
        kind: "impl-trait",
        id: type.identity.itemId,
        bounds: type.bounds.map((bound) =>
          targetTraitFor(bound, context, position, pathResolution)),
        outlives,
        captures,
      };
    }
    case "associated-type":
      return {
        kind: "associated-type",
        owner: targetTypeFor(type.owner, context, position, true, pathResolution),
        trait: targetTraitFor(type.trait, context, position, pathResolution),
        name: type.name,
        ...(type.genericArguments.length === 0
          ? {}
          : {
              genericArguments: type.genericArguments.map((argument) =>
                targetGenericArgumentFor(argument, context, position, pathResolution)),
            }),
      };
    case "path": {
      if (isRustStringPath(type)) return rustStringTargetType();
      if (isRustOptionPath(type)) {
        const argument = type.genericArguments[0];
        if (argument?.kind !== "type") {
          throw new Error("Rust Option must carry exactly one target type argument.");
        }
        return {
          kind: "target-named",
          id: rustOptionTargetId,
          genericArguments: [{
            kind: "type",
            type: targetTypeFor(argument.type, context, position, true, pathResolution),
          }],
        };
      }
      const standard = context.standardTypes.get(
        canonicalCompilerTypePathKey(type),
      );
      if (standard !== undefined) {
        const arguments_ = targetGenericArgumentsForApplication(
          type,
          standard,
          context,
          position,
        );
        const genericDefaults = targetGenericDefaultsForApplication(
          type,
          standard,
          context,
          position,
        );
        const path = standard.targetPath.join("::");
        recordCarrierPath(context.carrierPaths, standard.targetId, path);
        return rustNamedTargetType(
          standard.targetId,
          path,
          arguments_,
          genericDefaults,
        );
      }
      if (type.crateName !== context.dependency.crateName && pathResolution === "source-visible") {
        throw new Error(
          `External Rust type '${rustCompilerTypeText(type)}' has no target carrier contract.`,
        );
      }
      const id = compilerTargetTypeId(
        context.dependency,
        type.identity.canonicalPath,
      );
      const local = context.localTypeLocations.get(canonicalCompilerTypePathKey(type));
      const path = local?.targetPath.join("::") ??
        (type.crateName === context.dependency.crateName
          ? rustPath(context.dependency.targetCrateName, type.modulePath, type.name)
          : type.identity.canonicalPath.join("::"));
      recordCarrierPath(context.carrierPaths, id, path);
      const genericArguments = local === undefined
        ? type.genericArguments.map((argument) => targetGenericArgumentFor(argument, context, position, pathResolution))
        : targetGenericArgumentsForApplication(type, local, context, position);
      const genericDefaults = local === undefined ? [] : targetGenericDefaultsForApplication(type, local, context, position);
      return rustNamedTargetType(id, path, genericArguments, genericDefaults);
    }
  }
}
export function parameterPassing(type: RustCompilerType): {
  readonly type: RustCompilerType;
  readonly sourceMode: "by-value" | "borrow-shared" | "borrow-mut";
  readonly targetMode: "value" | "ref" | "mut-ref";
} {
  if (type.kind !== "reference") {
    return { type, sourceMode: "by-value", targetMode: "value" };
  }
  return type.mutable
    ? { type: type.target, sourceMode: "borrow-mut", targetMode: "mut-ref" }
    : { type: type.target, sourceMode: "borrow-shared", targetMode: "ref" };
}

function sourceAssociatedTypeFor(
  type: Extract<RustCompilerType, { readonly kind: "associated-type" }>,
  context: ProjectionContext,
  position: "parameter" | "result",
): ProviderTypeExpression {
  const canonicalPath = type.trait.identity.canonicalPath;
  const standard = context.standardTypes.get(
    canonicalPath.join("\0"),
  );
  const moduleSpecifier = standard?.sourceModuleSpecifier ??
    compilerModuleSpecifierForIdentity(canonicalPath, context);
  return importedSourceType(
    context,
    moduleSpecifier,
    compilerAssociatedSourceExportName(type.identity.itemId, type.name),
    [
      ...type.trait.genericArguments.map((argument) =>
        sourceGenericArgumentFor(argument, context, position)),
      sourceTypeFor(type.owner, context, position),
      ...type.genericArguments.map((argument) =>
        sourceGenericArgumentFor(argument, context, position)),
    ],
  );
}

export function sourceTraitFor(
  trait: RustCompilerTraitDispatch,
  context: ProjectionContext,
  position: "parameter" | "result",
): ProviderTypeExpression {
  const binderContext = withCompilerLifetimeBinder(context, trait.lifetimeBinder);
  const standard = binderContext.standardTypes.get(
    trait.identity.canonicalPath.join("\0"),
  );
  const local = binderContext.localTypeLocations.get(trait.identity.canonicalPath.join("\0"));
  const moduleSpecifier = standard?.sourceModuleSpecifier ??
    (local === undefined
      ? compilerModuleSpecifierForIdentity(trait.identity.canonicalPath, binderContext)
      : binderContext.owner.moduleSpecifier);
  const exportName = standard?.sourceExportName ?? local?.sourceExportName ??
    trait.identity.canonicalPath[trait.identity.canonicalPath.length - 1];
  if (exportName === undefined) {
    throw new Error(`Rust trait '${trait.path}' has no source export name.`);
  }
  return importedSourceType(
    binderContext,
    moduleSpecifier,
    exportName,
    trait.genericArguments.map((argument) =>
      sourceGenericArgumentFor(argument, binderContext, position)),
  );
}

export function targetTraitFor(
  trait: RustCompilerTraitDispatch,
  context: ProjectionContext,
  position: "parameter" | "result",
  pathResolution: "source-visible" | "target-default" = "source-visible",
): RustTargetTraitRef {
  const binderContext = withCompilerLifetimeBinder(context, trait.lifetimeBinder);
  const standard = binderContext.standardTypes.get(
    trait.identity.canonicalPath.join("\0"),
  );
  const id = standard?.targetId ??
    compilerTargetTypeId(context.dependency, trait.identity.canonicalPath);
  const path = standard?.targetPath.join("::") ??
    (pathResolution === "target-default" &&
        trait.identity.canonicalPath[0] !== context.dependency.crateName
      ? trait.identity.canonicalPath.join("::")
      : targetPathForIdentity(trait.identity.canonicalPath, context));
  recordCarrierPath(context.carrierPaths, id, path);
  return {
    kind: "trait-ref",
    id,
    path,
    genericArguments: trait.genericArguments.map((argument) =>
      targetGenericArgumentFor(argument, binderContext, position, pathResolution)),
    associatedConstraints: trait.associatedConstraints.map((constraint) =>
      targetAssociatedConstraintFor(constraint, binderContext, position, pathResolution)),
    ...(trait.lifetimeBinder === undefined
      ? {}
      : {
          lifetimeBinder: targetLifetimeBinderFor(
            trait.lifetimeBinder,
            binderContext,
          ),
        }),
  };
}

function targetAssociatedConstraintFor(
  constraint: RustCompilerAssociatedConstraint,
  context: ProjectionContext,
  position: "parameter" | "result",
  pathResolution: "source-visible" | "target-default",
): RustTargetAssociatedConstraint {
  const genericArguments = constraint.genericArguments.map((argument) =>
    targetGenericArgumentFor(argument, context, position, pathResolution));
  return constraint.kind === "equality"
    ? {
        kind: "equality",
        identity: constraint.identity.itemId,
        name: constraint.name,
        genericArguments,
        type: targetTypeFor(constraint.type, context, position, true, pathResolution),
      }
    : {
        kind: "bounds",
        identity: constraint.identity.itemId,
        name: constraint.name,
        genericArguments,
        traits: constraint.traits.map((trait) =>
          targetTraitFor(trait, context, position, pathResolution)),
        outlives: requireTargetLifetimes(
          constraint.outlives,
          context,
          `associated constraint '${constraint.name}'`,
        ),
      };
}
