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
  digestText,
  importedSourceType,
  isRustOptionPath,
  isRustStringPath,
  requireCurrentType,
  requireSourceGenericName,
  rustCompilerTypeText,
  standardSourceGenericArguments,
  standardTargetGenericArguments,
  standardTargetGenericDefaults,
  withProjectionGenericParameters,
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
import { rustSourceTypeExportIds } from "../../../source/semantics/identity.js";
import { sourcePrimitiveByRustName } from "./model.js";
import type { ProjectionContext } from "./model.js";
import type {
  ProviderTypeExpression,
  ProviderTypeParameterDeclaration,
} from "@tsonic/tsts";
import type {
  RustCompilerAssociatedConstraint,
  RustCompilerGenericArgument,
  RustCompilerGenericParameter,
  RustCompilerTraitDispatch,
  RustCompilerType,
} from "../model/model.js";
import type {
  RustTargetAssociatedConstraint,
  RustTargetGenericArgument,
  RustTargetTraitRef,
  TargetTypeRef,
} from "../../../target-model/types/model.js";
import type {
  RustProviderGenericParameter,
} from "../../../target-model/operations/model.js";
import { rustLifetimeKey } from "../../../target-model/lifetimes/index.js";
import {
  compilerModuleSpecifierForIdentity,
  requireSourceLifetimeFor,
  requireTargetLifetimes,
  sourceConstFor,
  sourceGenericParameterName,
  sourceLifetimeFor,
  targetConstFor,
  targetLifetimeBinderFor,
  targetLifetimeFor,
  targetPathForIdentity,
  withCompilerLifetimeBinder,
} from "./type-arguments.js";
import { rustCompilerTypeSemanticKey } from "../model/types/substitution.js";

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
    case "generic":
      return {
        kind: "type-parameter",
        name: requireSourceGenericName(type.identity.itemId, context),
      };
    case "self":
      return requireCurrentType(context).sourceType;
    case "tuple":
      return {
        kind: "tuple",
        elementTypes: type.elements.map((element) =>
          sourceTypeFor(element, context, position)),
      };
    case "array":
    case "slice":
      return {
        kind: "array",
        elementType: sourceTypeFor(type.element, context, position),
      };
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
        id: `rust-function-pointer:${digestText(rustCompilerTypeSemanticKey(type))}`,
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
      if (standard !== undefined) {
        const arguments_ = standardSourceGenericArguments(
          type,
          standard,
          context,
          position,
        );
        const localName = context.localStandardTypeNames.get(
          canonicalCompilerTypePathKey(type),
        );
        return importedSourceType(
          context,
          localName === undefined
            ? standard.sourceModuleSpecifier
            : context.owner.moduleSpecifier,
          localName ?? standard.sourceExportName,
          arguments_,
        );
      }
      if (type.crateName !== context.dependency.crateName) {
        throw new Error(
          `External Rust type '${rustCompilerTypeText(type)}' has no imported provider contract.`,
        );
      }
      const moduleSpecifier = compilerModuleSpecifier(
        context.dependency.alias,
        type.modulePath,
      );
      return importedSourceType(
        context,
        moduleSpecifier,
        type.name,
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
    case "generic":
      return {
        kind: "type-parameter",
        name: requireSourceGenericName(type.identity.itemId, context),
      };
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
        const arguments_ = standardTargetGenericArguments(
          type,
          standard,
          context,
          position,
        );
        const genericDefaults = standardTargetGenericDefaults(
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
      const path = type.crateName === context.dependency.crateName
        ? rustPath(context.dependency.targetCrateName, type.modulePath, type.name)
        : type.identity.canonicalPath.join("::");
      recordCarrierPath(context.carrierPaths, id, path);
      const genericArguments = type.genericArguments.map((argument) =>
        targetGenericArgumentFor(argument, context, position, pathResolution));
      return rustNamedTargetType(id, path, genericArguments);
    }
  }
}

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
      return Object.freeze({
        name,
        constraints: Object.freeze([
          sourceTypeFor(parameter.type, selectedContext, "parameter"),
        ]),
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
        type: {
          kind: "type-parameter",
          name: requireSourceGenericName(parameter.identity.itemId, selected),
        },
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
  const moduleSpecifier = standard?.sourceModuleSpecifier ??
    compilerModuleSpecifierForIdentity(trait.identity.canonicalPath, binderContext);
  const exportName = standard?.sourceExportName ??
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
