import {
  canonicalPathKey,
  genericNameMap,
  requireCurrentType,
  sourceVisibleGenericParameters,
  withDefaultTypeBindings,
} from "./utilities.js";
import {
  compilerExportId,
  compilerTargetTypeId,
  materializeImports,
  operationRow,
  projectCompilerTraitContract,
  recordCarrierTraits,
  typeRequirements,
} from "./operations.js";
import { compilerAssociatedSourceExportName } from "../model/rustdoc-items.js";
import {
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
  targetTypeFor,
} from "./types.js";
import {
  rustPathTargetType,
  rustReferenceTargetType,
  rustTypeParameterTargetType,
} from "../../../target-model/types/index.js";
import { rustStaticLifetime } from "../../../target-model/semantics/index.js";
import { rustStaticValueCanBeCopied } from "../model/rustdoc-types.js";
import { rustSourceTypeExportIds, rustTypesModule } from "../../../source/semantics/identity.js";
import type {
  ProviderExportDeclaration,
  ProviderMemberDeclaration,
  ProviderTypeExpression,
} from "@tsonic/tsts";
import type {
  RustCompilerAssociatedType,
  RustCompilerExport,
  RustCompilerGenericParameter,
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
import { standardRustTypeSemanticRoles } from "./standard-library-policy.js";
import { projectStandardSliceIndexing } from "./indexing.js";
import {
  compilerGenericParameterArgument,
  genericParameterProjectionMap,
  mergeGenerics,
  projectAssociatedConstants,
  projectEnumVariants,
  projectFields,
  projectTypeMethods,
  uniqueProjectionGenericNames,
} from "./declaration-members.js";

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
  const traitContracts = new Map<string, import("../../../target-model/types/model.js").RustNamedTypeTraitContractEntry>();
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
      traitContracts,
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
    traitContracts,
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
    context.traitContracts,
    typeCarrier.identity,
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

function isTypeExport(exported: RustCompilerExport): boolean {
  return exported.kind === "struct" || exported.kind === "enum" ||
    exported.kind === "union" || exported.kind === "trait" || exported.kind === "type-alias";
}
