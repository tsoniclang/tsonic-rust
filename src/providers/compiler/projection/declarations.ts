import {
  canonicalPathKey,
  compareText,
  requireCurrentType,
  rustCompilerTypeNamesCurrentType,
  withDefaultGenericBindings,
  withProjectionGenericParameters,
} from "./utilities.js";
import {
  compilerExportId,
  compilerTargetTypeId,
  materializeImports,
  operationRow,
  projectCompilerTraitContract,
  recordCarrierPath,
  recordCarrierTraits,
  targetTraitPath,
  typeRequirements,
} from "./operations.js";
import {
  compilerFunctionResult,
  projectFunction,
  selectUnambiguousMembers,
  sourceMethodIsInstance,
} from "./functions.js";
import {
  providerGenericBindingsFor,
  providerGenericParametersFor,
  sourceGenericParameterArguments,
  sourceGenericParameterNames,
  sourceTraitFor,
  sourceTypeFor,
  targetGenericArgumentFor,
  targetGenericParameterArguments,
  targetTraitFor,
  targetTypeFor,
} from "./types.js";
import {
  compilerAssociatedSourceExportName,
} from "../model/rustdoc-items.js";
import { rustUnitTargetType } from "../../../target-model/types/index.js";
import type {
  ProviderExportDeclaration,
  ProviderHeritageDeclaration,
  ProviderMemberDeclaration,
  ProviderParameterDeclaration,
  ProviderSignatureDeclaration,
  ProviderTypeExpression,
} from "@tsonic/tsts";
import type {
  RustCompilerAssociatedConstant,
  RustCompilerAssociatedType,
  RustCompilerExport,
  RustCompilerFunction,
  RustCompilerGenericArgument,
  RustCompilerGenericParameter,
  RustCompilerModuleModel,
  RustCompilerTraitDispatch,
  RustCompilerTypeParameter,
} from "../model/model.js";
import type {
  ProjectionContext,
  ProjectionOwner,
  RustCompilerProviderProjection,
} from "./model.js";
import type {
  RustNamedTypeTraitContract,
  TargetTypeRef,
} from "../../../target-model/types/model.js";
import type {
  RustProviderOperationDefinition,
  RustProviderTypeDefinition,
} from "../../packages/model.js";

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
      ...typeRequirements(typeParametersOf(exported.genericParameters), typeNames),
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
  const declaredContext = withProjectionGenericParameters(
    context,
    exported.genericParameters,
  );
  const genericContext = withDefaultGenericBindings(
    declaredContext,
    exported.genericParameters,
  );
  const standardLocation = context.standardTypes.get(
    canonicalPathKey(exported.canonicalPath),
  );
  const selectedTargetPath = standardLocation?.targetPath ?? exported.targetPath;
  const targetTypeId = standardLocation?.targetId ??
    compilerTargetTypeId(context.dependency, exported.canonicalPath);
  recordCarrierPath(context.carrierPaths, targetTypeId, selectedTargetPath.join("::"));
  const sourceArguments = sourceGenericParameterArguments(
    exported.genericParameters,
    genericContext,
  );
  const sourceType: ProviderTypeExpression = Object.freeze({
    kind: "provider-ref",
    moduleSpecifier: context.owner.moduleSpecifier,
    exportName: exported.name,
    ...(sourceArguments.length === 0 ? {} : { typeArguments: sourceArguments }),
  });
  const targetArguments = targetGenericParameterArguments(
    exported.genericParameters,
    genericContext,
  );
  const declaredCarrier: TargetTypeRef = exported.kind === "trait"
    ? targetTraitFor(
        traitDispatchFor(exported),
        genericContext,
        "result",
      )
    : Object.freeze({
        kind: "target-named" as const,
        id: targetTypeId,
        ...(targetArguments.length === 0
          ? {}
          : { genericArguments: targetArguments }),
      });
  if (exported.kind !== "trait") {
    recordCarrierTraits(
      context.carrierTraits,
      targetTypeId,
      projectCompilerTraitContract(exported.traits),
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
        ...exported.genericParameters,
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
  const projectedConstants = projectAssociatedConstants(
    exported.associatedConstants,
    typeContext,
    exportId,
  );
  members.push(...projectedConstants.members);
  operations.push(...projectedConstants.operations);
  const unambiguous = selectUnambiguousMembers(members, operations);
  const sourceParameters = providerGenericParametersFor(
    exported.genericParameters,
    genericContext,
  );
  const heritage: readonly ProviderHeritageDeclaration[] = exported.kind === "trait"
    ? Object.freeze(exported.superTraits.map((trait) => Object.freeze({
        kind: "extends" as const,
        type: sourceTraitFor(trait, typeContext, "result"),
      })))
    : Object.freeze([]);
  const associated = exported.kind === "trait"
    ? projectAssociatedTypes(exported, genericContext)
    : { declarations: Object.freeze([]), types: Object.freeze([]) };
  const typeNames = providerTypeParameterNames(exported.genericParameters, genericContext);
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
      ...(heritage.length === 0 ? {} : { heritage }),
      members: unambiguous.members,
    }),
    operations: unambiguous.operations,
    additionalDeclarations: associated.declarations,
    additionalTypes: associated.types,
    type: Object.freeze({
      exportId,
      ...(exported.genericParameters.length === 0
        ? {}
        : {
            genericParameters: providerGenericBindingsFor(
              exported.genericParameters,
              genericContext,
            ),
          }),
      targetCarrier: declaredCarrier,
      ...typeRequirements(typeParametersOf(exported.genericParameters), typeNames),
    }),
  };
}

function projectFields(
  exported: Extract<RustCompilerExport, { readonly kind: "struct" | "union" }>,
  context: ProjectionContext,
  exportId: string,
  carrier: TargetTypeRef,
  members: ProviderMemberDeclaration[],
  operations: RustProviderOperationDefinition[],
): void {
  const generics = providerGenericBindingsFor(exported.genericParameters, context);
  const typeNames = generics.flatMap((parameter) =>
    parameter.kind === "type" ? [parameter.sourceName] : []);
  for (const field of exported.fields) {
    const sourceFieldType = sourceTypeFor(field.type, context, "result");
    const targetFieldType = targetTypeFor(field.type, context, "result");
    const memberId = `${exportId}::field:${field.name}`;
    members.push(Object.freeze({
      id: memberId,
      name: field.name,
      kind: "property",
      type: sourceFieldType,
    }));
    const common = {
      exportId,
      memberId,
      target: { form: "field" as const, name: field.name },
      receiverCarrier: carrier,
      ...(generics.length === 0 ? {} : { genericParameters: generics }),
      ...typeRequirements(typeParametersOf(exported.genericParameters), typeNames),
    };
    operations.push(operationRow({
      ...common,
      operationKind: "property",
      resultCarrier: targetFieldType,
      ...(exported.kind === "union" ? { isUnsafe: true } : {}),
    }));
    operations.push(operationRow({
      ...common,
      operationKind: "property-set",
      resultCarrier: rustUnitTargetType(),
      parameterCarriers: Object.freeze([targetFieldType]),
    }));
  }
}

function projectVariants(
  exported: Extract<RustCompilerExport, { readonly kind: "enum" }>,
  context: ProjectionContext,
  exportId: string,
  selectedTargetPath: readonly string[],
  carrier: TargetTypeRef,
  sourceType: ProviderTypeExpression,
  nativeEnum: boolean,
  members: ProviderMemberDeclaration[],
  operations: RustProviderOperationDefinition[],
): void {
  const generics = providerGenericBindingsFor(exported.genericParameters, context);
  const sourceParameters = providerGenericParametersFor(exported.genericParameters, context);
  const typeNames = generics.flatMap((parameter) =>
    parameter.kind === "type" ? [parameter.sourceName] : []);
  for (const variant of exported.variants) {
    const memberId = `${exportId}::variant:${variant.name}`;
    if (variant.kind === "plain") {
      if (sourceParameters.length !== 0) {
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
            returnType: sourceType,
            typeParameters: sourceParameters,
          })]),
        }));
        operations.push(operationRow({
          exportId,
          memberId,
          signatureId,
          operationKind: "method",
          target: {
            form: "associated-value",
            owner: carrier,
            name: variant.name,
          },
          resultCarrier: carrier,
          genericParameters: generics,
          ...typeRequirements(typeParametersOf(exported.genericParameters), typeNames),
        }));
        continue;
      }
      members.push(Object.freeze({
        id: memberId,
        name: variant.name,
        kind: "field",
        ...(nativeEnum ? {} : { static: true, type: sourceType }),
      }));
      operations.push(operationRow({
        exportId,
        memberId,
        operationKind: "property",
        target: {
          form: "path",
          path: [...selectedTargetPath, variant.name].join("::"),
        },
        resultCarrier: carrier,
        ...(generics.length === 0 ? {} : { genericParameters: generics }),
        ...typeRequirements(typeParametersOf(exported.genericParameters), typeNames),
      }));
      continue;
    }
    const parameters = variant.fields.map((field, index): ProviderParameterDeclaration =>
      Object.freeze({
        name: `value${index}`,
        type: sourceTypeFor(field, context, "parameter"),
      }));
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
        returnType: sourceType,
        ...(sourceParameters.length === 0 ? {} : { typeParameters: sourceParameters }),
      })]),
    }));
    operations.push(operationRow({
      exportId,
      memberId,
      signatureId,
      operationKind: "method",
      target: {
        form: "call",
        path: [...selectedTargetPath, variant.name].join("::"),
      },
      resultCarrier: carrier,
      parameterCarriers: Object.freeze(variant.fields.map((field) =>
        targetTypeFor(field, context, "parameter"))),
      ...(generics.length === 0 ? {} : { genericParameters: generics }),
      ...typeRequirements(typeParametersOf(exported.genericParameters), typeNames),
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
  const projected = methods.map((method) => {
    const result = compilerFunctionResult(method.result);
    const constructor = ownerKind === "struct" && method.receiver === undefined &&
      method.traitDispatch === undefined && method.name === "new" &&
      method.genericParameters.length === 0 &&
      rustCompilerTypeNamesCurrentType(result.type, context);
    return {
      method,
      constructor,
      value: projectFunction(
        method,
        context,
        exportId,
        constructor,
        ownerTargetPath,
      ),
    };
  });
  const byMember = new Map<string, typeof projected>();
  for (const entry of projected) {
    const memberId = entry.value.memberId;
    if (memberId === undefined) {
      throw new Error(`Rust method '${entry.method.name}' has no provider member identity.`);
    }
    const group = byMember.get(memberId) ?? [];
    group.push(entry);
    byMember.set(memberId, group);
  }
  const members: ProviderMemberDeclaration[] = [];
  const operations: RustProviderOperationDefinition[] = [];
  for (const [memberId, group] of [...byMember]
    .sort(([left], [right]) => compareText(left, right))) {
    const counts = new Map<string, number>();
    for (const entry of group) {
      const key = sourceSignatureSelectionKey(entry.value.signature);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const selected = group.filter((entry) =>
      counts.get(sourceSignatureSelectionKey(entry.value.signature)) === 1);
    if (selected.length === 0) continue;
    const first = selected[0]!;
    members.push(Object.freeze({
      id: memberId,
      name: first.constructor ? "constructor" : first.method.name,
      kind: first.constructor ? "constructor" : "method",
      ...(first.constructor || sourceMethodIsInstance(first.method)
        ? {}
        : { static: true }),
      signatures: Object.freeze(selected.map((entry) => entry.value.signature)),
    }));
    operations.push(...selected.map((entry) => entry.value.operation));
  }
  return Object.freeze({
    members: Object.freeze(members),
    operations: Object.freeze(operations),
  });
}

function projectAssociatedConstants(
  constants: readonly RustCompilerAssociatedConstant[],
  context: ProjectionContext,
  exportId: string,
): {
  readonly members: readonly ProviderMemberDeclaration[];
  readonly operations: readonly RustProviderOperationDefinition[];
} {
  const counts = new Map<string, number>();
  for (const constant of constants) {
    counts.set(constant.name, (counts.get(constant.name) ?? 0) + 1);
  }
  const ownerGenerics = requireCurrentType(context).genericParameters;
  const genericBindings = providerGenericBindingsFor(ownerGenerics, context);
  const sourceParameters = providerGenericParametersFor(ownerGenerics, context);
  const typeNames = genericBindings.flatMap((parameter) =>
    parameter.kind === "type" ? [parameter.sourceName] : []);
  const members: ProviderMemberDeclaration[] = [];
  const operations: RustProviderOperationDefinition[] = [];
  for (const constant of constants) {
    if (counts.get(constant.name) !== 1) continue;
    const memberId = `${exportId}::trait-constant:${constant.name}`;
    const resultCarrier = targetTypeFor(constant.type, context, "result");
    const sourceType = sourceTypeFor(constant.type, context, "result");
    const target = {
      form: "trait-associated-value" as const,
      owner: requireCurrentType(context).carrier,
      traitPath: targetTraitPath(constant.traitDispatch.path, context),
      traitGenericArguments: constant.traitDispatch.genericArguments.map((argument) =>
        targetGenericArgumentFor(argument, context, "result")),
      name: constant.name,
    };
    const requirements = typeRequirements(
      [...typeParametersOf(ownerGenerics), ...constant.typeRequirements],
      typeNames,
    );
    if (genericBindings.length === 0) {
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
        ...requirements,
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
        typeParameters: sourceParameters,
      })]),
    }));
    operations.push(operationRow({
      exportId,
      memberId,
      signatureId,
      operationKind: "method",
      target,
      resultCarrier,
      genericParameters: genericBindings,
      ...requirements,
    }));
  }
  return Object.freeze({
    members: Object.freeze(members),
    operations: Object.freeze(operations),
  });
}

function projectAssociatedTypes(
  exported: Extract<RustCompilerExport, { readonly kind: "trait" }>,
  context: ProjectionContext,
): {
  readonly declarations: readonly ProviderExportDeclaration[];
  readonly types: readonly RustProviderTypeDefinition[];
} {
  const declarations: ProviderExportDeclaration[] = [];
  const types: RustProviderTypeDefinition[] = [];
  for (const associated of exported.associatedTypes) {
    const self = syntheticAssociatedSelf(exported, associated, context);
    const exportName = compilerAssociatedSourceExportName(
      associated.identity.itemId,
      associated.name,
    );
    const exportId = `${exported.id}::associated-type:${associated.identity.itemId}`;
    const parameters = Object.freeze([
      ...exported.genericParameters,
      self,
      ...associated.genericParameters,
    ]);
    const genericContext = withDefaultGenericBindings(
      withProjectionGenericParameters(context, parameters),
      parameters,
    );
    const associatedContext: ProjectionContext = Object.freeze({
      ...genericContext,
      currentType: Object.freeze({
        exportId,
        name: associated.name,
        carrier: Object.freeze({ kind: "type-parameter", name: self.name }),
        sourceType: Object.freeze({ kind: "type-parameter", name: self.name }),
        genericParameters: parameters,
        canonicalPath: Object.freeze([...exported.canonicalPath, associated.name, "Self"]),
        targetPath: exported.targetPath,
      }),
    });
    const sourceParameters = providerGenericParametersFor(parameters, associatedContext);
    const trait = targetTraitFor(
      traitDispatchFor(exported),
      associatedContext,
      "result",
    );
    const carrier: TargetTypeRef = Object.freeze({
      kind: "associated-type",
      owner: Object.freeze({ kind: "type-parameter", name: self.name }),
      trait,
      name: associated.name,
      ...(associated.genericParameters.length === 0
        ? {}
        : {
            genericArguments: targetGenericParameterArguments(
              associated.genericParameters,
              associatedContext,
            ),
          }),
    });
    declarations.push(Object.freeze({
      id: exportId,
      name: exportName,
      exportName,
      kind: "type",
      type: associated.defaultType === undefined
        ? Object.freeze({ kind: "unknown" })
        : sourceTypeFor(associated.defaultType, associatedContext, "result"),
      typeParameters: sourceParameters,
    }));
    const typeNames = providerTypeParameterNames(parameters, associatedContext);
    types.push(Object.freeze({
      exportId,
      genericParameters: providerGenericBindingsFor(parameters, associatedContext),
      targetCarrier: carrier,
      ...typeRequirements(typeParametersOf(parameters), typeNames),
    }));
  }
  return Object.freeze({
    declarations: Object.freeze(declarations),
    types: Object.freeze(types),
  });
}

function traitDispatchFor(
  exported: Extract<RustCompilerExport, { readonly kind: "trait" }>,
): RustCompilerTraitDispatch {
  const genericArguments = exported.genericParameters.map(
    compilerGenericParameterArgument,
  );
  return Object.freeze({
    identity: Object.freeze({
      itemId: exported.id,
      canonicalPath: exported.canonicalPath,
    }),
    path: exported.targetPath.join("::"),
    genericArguments: Object.freeze(genericArguments),
    associatedConstraints: Object.freeze([]),
  });
}

function compilerGenericParameterArgument(
  parameter: RustCompilerGenericParameter,
): RustCompilerGenericArgument {
  if (parameter.kind === "lifetime") {
    return Object.freeze({ kind: "lifetime", lifetime: parameter.lifetime });
  }
  if (parameter.kind === "type") {
    return Object.freeze({
      kind: "type",
      type: Object.freeze({
        kind: "generic",
        identity: parameter.identity,
        name: parameter.name,
      }),
    });
  }
  return Object.freeze({
    kind: "const",
    value: Object.freeze({
      kind: "parameter",
      identity: parameter.identity,
      name: parameter.name,
    }),
  });
}

function syntheticTraitSelf(
  exported: Extract<RustCompilerExport, { readonly kind: "trait" }>,
  context: ProjectionContext,
): { readonly parameter: RustCompilerTypeParameter; readonly carrier: TargetTypeRef } {
  const name = uniqueGenericName(
    "SelfType",
    sourceGenericParameterNames(exported.genericParameters, context),
  );
  const parameter: RustCompilerTypeParameter = Object.freeze({
    kind: "type",
    identity: Object.freeze({
      itemId: `${exported.id}::implicit-self`,
      canonicalPath: Object.freeze([...exported.canonicalPath, "Self"]),
    }),
    name,
    requirements: Object.freeze([]),
    outlives: Object.freeze([]),
    maybeSized: true,
  });
  return Object.freeze({
    parameter,
    carrier: Object.freeze({ kind: "type-parameter", name }),
  });
}

function syntheticAssociatedSelf(
  exported: Extract<RustCompilerExport, { readonly kind: "trait" }>,
  associated: RustCompilerAssociatedType,
  context: ProjectionContext,
): RustCompilerTypeParameter {
  const occupied = sourceGenericParameterNames(
    [...exported.genericParameters, ...associated.genericParameters],
    withProjectionGenericParameters(context, [
      ...exported.genericParameters,
      ...associated.genericParameters,
    ]),
  );
  const name = uniqueGenericName("SelfType", occupied);
  return Object.freeze({
    kind: "type",
    identity: Object.freeze({
      itemId: `${associated.identity.itemId}::owner`,
      canonicalPath: Object.freeze([...exported.canonicalPath, associated.name, "Self"]),
    }),
    name,
    requirements: associated.ownerRequirements,
    outlives: associated.ownerOutlives,
    maybeSized: associated.ownerMaybeSized,
  });
}

function uniqueGenericName(base: string, occupiedNames: readonly string[]): string {
  const occupied = new Set(occupiedNames);
  let selected = base;
  while (occupied.has(selected)) selected = `_${selected}`;
  return selected;
}

function providerTypeParameterNames(
  parameters: readonly RustCompilerGenericParameter[],
  context: ProjectionContext,
): readonly string[] {
  const bindings = providerGenericBindingsFor(parameters, context);
  return Object.freeze(bindings.flatMap((parameter) =>
    parameter.kind === "type" ? [parameter.sourceName] : []));
}

function typeParametersOf(
  parameters: readonly RustCompilerGenericParameter[],
): readonly RustCompilerTypeParameter[] {
  return Object.freeze(parameters.filter((parameter): parameter is RustCompilerTypeParameter =>
    parameter.kind === "type"));
}

function sourceSignatureSelectionKey(
  signature: ProviderSignatureDeclaration,
): string {
  return JSON.stringify({
    parameters: signature.parameters,
    typeParameters: signature.typeParameters?.map(({ name }) => name) ?? [],
  });
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
