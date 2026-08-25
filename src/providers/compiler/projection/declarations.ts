import {
  canonicalPathKey,
  compareText,
  genericNameMap,
  genericParameterIdentity,
  requireCurrentType,
  rustCompilerTypeNamesCurrentType,
  sourceVisibleGenericParameters,
  withDefaultTypeBindings,
} from "./utilities.js";
import {
  compilerExportId,
  compilerTargetTypeId,
  materializeImports,
  operationRow,
  projectCompilerTraitContract,
  recordCarrierPath,
  recordCarrierTraits,
  typeRequirements,
} from "./operations.js";
import { compilerAssociatedSourceExportName } from "../model/rustdoc-items.js";
import {
  compilerFunctionResult,
  projectFunction,
  providerSourceGenericBindings,
  providerTypeParameters,
  selectUnambiguousMembers,
  sourceGenericParameterArgument,
  targetGenericParameterArgument,
} from "./functions.js";
import {
  compilerProjectionIdentity,
  sourceTraitFor,
  sourceTypeFor,
  targetGenericsFor,
  targetTraitFor,
  targetTypeFor,
} from "./types.js";
import {
  rustPathTargetType,
  rustReferenceTargetType,
  rustTypeParameterTargetType,
  rustUnitTargetType,
} from "../../../target-model/types/index.js";
import { rustStaticLifetime } from "../../../target-model/semantics/index.js";
import { rustStaticValueCanBeCopied } from "../model/rustdoc-types.js";
import { rustSourceTypeExportIds, rustTypesModule } from "../../../source/semantics/identity.js";
import type {
  ProviderExportDeclaration,
  ProviderMemberDeclaration,
  ProviderParameterDeclaration,
  ProviderPropertyName,
  ProviderSignatureDeclaration,
  ProviderTypeExpression,
  ProviderTypeParameterDeclaration,
} from "@tsonic/tsts";
import type {
  RustCompilerAssociatedConstant,
  RustCompilerAssociatedType,
  RustCompilerEnumVariant,
  RustCompilerExport,
  RustCompilerField,
  RustCompilerFunction,
  RustCompilerGenericParameter,
  RustCompilerGenerics,
  RustCompilerItemIdentity,
  RustCompilerModuleModel,
  RustCompilerType,
} from "../model/model.js";
import type {
  ProjectionContext,
  ProjectionOwner,
  RustCompilerProviderProjection,
} from "./model.js";
import type {
  RustProviderOperationDefinition,
  RustProviderTypeDefinition,
} from "../../packages/model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { standardRustTypeSemanticRoles } from "./standard-library-policy.js";
import { projectStandardSliceIndexing } from "./indexing.js";

export function projectRustCompilerModule(
  module: RustCompilerModuleModel,
  owner: ProjectionOwner,
): RustCompilerProviderProjection {
  if (module.unsupportedExports.length > 0) {
    throw new Error(module.unsupportedExports.map((entry) => `${entry.name}: ${entry.reason}`).join("; "));
  }
  const imports = new Map<string, Set<string>>();
  const declarations: ProviderExportDeclaration[] = [];
  const operations: RustProviderOperationDefinition[] = [];
  const types: RustProviderTypeDefinition[] = [];
  const carrierPaths = new Map<string, string>();
  const carrierTraits = new Map<string, import("../../../target-model/types/model.js").RustNamedTypeTraitContract>();
  const standardItems = new Map(module.standardItemLocations.map((location) => [
    canonicalPathKey(location.canonicalPath),
    location,
  ]));
  const localStandardTypeNames = new Map(module.exports
    .filter(isTypeExport)
    .map((exported) => [canonicalPathKey(exported.identity.canonicalPath), exported.name]));
  for (const exported of module.exports) {
    const projected = projectExport(exported, {
      dependency: module.dependency,
      modulePath: module.modulePath,
      owner,
      imports,
      carrierPaths,
      carrierTraits,
      standardItems,
      localStandardTypeNames,
    });
    declarations.push(projected.declaration);
    declarations.push(...(projected.additionalDeclarations ?? []));
    operations.push(...projected.operations);
    if (projected.type !== undefined) types.push(projected.type);
    types.push(...(projected.additionalTypes ?? []));
  }
  const importDeclarations = materializeImports(imports, owner.moduleSpecifier);
  const providerModule = Object.freeze({
    moduleSpecifier: owner.moduleSpecifier,
    providerModuleId: owner.providerModuleId,
    ...(importDeclarations.length === 0 ? {} : { imports: importDeclarations }),
    exports: Object.freeze(declarations),
  });
  return Object.freeze({
    declarationModel: providerModule,
    module: providerModule,
    operations: Object.freeze(operations),
    types: Object.freeze(types),
    carrierPaths,
    carrierTraits,
  });
}

function projectExport(
  exported: RustCompilerExport,
  context: ProjectionContext,
): {
  readonly declaration: ProviderExportDeclaration;
  readonly operations: readonly RustProviderOperationDefinition[];
  readonly type?: RustProviderTypeDefinition;
  readonly additionalDeclarations?: readonly ProviderExportDeclaration[];
  readonly additionalTypes?: readonly RustProviderTypeDefinition[];
} {
  const exportId = compilerExportId(context.dependency, context.modulePath, exported.name);
  if (exported.kind === "constant" || exported.kind === "static") {
    return projectValueExport(exported, context, exportId);
  }
  if (exported.kind === "function") {
    const projected = projectFunction(exported.function, context, exportId, false, exported.targetPath);
    return {
      declaration: Object.freeze({
        id: exportId,
        name: exported.name,
        exportName: exported.name,
        kind: "function",
        signatures: Object.freeze([projected.signature]),
      }),
      operations: Object.freeze([projected.operation]),
    };
  }
  if (exported.kind === "type-alias") return projectTypeAlias(exported, context, exportId);
  return projectNominalExport(exported, context, exportId);
}

function projectValueExport(
  exported: Extract<RustCompilerExport, { readonly kind: "constant" | "static" }>,
  context: ProjectionContext,
  exportId: string,
): {
  readonly declaration: ProviderExportDeclaration;
  readonly operations: readonly RustProviderOperationDefinition[];
} {
  const copied = exported.kind === "constant" || rustStaticValueCanBeCopied(exported.type);
  const sourceValueType = sourceTypeFor(exported.type, context, "result");
  const targetValueType = targetTypeFor(exported.type, context, "result");
  const mutable = exported.kind === "static" && exported.mutable;
  const sourceType = copied ? sourceValueType : sourceStaticReferenceType(sourceValueType, mutable);
  const targetCarrier = copied
    ? targetValueType
    : rustReferenceTargetType(targetValueType, mutable, rustStaticLifetime);
  const target = exported.kind === "static" && !copied
    ? { form: "static-reference" as const, path: exported.targetPath.join("::"), mutable }
    : { form: "path" as const, path: exported.targetPath.join("::") };
  return {
    declaration: Object.freeze({
      id: exportId,
      name: exported.name,
      exportName: exported.name,
      kind: "value",
      type: sourceType,
    }),
    operations: Object.freeze([operationRow({
      exportId,
      operationKind: "property",
      target,
      resultCarrier: targetCarrier,
      ...(exported.kind === "static" && (exported.safety === "unsafe" || exported.mutable)
        ? { isUnsafe: true }
        : {}),
    })]),
  };
}

function sourceStaticReferenceType(
  target: ProviderTypeExpression,
  mutable: boolean,
): ProviderTypeExpression {
  return {
    kind: "provider-ref",
    moduleSpecifier: rustTypesModule,
    exportName: mutable
      ? rustSourceTypeExportIds.mutableReference
      : rustSourceTypeExportIds.sharedReference,
    typeArguments: [
      target,
      {
        kind: "provider-ref",
        moduleSpecifier: rustTypesModule,
        exportName: rustSourceTypeExportIds.staticLifetime,
      },
    ],
  };
}

function projectTypeAlias(
  exported: Extract<RustCompilerExport, { readonly kind: "type-alias" }>,
  context: ProjectionContext,
  exportId: string,
): {
  readonly declaration: ProviderExportDeclaration;
  readonly operations: readonly RustProviderOperationDefinition[];
  readonly type: RustProviderTypeDefinition;
} {
  const genericNames = genericNameMap(exported.generics.parameters);
  const genericContext: ProjectionContext = {
    ...context,
    genericNames,
    genericParameters: genericParameterProjectionMap(exported.generics.parameters),
  };
  const genericParameters = sourceVisibleGenericParameters(exported.generics, genericContext);
  const typeContext: ProjectionContext = withDefaultTypeBindings(
    genericContext,
    exported.generics,
    genericParameters,
  );
  const sourceParameters = providerTypeParameters(genericParameters, typeContext);
  const sourceNames = sourceParameters.map((parameter) => parameter.name);
  return {
    declaration: Object.freeze({
      id: exportId,
      name: exported.name,
      exportName: exported.name,
      kind: "type",
      type: sourceTypeFor(exported.type, typeContext, "result"),
      ...(sourceParameters.length === 0 ? {} : { typeParameters: sourceParameters }),
    }),
    operations: Object.freeze([]),
    type: Object.freeze({
      exportId,
      targetDeclarationKind: "type-alias",
      sourceGenericBindings: providerSourceGenericBindings(
        genericParameters,
        typeContext,
      ),
      targetGenerics: targetGenericsFor(exported.generics, typeContext),
      targetCarrier: targetTypeFor(exported.type, typeContext, "result"),
      ...typeRequirements(exported.generics, sourceNames, typeContext),
    }),
  };
}

function projectNominalExport(
  exported: Exclude<RustCompilerExport, { readonly kind: "constant" | "static" | "function" | "type-alias" }>,
  context: ProjectionContext,
  exportId: string,
): {
  readonly declaration: ProviderExportDeclaration;
  readonly operations: readonly RustProviderOperationDefinition[];
  readonly type: RustProviderTypeDefinition;
  readonly additionalDeclarations: readonly ProviderExportDeclaration[];
  readonly additionalTypes: readonly RustProviderTypeDefinition[];
} {
  if (exported.unsupportedMembers.length > 0) {
    throw new Error(exported.unsupportedMembers.map((member) =>
      `${exported.name}.${member.name}: ${member.reason}`).join("; "));
  }
  const genericNames = genericNameMap(exported.generics.parameters);
  const visibilityContext: ProjectionContext = {
    ...context,
    genericNames,
    genericParameters: genericParameterProjectionMap(exported.generics.parameters),
  };
  const genericParameters = sourceVisibleGenericParameters(exported.generics, visibilityContext);
  const genericContext: ProjectionContext = withDefaultTypeBindings(
    visibilityContext,
    exported.generics,
    genericParameters,
  );
  const semanticRoles = standardRustTypeSemanticRoles(exported.identity.canonicalPath);
  const callableRole = semanticRoles.find((role) => role.kind === "callable-trait");
  const projectedSourceParameters = providerTypeParameters(genericParameters, genericContext);
  const callableArgumentParameter = callableRole === undefined
    ? undefined
    : projectedSourceParameters.find((parameter) =>
        parameter.name === callableRole.parameterTupleSourceName);
  if (callableRole !== undefined && callableArgumentParameter === undefined) {
    throw new Error(`Rust callable trait '${exported.name}' has no exact source argument-tuple parameter.`);
  }
  if (callableRole !== undefined && projectedSourceParameters.some((parameter) =>
    parameter.name === callableRole.resultSourceName)) {
    throw new Error(`Rust callable trait '${exported.name}' conflicts with its source result parameter.`);
  }
  const sourceParameters = Object.freeze([
    ...projectedSourceParameters.map((parameter) =>
      parameter !== callableArgumentParameter
        ? parameter
        : Object.freeze({
            ...parameter,
            constraints: Object.freeze([Object.freeze({
              kind: "array" as const,
              elementType: Object.freeze({ kind: "unknown" as const }),
            })]),
          })),
    ...(callableRole === undefined
      ? []
      : [Object.freeze({ name: callableRole.resultSourceName })]),
  ]);
  const sourceParameterNames = sourceParameters.map((parameter) => parameter.name);
  const standardLocation = context.standardItems.get(canonicalPathKey(exported.identity.canonicalPath));
  if (standardLocation?.kind === "trait" && exported.kind !== "trait") {
    throw new Error(`Rust standard item '${exported.name}' changed semantic kind during projection.`);
  }
  if (standardLocation?.sourceAvailability === "unavailable") {
    throw new Error(`Rust standard item '${exported.name}' has no public source or target path.`);
  }
  const selectedTargetPath = standardLocation?.targetPath ?? exported.targetPath;
  const targetTypeId = standardLocation?.targetId ??
    compilerTargetTypeId(context.dependency, exported.identity.canonicalPath);
  const sourceArguments = [
    ...genericParameters.map((parameter) =>
      sourceGenericParameterArgument(parameter, genericContext)),
    ...(callableRole === undefined
      ? []
      : [Object.freeze({
          kind: "type-parameter" as const,
          name: callableRole.resultSourceName,
        })]),
  ];
  const targetArguments = genericParameters.map((parameter) =>
    targetGenericParameterArgument(parameter, genericContext));
  recordCarrierPath(context.carrierPaths, targetTypeId, selectedTargetPath.join("::"));
  const typeCarrier = rustPathTargetType({
    identity: compilerProjectionIdentity(context, targetTypeId),
    displayPath: selectedTargetPath,
    arguments: targetArguments,
  });
  const implicitSelf = exported.kind === "trait"
    ? implicitTraitSelfParameter(exported.identity)
    : undefined;
  const completeTypeGenerics = implicitSelf === undefined
    ? exported.generics
    : mergeGenerics(exported.generics, Object.freeze({
        parameters: Object.freeze([implicitSelf]),
        wherePredicates: Object.freeze([]),
      }));
  const operationSelfCarrier = implicitSelf === undefined
    ? typeCarrier
    : rustTypeParameterTargetType(
        compilerProjectionIdentity(genericContext, implicitSelf.identity.itemId),
      "Self",
    );
  const sourceType: ProviderTypeExpression = {
    kind: "provider-ref",
    moduleSpecifier: context.owner.moduleSpecifier,
    exportName: exported.name,
    ...(sourceArguments.length === 0 ? {} : { typeArguments: sourceArguments }),
  };
  const typeContext: ProjectionContext = {
    ...genericContext,
    currentType: {
      exportId,
      identity: exported.identity,
      name: exported.name,
      carrier: operationSelfCarrier,
      sourceType,
      genericParameters,
      generics: completeTypeGenerics,
      typeParameters: sourceParameterNames,
      canonicalPath: exported.identity.canonicalPath,
      targetPath: selectedTargetPath,
      ...(implicitSelf === undefined
        ? {}
        : {
            targetInferenceParameters: Object.freeze([
              Object.freeze({ kind: "type" as const, value: operationSelfCarrier }),
            ]),
          }),
    },
  };
  recordCarrierTraits(
    context.carrierTraits,
    targetTypeId,
    projectCompilerTraitContract(exported.traits, typeContext),
  );
  const members: ProviderMemberDeclaration[] = [];
  const operations: RustProviderOperationDefinition[] = [];
  if (exported.kind === "struct" || exported.kind === "union") {
    projectFields(
      exported.fields,
      exported.kind === "union",
      typeContext,
      exportId,
      typeCarrier,
      exported.generics,
      members,
      operations,
    );
  }
  if (exported.kind === "enum" && exported.variantsComplete) {
    projectEnumVariants(
      exported.variants,
      typeContext,
      exportId,
      typeCarrier,
      sourceType,
      exported.generics,
      members,
      operations,
    );
  }
  const projectedMethods = projectTypeMethods(
    exported.methods,
    exported.kind,
    typeContext,
    exportId,
    selectedTargetPath,
  );
  members.push(...projectedMethods.members);
  operations.push(...projectedMethods.operations);
  const projectedIndexing = projectStandardSliceIndexing(
    exported.methods,
    typeContext,
    exportId,
  );
  members.push(...projectedIndexing.members);
  operations.push(...projectedIndexing.operations);
  const projectedConstants = projectAssociatedConstants(
    exported.associatedConstants,
    typeContext,
    exportId,
    selectedTargetPath,
    exported.generics,
  );
  members.push(...projectedConstants.members);
  operations.push(...projectedConstants.operations);
  const unambiguous = selectUnambiguousMembers(members, operations);
  const associatedProjectionExports = exported.kind === "trait"
    ? projectAssociatedTypeExports(exported, typeContext, selectedTargetPath)
    : { declarations: Object.freeze([]), types: Object.freeze([]) };
  const nativeEnum = exported.kind === "enum" && exported.variantsComplete &&
    genericParameters.length === 0 &&
    exported.variants.every((variant) => variant.fields.kind === "unit") &&
    exported.methods.length === 0 && exported.associatedConstants.length === 0;
  const projectedTypeRequirements = typeRequirements(
    exported.generics,
    sourceParameterNames,
    typeContext,
  ).typeRequirements;
  const retainedTypeRequirements = callableRole === undefined
    ? projectedTypeRequirements
    : projectedTypeRequirements?.filter((requirement) =>
        requirement.name !== callableRole.parameterTupleSourceName);
  return {
    declaration: Object.freeze({
      id: exportId,
      name: exported.name,
      exportName: exported.name,
      kind: callableRole !== undefined
        ? "type"
        : exported.kind === "trait"
          ? "interface"
          : nativeEnum
            ? "enum"
            : "class",
      ...(sourceParameters.length === 0 ? {} : { typeParameters: sourceParameters }),
      ...(callableRole === undefined
        ? { members: unambiguous.members }
        : {
            type: Object.freeze({
              kind: "function" as const,
              id: `${exportId}::callable-signature`,
              parameters: Object.freeze([Object.freeze({
                name: "arguments",
                type: Object.freeze({
                  kind: "type-parameter" as const,
                  name: callableRole.parameterTupleSourceName,
                }),
                rest: true,
              })]),
              returnType: Object.freeze({
                kind: "type-parameter" as const,
                name: callableRole.resultSourceName,
              }),
            }),
          }),
    }),
    operations: unambiguous.operations,
    additionalDeclarations: associatedProjectionExports.declarations,
    additionalTypes: associatedProjectionExports.types,
    type: Object.freeze({
      exportId,
      targetDeclarationKind: exported.kind,
      ...(exported.kind === "trait"
        ? {
            targetTraitKind: exported.auto ? "auto" as const : "ordinary" as const,
            targetTraitSafety: exported.safety,
            targetTraitRequiresImplementationItems: exported.implementationItemsRequired,
          }
        : {}),
      sourceGenericBindings: Object.freeze([
        ...providerSourceGenericBindings(genericParameters, typeContext),
        ...(callableRole === undefined
          ? []
          : [Object.freeze({
              sourceName: callableRole.resultSourceName,
              target: Object.freeze({
                kind: "semantic-parameter" as const,
                role: "callable-result" as const,
              }),
            })]),
      ]),
      ...(implicitSelf === undefined
        ? {}
        : {
            targetImplicitParameters: Object.freeze([
              Object.freeze({ kind: "type" as const, value: operationSelfCarrier }),
            ]),
          }),
      targetGenerics: targetGenericsFor(
        completeTypeGenerics,
        typeContext,
      ),
      targetCarrier: typeCarrier,
      ...(semanticRoles.length === 0
        ? {}
        : {
            semanticRoles,
          }),
      ...(retainedTypeRequirements === undefined || retainedTypeRequirements.length === 0
        ? {}
        : { typeRequirements: Object.freeze(retainedTypeRequirements) }),
    }),
  };
}

function projectAssociatedTypeExports(
  exported: Extract<RustCompilerExport, { readonly kind: "trait" }>,
  context: ProjectionContext,
  selectedTargetPath: readonly string[],
): {
  readonly declarations: readonly ProviderExportDeclaration[];
  readonly types: readonly RustProviderTypeDefinition[];
} {
  const declarations: ProviderExportDeclaration[] = [];
  const types: RustProviderTypeDefinition[] = [];
  const traitParameters = sourceVisibleGenericParameters(exported.generics, context);
  for (const associated of exported.associatedTypes) {
    const trait: import("../model/model.js").RustCompilerTraitReference = Object.freeze({
      identity: exported.identity,
      displayPath: selectedTargetPath,
      arguments: Object.freeze(traitParameters.map(compilerGenericParameterArgument)),
      associatedConstraints: Object.freeze([]),
    });
    const ownerParameter = associatedOwnerParameter(associated, trait);
    const associatedParameters = sourceVisibleGenericParameters(associated.generics, context);
    const parameters = Object.freeze([
      ...traitParameters,
      ownerParameter,
      ...associatedParameters,
    ]);
    const genericNames = uniqueProjectionGenericNames(parameters);
    const genericContext: ProjectionContext = {
      ...context,
      genericNames,
      genericParameters: new Map([
        ...(context.genericParameters ?? []),
        ...genericParameterProjectionMap(parameters),
      ]),
      genericScopeId: associated.identity.itemId,
    };
    const ownerType: RustCompilerType = Object.freeze({
      kind: "type-parameter",
      identity: ownerParameter.identity,
      displayName: ownerParameter.displayName,
    });
    const ownerCarrier = targetTypeFor(ownerType, genericContext, "parameter", true);
    const sourceOwner: ProviderTypeExpression = {
      kind: "type-parameter",
      name: genericNames.get(ownerParameter.identity.itemId)!,
    };
    const projectionContext: ProjectionContext = {
      ...genericContext,
      currentType: {
        ...requireCurrentType(context),
        carrier: ownerCarrier,
        sourceType: sourceOwner,
      },
    };
    const projection: Extract<RustCompilerType, { readonly kind: "associated-type" }> = Object.freeze({
      kind: "associated-type",
      owner: ownerType,
      trait,
      item: associated.identity,
      displayName: associated.name,
      arguments: Object.freeze(associatedParameters.map(compilerGenericParameterArgument)),
    });
    const exportName = compilerAssociatedSourceExportName(
      associated.identity.itemId,
      associated.name,
    );
    const exportId = `${requireCurrentType(context).exportId}::associated-type:${associated.identity.itemId}`;
    const combinedGenerics = mergeGenerics(
      Object.freeze({
        parameters: Object.freeze([...traitParameters, ownerParameter]),
        wherePredicates: exported.generics.wherePredicates,
      }),
      Object.freeze({
        parameters: Object.freeze(associatedParameters),
        wherePredicates: Object.freeze([
          ...associated.generics.wherePredicates,
          ...(associated.bounds.length === 0
            ? []
            : [Object.freeze({
                kind: "type" as const,
                type: projection,
                bounds: associated.bounds,
              })]),
        ]),
      }),
    );
    const sourceParameters = providerTypeParameters(parameters, projectionContext);
    const sourceNames = sourceParameters.map((parameter) => parameter.name);
    const heritage = associated.bounds.flatMap((bound) =>
      bound.kind === "trait" && bound.polarity === "required"
        ? [Object.freeze({
            kind: "extends" as const,
            type: sourceTraitFor(bound.trait, projectionContext, "result"),
          })]
        : []);
    declarations.push(Object.freeze({
      id: exportId,
      name: exportName,
      exportName,
      kind: "interface",
      typeParameters: sourceParameters,
      ...(heritage.length === 0 ? {} : { heritage: Object.freeze(heritage) }),
      members: Object.freeze([Object.freeze({
        id: `${exportId}::identity`,
        name: `$rustAssociatedIdentity_${compilerAssociatedSourceExportName(
          associated.identity.itemId,
          associated.name,
        ).slice(-12)}`,
        kind: "property" as const,
        readonly: true,
        type: Object.freeze({ kind: "never" as const }),
      })]),
    }));
    types.push(Object.freeze({
      exportId,
      targetDeclarationKind: "type-alias",
      sourceGenericBindings: providerSourceGenericBindings(parameters, projectionContext),
      targetGenerics: targetGenericsFor(combinedGenerics, projectionContext),
      targetCarrier: targetTypeFor(projection, projectionContext, "result", true),
      ...typeRequirements(combinedGenerics, sourceNames, projectionContext),
    }));
  }
  return Object.freeze({
    declarations: Object.freeze(declarations),
    types: Object.freeze(types),
  });
}

function associatedOwnerParameter(
  associated: RustCompilerAssociatedType,
  trait: import("../model/model.js").RustCompilerTraitReference,
): Extract<RustCompilerGenericParameter, { readonly kind: "type" }> {
  const identity: RustCompilerItemIdentity = Object.freeze({
    itemId: `${associated.identity.itemId}::owner`,
    canonicalPath: Object.freeze([...associated.identity.canonicalPath, "$owner"]),
  });
  return Object.freeze({
    kind: "type",
    identity,
    displayName: "TOwner",
    bounds: Object.freeze([Object.freeze({
      kind: "trait" as const,
      trait,
      polarity: "required" as const,
    })]),
    declarationKind: "explicit",
  });
}

function implicitTraitSelfParameter(
  owner: RustCompilerItemIdentity,
): Extract<RustCompilerGenericParameter, { readonly kind: "type" }> {
  const identity: RustCompilerItemIdentity = Object.freeze({
    itemId: `${owner.itemId}::implicit-self`,
    canonicalPath: Object.freeze([...owner.canonicalPath, "$Self"]),
  });
  return Object.freeze({
    kind: "type",
    identity,
    displayName: "Self",
    bounds: Object.freeze([]),
    declarationKind: "implicit-self",
  });
}

function genericParameterProjectionMap(
  parameters: readonly RustCompilerGenericParameter[],
): ReadonlyMap<string, RustCompilerGenericParameter> {
  return new Map(parameters.map((parameter) => [genericParameterIdentity(parameter), parameter]));
}

function uniqueProjectionGenericNames(
  parameters: readonly RustCompilerGenericParameter[],
): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  const occupied = new Set<string>();
  for (const [index, parameter] of parameters.entries()) {
    const base = parameter.kind === "lifetime"
      ? parameter.identity.kind === "parameter" || parameter.identity.kind === "bound"
        ? `L_${parameter.identity.displayName}`
        : "L_static"
      : parameter.kind === "const"
        ? `N_${parameter.displayName}`
        : parameter.displayName;
    const safeBase = /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(base) ? base : `G${index}`;
    let name = safeBase;
    let suffix = 2;
    while (occupied.has(name)) {
      name = `${safeBase}_${suffix}`;
      suffix += 1;
    }
    occupied.add(name);
    names.set(genericParameterIdentity(parameter), name);
  }
  return names;
}

function compilerGenericParameterArgument(
  parameter: RustCompilerGenericParameter,
): import("../model/model.js").RustCompilerGenericArgument {
  if (parameter.kind === "lifetime") {
    return Object.freeze({ kind: "lifetime", value: parameter.identity });
  }
  if (parameter.kind === "type") {
    return Object.freeze({
      kind: "type",
      value: Object.freeze({
        kind: "type-parameter",
        identity: parameter.identity,
        displayName: parameter.displayName,
      }),
    });
  }
  return Object.freeze({
    kind: "const",
    value: Object.freeze({
      kind: "parameter",
      identity: parameter.identity,
      displayName: parameter.displayName,
    }),
  });
}

function projectFields(
  fields: readonly RustCompilerField[],
  union: boolean,
  context: ProjectionContext,
  exportId: string,
  receiverCarrier: TargetTypeRef,
  generics: RustCompilerGenerics,
  members: ProviderMemberDeclaration[],
  operations: RustProviderOperationDefinition[],
): void {
  for (const field of fields) {
    const memberId = `${exportId}::field:${field.identity.itemId}`;
    const sourceType = sourceTypeFor(field.type, context, "result");
    const targetType = targetTypeFor(field.type, context, "result");
    members.push(Object.freeze({
      id: memberId,
      name: providerFieldName(field.name),
      kind: "property",
      type: sourceType,
    }));
    const common = {
      exportId,
      memberId,
      receiverCarrier,
      sourceGenericBindings: providerSourceGenericBindings(
        requireCurrentType(context).genericParameters,
        context,
      ),
      targetGenerics: targetGenericsFor(generics, context),
      ...typeRequirements(generics, requireCurrentType(context).typeParameters, context),
    };
    operations.push(operationRow({
      ...common,
      operationKind: "property",
      target: fieldTarget(field),
      resultCarrier: targetType,
      ...(union ? { isUnsafe: true } : {}),
    }));
    operations.push(operationRow({
      ...common,
      operationKind: "property-set",
      target: fieldTarget(field),
      resultCarrier: rustUnitTargetType(),
      parameterCarriers: [targetType],
      ...(union ? { isUnsafe: true } : {}),
    }));
  }
}

function fieldTarget(
  field: RustCompilerField,
): { readonly form: "field"; readonly name: string } | { readonly form: "tuple-field"; readonly index: number } {
  const index = parseTupleFieldIndex(field.name);
  return index === undefined ? { form: "field", name: field.name } : { form: "tuple-field", index };
}

function providerFieldName(name: string): ProviderPropertyName {
  const index = parseTupleFieldIndex(name);
  return index === undefined ? name : { kind: "number-literal", value: index };
}

function parseTupleFieldIndex(name: string): number | undefined {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(name)) return undefined;
  const value = Number(name);
  return Number.isSafeInteger(value) ? value : undefined;
}

function projectEnumVariants(
  variants: readonly RustCompilerEnumVariant[],
  context: ProjectionContext,
  exportId: string,
  resultCarrier: TargetTypeRef,
  sourceResult: ProviderTypeExpression,
  generics: RustCompilerGenerics,
  members: ProviderMemberDeclaration[],
  operations: RustProviderOperationDefinition[],
): void {
  const owner = requireCurrentType(context);
  for (const variant of variants) {
    const memberId = `${exportId}::variant:${variant.identity.itemId}`;
    const path = [...owner.targetPath, variant.name].join("::");
    if (variant.fields.kind === "unit") {
      if (owner.genericParameters.length === 0) {
        members.push(Object.freeze({
          id: memberId,
          name: variant.name,
          kind: "field",
          static: true,
          type: sourceResult,
        }));
        operations.push(operationRow({
          exportId,
          memberId,
          operationKind: "property",
          target: { form: "path", path },
          resultCarrier,
        }));
      } else {
        const signatureId = `${memberId}::signature`;
        members.push(Object.freeze({
          id: memberId,
          name: variant.name,
          kind: "method",
          static: true,
          signatures: Object.freeze([Object.freeze({
            id: signatureId,
            name: variant.name,
            parameters: Object.freeze([]),
            returnType: sourceResult,
            typeParameters: Object.freeze(owner.genericParameters.map((parameter, index) =>
              providerGenericParameter(parameter, context, index))),
          })]),
        }));
        operations.push(operationRow({
          exportId,
          memberId,
          signatureId,
          operationKind: "method",
          target: { form: "path", path },
          resultCarrier,
          sourceGenericBindings: providerSourceGenericBindings(owner.genericParameters, context),
          targetGenerics: targetGenericsFor(generics, context),
          targetGenericArguments: owner.genericParameters.map((parameter) =>
            targetGenericParameterArgument(parameter, context)),
          ...typeRequirements(generics, owner.typeParameters, context),
        }));
      }
      continue;
    }
    const fields = variant.fields.fields;
    const parameters: ProviderParameterDeclaration[] = fields.map((field, index) => Object.freeze({
      name: variant.fields.kind === "struct" ? field.name : `value${index}`,
      type: sourceTypeFor(field.type, context, "parameter"),
    }));
    const parameterCarriers = fields.map((field) => targetTypeFor(field.type, context, "parameter"));
    const signatureId = `${memberId}::signature`;
    members.push(Object.freeze({
      id: memberId,
      name: variant.name,
      kind: "method",
      static: true,
      signatures: Object.freeze([Object.freeze({
        id: signatureId,
        name: variant.name,
        parameters: Object.freeze(parameters),
        returnType: sourceResult,
        ...(owner.genericParameters.length === 0
          ? {}
          : {
              typeParameters: Object.freeze(owner.genericParameters.map((parameter, index) =>
                providerGenericParameter(parameter, context, index))),
            }),
      })]),
    }));
    const targetGenericArguments = owner.genericParameters.map((parameter) =>
      targetGenericParameterArgument(parameter, context));
    operations.push(operationRow({
      exportId,
      memberId,
      signatureId,
      operationKind: "method",
      target: variant.fields.kind === "struct"
        ? { form: "struct-variant", path, fields: Object.freeze(fields.map((field) => field.name)) }
        : { form: "call", path },
      resultCarrier,
      parameterCarriers,
      sourceGenericBindings: providerSourceGenericBindings(owner.genericParameters, context),
      targetGenerics: targetGenericsFor(generics, context),
      ...(targetGenericArguments.length === 0 ? {} : { targetGenericArguments }),
      ...typeRequirements(generics, owner.typeParameters, context),
    }));
  }
}

function projectTypeMethods(
  methods: readonly RustCompilerFunction[],
  ownerKind: "struct" | "enum" | "union" | "trait",
  context: ProjectionContext,
  exportId: string,
  ownerTargetPath: readonly string[],
): {
  readonly members: readonly ProviderMemberDeclaration[];
  readonly operations: readonly RustProviderOperationDefinition[];
} {
  const projected = methods.flatMap((method) => {
    if (ownerKind === "trait" && method.receiver === undefined) return [];
    const result = compilerFunctionResult(method.result);
    const constructor = ownerKind === "struct" && method.receiver === undefined &&
      method.traitDispatch === undefined && method.name === "new" &&
      method.enclosingGenerics.parameters.length === 0 &&
      method.generics.parameters.length === 0 && rustCompilerTypeNamesCurrentType(result.type, context);
    return [{
      method,
      constructor,
      value: projectFunction(method, context, exportId, constructor, ownerTargetPath),
    }];
  });
  const byMember = new Map<string, typeof projected>();
  for (const entry of projected) {
    const memberId = entry.value.memberId!;
    const group = byMember.get(memberId) ?? [];
    group.push(entry);
    byMember.set(memberId, group);
  }
  const members: ProviderMemberDeclaration[] = [];
  const operations: RustProviderOperationDefinition[] = [];
  for (const [memberId, group] of [...byMember].sort(([left], [right]) => compareText(left, right))) {
    const counts = new Map<string, number>();
    for (const entry of group) {
      const key = sourceSignatureSelectionKey(entry.value.signature);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const selected = group.filter((entry) => counts.get(sourceSignatureSelectionKey(entry.value.signature)) === 1);
    if (selected.length === 0) continue;
    const first = selected[0]!;
    members.push(Object.freeze({
      id: memberId,
      name: first.constructor ? "constructor" : first.method.name,
      kind: first.constructor ? "constructor" : "method",
      ...(first.constructor || sourceMethodIsInstance(first.method) ? {} : { static: true }),
      signatures: Object.freeze(selected.map((entry) => entry.value.signature)),
    }));
    operations.push(...selected.map((entry) => entry.value.operation));
  }
  return { members: Object.freeze(members), operations: Object.freeze(operations) };
}

function projectAssociatedConstants(
  constants: readonly RustCompilerAssociatedConstant[],
  context: ProjectionContext,
  exportId: string,
  ownerTargetPath: readonly string[],
  ownerGenerics: RustCompilerGenerics,
): {
  readonly members: readonly ProviderMemberDeclaration[];
  readonly operations: readonly RustProviderOperationDefinition[];
} {
  const nameCounts = new Map<string, number>();
  for (const constant of constants) {
    nameCounts.set(constant.name, (nameCounts.get(constant.name) ?? 0) + 1);
  }
  const members: ProviderMemberDeclaration[] = [];
  const operations: RustProviderOperationDefinition[] = [];
  const owner = requireCurrentType(context);
  for (const constant of constants) {
    if (nameCounts.get(constant.name) !== 1) continue;
    const memberId = `${exportId}::associated-constant:${constant.identity.itemId}`;
    const resultCarrier = targetTypeFor(constant.type, context, "result");
    const sourceType = sourceTypeFor(constant.type, context, "result");
    const target = constant.traitDispatch === undefined
      ? { form: "path" as const, path: [...ownerTargetPath, constant.name].join("::") }
      : {
          form: "trait-associated-value" as const,
          owner: owner.carrier,
          trait: targetTraitFor(constant.traitDispatch, context, "result"),
          name: constant.name,
        };
    const ownContext: ProjectionContext = {
      ...context,
      genericNames: new Map([
        ...(context.genericNames ?? []),
        ...genericNameMap(constant.generics.parameters),
      ]),
      genericParameters: new Map([
        ...(context.genericParameters ?? []),
        ...genericParameterProjectionMap(constant.generics.parameters),
      ]),
    };
    const ownParameters = providerTypeParameters(
      constant.generics.parameters,
      ownContext,
    );
    const allSourceParameters = [...owner.typeParameters, ...ownParameters.map((parameter) => parameter.name)];
    const genericArguments = constant.generics.parameters.map((parameter) =>
      targetGenericParameterArgument(parameter, ownContext));
    if (allSourceParameters.length === 0) {
      members.push(Object.freeze({
        id: memberId,
        name: constant.name,
        kind: "property",
        static: true,
        type: sourceType,
      }));
      operations.push(operationRow({
        exportId,
        memberId,
        operationKind: "property",
        target,
        resultCarrier,
        ...typeRequirements(constant.generics, allSourceParameters, ownContext),
      }));
      continue;
    }
    const signatureId = `${memberId}::signature`;
    members.push(Object.freeze({
      id: memberId,
      name: constant.name,
      kind: "method",
      static: true,
      signatures: Object.freeze([Object.freeze({
        id: signatureId,
        name: constant.name,
        parameters: Object.freeze([]),
        returnType: sourceType,
        typeParameters: Object.freeze([
          ...owner.genericParameters.map((parameter, index) =>
            providerGenericParameter(parameter, context, index)),
          ...ownParameters,
        ]),
      })]),
    }));
    operations.push(operationRow({
      exportId,
      memberId,
      signatureId,
      operationKind: "method",
      target,
      resultCarrier,
      sourceGenericBindings: providerSourceGenericBindings([
        ...owner.genericParameters,
        ...constant.generics.parameters,
      ], ownContext),
      targetGenerics: targetGenericsFor(
        mergeGenerics(ownerGenerics, constant.generics),
        ownContext,
      ),
      ...(genericArguments.length === 0 ? {} : { targetGenericArguments: genericArguments }),
      ...typeRequirements(mergeGenerics(ownerGenerics, constant.generics), allSourceParameters, ownContext),
    }));
  }
  return { members: Object.freeze(members), operations: Object.freeze(operations) };
}

function sourceSignatureSelectionKey(signature: ProviderSignatureDeclaration): string {
  return JSON.stringify({
    parameters: signature.parameters,
    returnType: signature.returnType,
    typeParameters: signature.typeParameters,
  });
}

export function sourceMethodIsInstance(method: RustCompilerFunction): boolean {
  return method.receiver !== undefined;
}

function providerGenericParameter(
  parameter: RustCompilerGenericParameter,
  context: ProjectionContext,
  index: number,
): ProviderTypeParameterDeclaration {
  const projected = providerTypeParameters([parameter], context);
  if (projected.length !== 1) {
    throw new Error(`Rust generic parameter ${index} did not project exactly once.`);
  }
  return projected[0]!;
}

function mergeGenerics(
  left: RustCompilerGenerics,
  right: RustCompilerGenerics,
): RustCompilerGenerics {
  return Object.freeze({
    parameters: Object.freeze([...left.parameters, ...right.parameters]),
    wherePredicates: Object.freeze([...left.wherePredicates, ...right.wherePredicates]),
  });
}

function isTypeExport(exported: RustCompilerExport): boolean {
  return exported.kind === "struct" || exported.kind === "enum" ||
    exported.kind === "union" || exported.kind === "trait" || exported.kind === "type-alias";
}
