import {
  canonicalPathKey,
  importedSourceType,
  withDefaultGenericBindings,
  withProjectionGenericParameters,
} from "./utilities.js";
import { rustSourceTypeExportIds, rustTypesModule } from "../../../source/semantics/identity.js";
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
import { projectFunction, selectUnambiguousMembers } from "./functions.js";
import {
  providerGenericBindingsFor,
  providerGenericParametersFor,
  sourceGenericParameterArguments,
  sourceTypeFor,
  targetGenericParameterArguments,
  targetTraitFor,
  targetTypeFor,
} from "./types.js";
import {
  projectAssociatedConstants,
  projectAssociatedTypes,
  projectFields,
  projectTypeMethods,
  projectVariants,
  providerTypeParameterNames,
  syntheticTraitSelf,
  traitDispatchFor,
  typeParametersOf,
} from "./declaration-members.js";
import { sourceTypeGenericParameters } from "./source-generics.js";
import { rustNamedTargetType, rustUnitTargetType } from "../../../target-model/types/index.js";
import type {
  ProviderExportDeclaration,
  ProviderMemberDeclaration,
  ProviderTypeExpression,
} from "@tsonic/tsts";
import type {
  RustCompilerExport,
  RustCompilerModuleModel,
} from "../model/model.js";
import type {
  ProjectionContext,
  ProjectionOwner,
  RustCompilerProviderProjection,
} from "./model.js";
import type {
  RustNamedTypeTraitContract,
  RustTargetGenericArgument,
  TargetTypeRef,
} from "../../../target-model/types/model.js";
import type {
  RustProviderOperationDefinition,
  RustProviderTypeDefinition,
} from "../../packages/model.js";
import type { RustProviderGenericParameter } from "../../../target-model/operations/model.js";

interface ProjectedExport {
  readonly declaration: ProviderExportDeclaration;
  readonly operations: readonly RustProviderOperationDefinition[];
  readonly type?: RustProviderTypeDefinition;
  readonly additionalDeclarations?: readonly ProviderExportDeclaration[];
  readonly additionalTypes?: readonly RustProviderTypeDefinition[];
}

export function projectRustCompilerModule(
  module: RustCompilerModuleModel,
  owner: ProjectionOwner,
): RustCompilerProviderProjection {
  if (module.unsupportedExports.length > 0) {
    throw new Error(module.unsupportedExports
      .map((entry) => `${entry.name}: ${entry.reason}`).join("; "));
  }
  const imports = new Map<string, Set<string>>();
  const declarations: ProviderExportDeclaration[] = [];
  const operations: RustProviderOperationDefinition[] = [];
  const types: RustProviderTypeDefinition[] = [];
  const carrierPaths = new Map<string, string>();
  const carrierTraits = new Map<string, RustNamedTypeTraitContract>();
  const standardTypes = new Map(module.standardTypeLocations.map((location) => [
    canonicalPathKey(location.canonicalPath),
    location,
  ]));
  const localStandardTypeNames = new Map(module.exports
    .filter(isNominalExport)
    .map((exported) => [canonicalPathKey(exported.canonicalPath), exported.name]));
  const context: ProjectionContext = {
    dependency: module.dependency,
    modulePath: module.modulePath,
    owner,
    imports,
    carrierPaths,
    carrierTraits,
    standardTypes,
    localStandardTypeNames,
  };
  for (const exported of module.exports) {
    const projected = projectExport(exported, context);
    declarations.push(projected.declaration, ...(projected.additionalDeclarations ?? []));
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
): ProjectedExport {
  const exportId = compilerExportId(
    context.dependency,
    context.modulePath,
    exported.name,
  );
  if (exported.kind === "constant" || exported.kind === "static") {
    return projectValueExport(exported, context, exportId);
  }
  if (exported.kind === "function") {
    const projected = projectFunction(
      exported.function,
      context,
      exportId,
      false,
      exported.targetPath,
    );
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
  if (exported.kind === "type-alias") {
    return projectTypeAlias(exported, context, exportId);
  }
  return projectNominalExport(exported, context, exportId);
}

function projectValueExport(
  exported: Extract<RustCompilerExport, { readonly kind: "constant" | "static" }>,
  context: ProjectionContext,
  exportId: string,
): ProjectedExport {
  const sourceType = sourceTypeFor(exported.type, context, "result");
  const targetCarrier = targetTypeFor(exported.type, context, "result");
  if (exported.kind === "static" && exported.mutable) {
    const memberId = `${exportId}::static-value`;
    const path = exported.targetPath.join("::");
    return {
      declaration: Object.freeze({
        id: exportId,
        name: exported.name,
        exportName: exported.name,
        kind: "class",
        members: Object.freeze([Object.freeze({
          id: memberId,
          name: "value",
          kind: "property",
          type: sourceType,
          static: true,
        })]),
      }),
      operations: Object.freeze([
        operationRow({
          exportId,
          memberId,
          operationKind: "property",
          target: { form: "static", path },
          resultCarrier: targetCarrier,
          isUnsafe: true,
        }),
        operationRow({
          exportId,
          memberId,
          operationKind: "property-set",
          target: { form: "static", path },
          resultCarrier: rustUnitTargetType(),
          parameterCarriers: Object.freeze([targetCarrier]),
          isUnsafe: true,
        }),
      ]),
    };
  }
  if (exported.kind === "static" && !exported.copy) {
    const sourceReference = importedSourceType(
      context,
      rustTypesModule,
      rustSourceTypeExportIds.sharedReference,
      [
        sourceType,
        importedSourceType(
          context,
          rustTypesModule,
          rustSourceTypeExportIds.staticLifetime,
          [],
        ),
      ],
    );
    const resultCarrier: TargetTypeRef = Object.freeze({
      kind: "reference",
      referent: targetCarrier,
      mutable: false,
      lifetime: Object.freeze({ kind: "static" }),
    });
    return {
      declaration: Object.freeze({
        id: exportId,
        name: exported.name,
        exportName: exported.name,
        kind: "value",
        type: sourceReference,
      }),
      operations: Object.freeze([operationRow({
        exportId,
        operationKind: "property",
        target: {
          form: "reference-path",
          path: exported.targetPath.join("::"),
          mutable: false,
        },
        resultCarrier,
        ...(exported.unsafe ? { isUnsafe: true } : {}),
      })]),
    };
  }
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
      target: { form: "path", path: exported.targetPath.join("::") },
      resultCarrier: targetCarrier,
      ...(exported.kind === "static" && exported.unsafe
        ? { isUnsafe: true }
        : {}),
    })]),
  };
}

function projectTypeAlias(
  exported: Extract<RustCompilerExport, { readonly kind: "type-alias" }>,
  context: ProjectionContext,
  exportId: string,
): ProjectedExport {
  const namedContext = withProjectionGenericParameters(
    context,
    exported.genericParameters,
  );
  const typeContext = withDefaultGenericBindings(
    namedContext,
    exported.genericParameters,
  );
  const sourceParameters = providerGenericParametersFor(
    exported.genericParameters,
    typeContext,
  );
  const typeNames = providerTypeParameterNames(exported.genericParameters, typeContext);
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
      ...(exported.genericParameters.length === 0
        ? {}
        : {
            genericParameters: providerGenericBindingsFor(
              exported.genericParameters,
              typeContext,
            ),
          }),
      targetCarrier: targetTypeFor(exported.type, typeContext, "result"),
      ...typeRequirements(typeParametersOf(exported.genericParameters), typeNames, typeContext),
    }),
  };
}

function projectNominalExport(
  exported: Exclude<
    RustCompilerExport,
    { readonly kind: "constant" | "static" | "function" | "type-alias" }
  >,
  context: ProjectionContext,
  exportId: string,
): ProjectedExport {
  const sourceGenerics = sourceTypeGenericParameters(exported.genericParameters);
  const declaredContext = withProjectionGenericParameters(
    context,
    sourceGenerics,
  );
  const genericContext = withDefaultGenericBindings(
    declaredContext,
    sourceGenerics,
  );
  const standardLocation = context.standardTypes.get(
    canonicalPathKey(exported.canonicalPath),
  );
  const selectedTargetPath = standardLocation?.targetPath ?? exported.targetPath;
  const targetTypeId = standardLocation?.targetId ??
    compilerTargetTypeId(context.dependency, exported.canonicalPath);
  recordCarrierPath(context.carrierPaths, targetTypeId, selectedTargetPath.join("::"));
  const sourceArguments = sourceGenericParameterArguments(
    sourceGenerics,
    genericContext,
  );
  const sourceType: ProviderTypeExpression = Object.freeze({
    kind: "provider-ref",
    moduleSpecifier: context.owner.moduleSpecifier,
    exportName: exported.name,
    ...(sourceArguments.length === 0 ? {} : { typeArguments: sourceArguments }),
  });
  const targetArguments = targetGenericParameterArguments(
    sourceGenerics,
    genericContext,
  );
  const providerGenericBindings = providerGenericBindingsFor(
    sourceGenerics,
    genericContext,
  );
  const genericDefaults = trailingProviderGenericDefaults(providerGenericBindings);
  const namedTraits = exported.kind === "trait"
    ? undefined
    : projectCompilerTraitContract(exported.traits, genericContext);
  const declaredCarrier: TargetTypeRef = exported.kind === "trait"
    ? targetTraitFor(
        traitDispatchFor(exported),
        genericContext,
        "result",
      )
    : rustNamedTargetType(
        targetTypeId,
        selectedTargetPath.join("::"),
        targetArguments,
        genericDefaults,
        namedTraits!,
      );
  if (namedTraits !== undefined) {
    recordCarrierTraits(
      context.carrierTraits,
      targetTypeId,
      namedTraits,
    );
  }
  const traitSelf = exported.kind === "trait"
    ? syntheticTraitSelf(exported, genericContext)
    : undefined;
  const operationContextBase = traitSelf === undefined
    ? genericContext
    : withProjectionGenericParameters(genericContext, [traitSelf.parameter]);
  const typeContext: ProjectionContext = Object.freeze({
    ...operationContextBase,
    currentType: Object.freeze({
      exportId,
      name: exported.name,
      carrier: traitSelf?.carrier ?? declaredCarrier,
      sourceType,
      genericParameters: Object.freeze([
        ...sourceGenerics,
        ...(traitSelf === undefined ? [] : [traitSelf.parameter]),
      ]),
      canonicalPath: exported.canonicalPath,
      targetPath: selectedTargetPath,
    }),
  });
  const members: ProviderMemberDeclaration[] = [];
  const operations: RustProviderOperationDefinition[] = [];
  const nativeEnum = exported.kind === "enum" && exported.variantsComplete &&
    exported.genericParameters.length === 0 &&
    exported.variants.every((variant) => variant.kind === "plain") &&
    exported.methods.length === 0 && exported.associatedConstants.length === 0;
  if (exported.kind === "struct" || exported.kind === "union") {
    projectFields(exported, typeContext, exportId, declaredCarrier, members, operations);
  } else if (exported.kind === "enum" && exported.variantsComplete) {
    projectVariants(
      exported,
      typeContext,
      exportId,
      selectedTargetPath,
      declaredCarrier,
      sourceType,
      nativeEnum,
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
  const projectedConstants = exported.kind === "trait"
    ? { members: Object.freeze([]), operations: Object.freeze([]) }
    : projectAssociatedConstants(
        exported.associatedConstants,
        typeContext,
        exportId,
      );
  members.push(...projectedConstants.members);
  operations.push(...projectedConstants.operations);
  const unambiguous = selectUnambiguousMembers(members, operations);
  const sourceParameters = providerGenericParametersFor(
    sourceGenerics,
    genericContext,
  );
  const associated = exported.kind === "trait"
    ? projectAssociatedTypes(exported, genericContext)
    : { declarations: Object.freeze([]), types: Object.freeze([]) };
  const typeNames = providerTypeParameterNames(sourceGenerics, genericContext);
  return {
    declaration: Object.freeze({
      id: exportId,
      name: exported.name,
      exportName: exported.name,
      kind: exported.kind === "trait"
        ? "interface"
        : nativeEnum
          ? "enum"
          : "class",
      ...(sourceParameters.length === 0 ? {} : { typeParameters: sourceParameters }),
      members: unambiguous.members,
    }),
    operations: unambiguous.operations,
    additionalDeclarations: associated.declarations,
    additionalTypes: associated.types,
    type: Object.freeze({
      exportId,
      ...(sourceGenerics.length === 0
        ? {}
        : {
            genericParameters: providerGenericBindings,
          }),
      targetCarrier: declaredCarrier,
      ...typeRequirements(typeParametersOf(sourceGenerics), typeNames, genericContext),
    }),
  };
}

function trailingProviderGenericDefaults(
  parameters: readonly RustProviderGenericParameter[],
): readonly RustTargetGenericArgument[] {
  const firstDefault = parameters.findIndex((parameter) =>
    parameter.kind !== "lifetime" && parameter.defaultArgument !== undefined);
  if (firstDefault < 0) return Object.freeze([]);
  const suffix = parameters.slice(firstDefault);
  if (suffix.some((parameter) =>
    parameter.kind === "lifetime" || parameter.defaultArgument === undefined)) {
    throw new Error("Rust provider generic defaults must form one trailing target-omittable suffix.");
  }
  return Object.freeze(suffix.map((parameter) =>
    (parameter as Exclude<RustProviderGenericParameter, { readonly kind: "lifetime" }>).defaultArgument!));
}

function isNominalExport(
  exported: RustCompilerExport,
): exported is Extract<
  RustCompilerExport,
  { readonly kind: "struct" | "enum" | "union" | "trait" }
> {
  return exported.kind === "struct" || exported.kind === "enum" ||
    exported.kind === "union" || exported.kind === "trait";
}
