import { canonicalPathKey, compareText, requireCurrentType, rustCompilerTypeNamesCurrentType, sourceVisibleTypeParameters, withDefaultTypeBindings } from "./utilities.js";
import { compilerExportId, compilerTargetTypeId, materializeImports, operationRow, projectCompilerTraitContract, recordCarrierPath, recordCarrierTraits, targetTraitPath, typeRequirements } from "./operations.js";
import { compilerFunctionResult, projectFunction, selectUnambiguousMembers } from "./functions.js";
import { rustUnitTargetType } from "../../../policy/types/target-types.js";
import { sourceTypeFor, targetTypeFor } from "./types.js";
import type {
  ProviderExportDeclaration,
  ProviderMemberDeclaration,
  ProviderParameterDeclaration,
  ProviderSignatureDeclaration,
  ProviderTypeExpression,
} from "@tsonic/tsts";
import type {
  RustCompilerAssociatedConstant,
  RustCompilerExport,
  RustCompilerFunction,
  RustCompilerModuleModel,
  RustCompilerType,
  RustCompilerTypeParameter,
} from "../model/model.js";
import type { ProjectionContext, ProjectionOwner, RustCompilerProviderProjection } from "./model.js";
import type { RustNamedTypeTraitContract } from "../../../target-model/types/model.js";
import type { RustProviderOperationDefinition, RustProviderTypeDefinition } from "../../packages/model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

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
  const carrierTraits = new Map<string, RustNamedTypeTraitContract>();
  const standardTypes = new Map(module.standardTypeLocations.map((location) => [
    canonicalPathKey(location.canonicalPath),
    location,
  ]));
  const localStandardTypeNames = new Map(module.exports
    .filter((exported) => exported.kind === "struct" || exported.kind === "enum" ||
      exported.kind === "union" || exported.kind === "type-alias")
    .map((exported) => [canonicalPathKey(exported.canonicalPath), exported.name]));
  for (const exported of module.exports) {
    const projected = projectExport(exported, {
      dependency: module.dependency,
      modulePath: module.modulePath,
      owner,
      imports,
      carrierPaths,
      carrierTraits,
      standardTypes,
      localStandardTypeNames,
    });
    declarations.push(projected.declaration);
    operations.push(...projected.operations);
    if (projected.type !== undefined) {
      types.push(projected.type);
    }
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
} {
  const exportId = compilerExportId(context.dependency, context.modulePath, exported.name);
  if (exported.kind === "static" && exported.mutable) {
    const sourceType = sourceTypeFor(exported.type, context, "result");
    const targetCarrier = targetTypeFor(exported.type, context, "result");
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
          static: true,
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
          parameterCarriers: [targetCarrier],
          isUnsafe: true,
        }),
      ]),
    };
  }
  if (exported.kind === "constant" || exported.kind === "static") {
    const sourceType = sourceTypeFor(exported.type, context, "result");
    const targetCarrier = targetTypeFor(exported.type, context, "result");
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
        target: {
          form: "path",
          path: exported.targetPath.join("::"),
        },
        resultCarrier: targetCarrier,
        ...(exported.kind === "static" && exported.unsafe ? { isUnsafe: true } : {}),
      })]),
    };
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
  if (exported.kind === "type-alias") {
    const typeParameterNames = sourceVisibleTypeParameters(exported.typeParameters).map((parameter) => parameter.name);
    const typeContext = withDefaultTypeBindings(context, exported.typeParameters);
    const sourceType = sourceTypeFor(exported.type, typeContext, "result");
    const targetCarrier = targetTypeFor(exported.type, typeContext, "result");
    return {
      declaration: Object.freeze({
        id: exportId,
        name: exported.name,
        exportName: exported.name,
        kind: "type",
        type: sourceType,
        ...(typeParameterNames.length === 0
          ? {}
          : { typeParameters: Object.freeze(typeParameterNames.map((name) => Object.freeze({ name }))) }),
      }),
      operations: Object.freeze([]),
      type: Object.freeze({
        exportId,
        targetCarrier,
        ...typeRequirements(exported.typeParameters, typeParameterNames),
      }),
    };
  }
  const typeParameterNames = sourceVisibleTypeParameters(exported.typeParameters).map((parameter) => parameter.name);
  const standardLocation = context.standardTypes.get(canonicalPathKey(exported.canonicalPath));
  const selectedTargetPath = standardLocation?.targetPath ?? exported.targetPath;
  const targetPath = selectedTargetPath.join("::");
  const targetTypeId = standardLocation?.targetId ??
    compilerTargetTypeId(context.dependency, exported.canonicalPath);
  const typeArguments = typeParameterNames.map((name): TargetTypeRef => ({ kind: "type-parameter", name }));
  const sourceTypeArguments = typeParameterNames.map((name): ProviderTypeExpression => ({ kind: "type-parameter", name }));
  recordCarrierPath(context.carrierPaths, targetTypeId, targetPath);
  recordCarrierTraits(
    context.carrierTraits,
    targetTypeId,
    projectCompilerTraitContract(exported.traits),
  );
  const typeCarrier: TargetTypeRef = {
    kind: "target-named",
    id: targetTypeId,
    ...(typeArguments.length === 0 ? {} : { typeArguments }),
  };
  const sourceType: ProviderTypeExpression = {
    kind: "provider-ref",
    moduleSpecifier: context.owner.moduleSpecifier,
    exportName: exported.name,
    ...(sourceTypeArguments.length === 0 ? {} : { typeArguments: sourceTypeArguments }),
  };
  const typeContext: ProjectionContext = {
    ...withDefaultTypeBindings(context, exported.typeParameters),
    currentType: {
      exportId,
      name: exported.name,
      carrier: typeCarrier,
      sourceType,
      typeParameters: typeParameterNames,
      canonicalPath: exported.canonicalPath,
      targetPath: selectedTargetPath,
    },
  };
  const nativeEnumDeclaration = exported.kind === "enum" && exported.variantsComplete &&
    typeParameterNames.length === 0 &&
    exported.variants.every((variant) => variant.kind === "plain") &&
    exported.methods.length === 0 && exported.associatedConstants.length === 0;
  const members: ProviderMemberDeclaration[] = [];
  const operations: RustProviderOperationDefinition[] = [];
  if (exported.kind === "struct" || exported.kind === "union") {
    for (const field of exported.fields) {
      const sourceFieldType = sourceTypeFor(field.type, typeContext, "result");
      const targetFieldType = targetTypeFor(field.type, typeContext, "result");
      const memberId = `${exportId}::field:${field.name}`;
      members.push(Object.freeze({
        id: memberId,
        name: field.name,
        kind: "property",
        type: sourceFieldType,
      }));
      operations.push(operationRow({
        exportId,
        memberId,
        operationKind: "property",
        target: { form: "field", name: field.name },
        resultCarrier: targetFieldType,
        receiverCarrier: typeCarrier,
        typeParameters: typeParameterNames,
        ...typeRequirements(exported.typeParameters, typeParameterNames),
        ...(exported.kind === "union" ? { isUnsafe: true } : {}),
      }));
      operations.push(operationRow({
        exportId,
        memberId,
        operationKind: "property-set",
        target: { form: "field", name: field.name },
        resultCarrier: rustUnitTargetType(),
        parameterCarriers: [targetFieldType],
        receiverCarrier: typeCarrier,
        typeParameters: typeParameterNames,
        ...typeRequirements(exported.typeParameters, typeParameterNames),
      }));
    }
  } else if (exported.variantsComplete) {
    for (const variant of exported.variants) {
      const memberId = `${exportId}::variant:${variant.name}`;
      if (variant.kind === "plain") {
        members.push(Object.freeze({
          id: memberId,
          name: variant.name,
          kind: "field",
          ...(nativeEnumDeclaration ? {} : { static: true, type: sourceType }),
        }));
        operations.push(operationRow({
          exportId,
          memberId,
          operationKind: "property",
          target: {
            form: "path",
            path: [...selectedTargetPath, variant.name].join("::"),
          },
          resultCarrier: typeCarrier,
          typeParameters: typeParameterNames,
          ...typeRequirements(exported.typeParameters, typeParameterNames),
        }));
        continue;
      }
      const parameters = variant.fields.map((field, index): ProviderParameterDeclaration => Object.freeze({
        name: `value${index}`,
        type: sourceTypeFor(field, typeContext, "parameter"),
      }));
      const parameterCarriers = variant.fields.map((field) => targetTypeFor(field, typeContext, "parameter"));
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
          ...(typeParameterNames.length === 0
            ? {}
            : { typeParameters: Object.freeze(typeParameterNames.map((name) => Object.freeze({ name }))) }),
        })]),
      }));
      operations.push(operationRow({
        exportId,
        memberId,
        signatureId,
        operationKind: "method",
        target: {
          form: "call",
          path: [...exported.targetPath, variant.name].join("::"),
        },
        resultCarrier: typeCarrier,
        parameterCarriers,
        typeParameters: typeParameterNames,
        ...typeRequirements(exported.typeParameters, typeParameterNames),
      }));
    }
  }
  const projectedMethods = projectTypeMethods(
    exported.methods,
    exported.kind,
    exported.typeParameters.map((parameter) => parameter.name),
    typeContext,
    exportId,
    selectedTargetPath,
  );
  members.push(...projectedMethods.members);
  operations.push(...projectedMethods.operations);
  const projectedConstants = projectAssociatedConstants(
    exported.associatedConstants,
    typeParameterNames,
    exported.typeParameters,
    typeContext,
    exportId,
  );
  members.push(...projectedConstants.members);
  operations.push(...projectedConstants.operations);
  const unambiguous = selectUnambiguousMembers(members, operations);
  const declaration: ProviderExportDeclaration = Object.freeze({
    id: exportId,
    name: exported.name,
    exportName: exported.name,
    kind: nativeEnumDeclaration ? "enum" : "class",
    ...(typeParameterNames.length === 0
      ? {}
      : { typeParameters: Object.freeze(typeParameterNames.map((name) => Object.freeze({ name }))) }),
    members: unambiguous.members,
  });
  return {
    declaration,
    operations: unambiguous.operations,
    type: Object.freeze({
      exportId,
      targetCarrier: typeCarrier,
      ...typeRequirements(exported.typeParameters, typeParameterNames),
    }),
  };
}

function projectTypeMethods(
  methods: readonly RustCompilerFunction[],
  ownerKind: "struct" | "enum" | "union",
  allOwnerTypeParameters: readonly string[],
  context: ProjectionContext,
  exportId: string,
  ownerTargetPath: readonly string[],
): {
  readonly members: readonly ProviderMemberDeclaration[];
  readonly operations: readonly RustProviderOperationDefinition[];
} {
  const projected = methods.flatMap((method) => {
    const methodTypeParameters = method.typeParameters.map((parameter) => parameter.name);
    const allowedMethodTypeParameters = new Set([...allOwnerTypeParameters, ...methodTypeParameters]);
    if (!compilerFunctionUsesOnlyTypeParameters(method, allowedMethodTypeParameters)) {
      return [];
    }
    const result = compilerFunctionResult(method.result);
    const constructor = ownerKind === "struct" && method.receiver === undefined &&
      method.traitDispatch === undefined && method.name === "new" && method.typeParameters.length === 0 &&
      rustCompilerTypeNamesCurrentType(result.type, context);
    const value = projectFunction(method, context, exportId, constructor, ownerTargetPath);
    return [{ method, constructor, value }];
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
    const selected = group.filter((entry) =>
      counts.get(sourceSignatureSelectionKey(entry.value.signature)) === 1);
    if (selected.length === 0) {
      continue;
    }
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
  ownerTypeParameters: readonly string[],
  ownerTypeParameterContracts: readonly RustCompilerTypeParameter[],
  context: ProjectionContext,
  exportId: string,
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
  for (const constant of constants) {
    if (nameCounts.get(constant.name) !== 1 ||
      !compilerTypeUsesOnlyTypeParameters(
        constant.type,
        new Set(ownerTypeParameterContracts.map((parameter) => parameter.name)),
      )) {
      continue;
    }
    const memberId = `${exportId}::trait-constant:${constant.name}`;
    const resultCarrier = targetTypeFor(constant.type, context, "result");
    const sourceType = sourceTypeFor(constant.type, context, "result");
    const target = {
      form: "trait-associated-value" as const,
      owner: requireCurrentType(context).carrier,
      traitPath: targetTraitPath(constant.traitDispatch.path, context),
      traitTypeArguments: constant.traitDispatch.typeArguments.map((argument) =>
        targetTypeFor(argument, context, "result", true)),
      name: constant.name,
    };
    if (ownerTypeParameters.length === 0) {
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
        ...typeRequirements(constant.typeRequirements, ownerTypeParameters),
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
        typeParameters: Object.freeze(ownerTypeParameters.map((name) => Object.freeze({ name }))),
      })]),
    }));
    operations.push(operationRow({
      exportId,
      memberId,
      signatureId,
      operationKind: "method",
      target,
      resultCarrier,
      typeParameters: ownerTypeParameters,
      ...typeRequirements(
        [...ownerTypeParameterContracts, ...constant.typeRequirements],
        ownerTypeParameters,
      ),
    }));
  }
  return { members: Object.freeze(members), operations: Object.freeze(operations) };
}

function sourceSignatureSelectionKey(signature: ProviderSignatureDeclaration): string {
  return JSON.stringify({
    parameters: signature.parameters,
    typeParameters: signature.typeParameters?.map(({ name }) => name) ?? [],
  });
}

export function sourceMethodIsInstance(method: RustCompilerFunction): boolean {
  return method.receiver?.kind === "value" || method.receiver?.kind === "shared" ||
    method.receiver?.kind === "mutable";
}

function compilerFunctionUsesOnlyTypeParameters(
  fn: RustCompilerFunction,
  allowed: ReadonlySet<string>,
): boolean {
  return fn.parameters.every((parameter) => compilerTypeUsesOnlyTypeParameters(parameter.type, allowed)) &&
    compilerTypeUsesOnlyTypeParameters(fn.result, allowed) &&
    (fn.receiver?.kind !== "custom" ||
      compilerTypeUsesOnlyTypeParameters(fn.receiver.type, allowed)) &&
    (fn.borrowedResult === undefined ||
      compilerTypeUsesOnlyTypeParameters(fn.borrowedResult.sourceType, allowed)) &&
    (fn.traitDispatch === undefined || fn.traitDispatch.typeArguments.every((argument) =>
      compilerTypeUsesOnlyTypeParameters(argument, allowed)));
}

function compilerTypeUsesOnlyTypeParameters(
  type: RustCompilerType,
  allowed: ReadonlySet<string>,
): boolean {
  switch (type.kind) {
    case "generic":
      return allowed.has(type.name);
    case "tuple":
      return type.elements.every((element) => compilerTypeUsesOnlyTypeParameters(element, allowed));
    case "array":
    case "slice":
      return compilerTypeUsesOnlyTypeParameters(type.element, allowed);
    case "reference":
    case "raw-pointer":
      return compilerTypeUsesOnlyTypeParameters(type.target, allowed);
    case "associated-type":
      return compilerTypeUsesOnlyTypeParameters(type.owner, allowed) &&
        type.trait.typeArguments.every((argument) =>
          compilerTypeUsesOnlyTypeParameters(argument, allowed));
    case "function-pointer":
      return type.parameters.every((parameter) => compilerTypeUsesOnlyTypeParameters(parameter, allowed)) &&
        compilerTypeUsesOnlyTypeParameters(type.result, allowed);
    case "path":
      return type.typeArguments.every((argument) => compilerTypeUsesOnlyTypeParameters(argument, allowed));
    case "unit":
    case "primitive":
    case "self":
      return true;
  }
}
