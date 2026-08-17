import { createHash } from "node:crypto";
import type {
  ProviderDeclarationModel,
  ProviderExportDeclaration,
  ProviderMemberDeclaration,
  ProviderParameterDeclaration,
  ProviderSignatureDeclaration,
  ProviderTypeExpression,
} from "@tsonic/tsts";
import type { TargetTypeRef } from "../../policy/types.js";
import type {
  RustProviderModuleDefinition,
  RustProviderOperationDefinition,
  RustProviderTypeParameterRequirement,
  RustProviderTypeDefinition,
} from "../../source/provider-packages/index.js";
import {
  rustConstPointerExport,
  rustMutPointerExport,
} from "../../source/rust-source-semantics/source-extension.js";
import {
  rustTypesModule,
} from "../../source/rust-source-semantics/source-modules.js";
import {
  rustFixedArrayTargetType,
  rustNeverTargetType,
  rustOptionTargetId,
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
  rustUnitTargetType,
} from "../../source/rust-target-types.js";
import type { RustNamedTypeTraitContract } from "../../source/rust-target-types.js";
import { rustBorrowedStrToStringValueConversion } from "../../source/rust-facts/value-conversions.js";
import type {
  RustCompilerAssociatedConstant,
  RustCompilerDependency,
  RustCompilerExport,
  RustCompilerFunction,
  RustCompilerModuleModel,
  RustCompilerType,
  RustCompilerTypeParameter,
  RustCompilerTypeTraits,
  RustCompilerStandardTypeLocation,
} from "./model.js";
import { substituteRustCompilerType } from "./rustdoc-types.js";

export interface RustCompilerProviderProjection {
  readonly declarationModel: ProviderDeclarationModel;
  readonly module: RustProviderModuleDefinition;
  readonly operations: readonly RustProviderOperationDefinition[];
  readonly types: readonly RustProviderTypeDefinition[];
  readonly carrierPaths: ReadonlyMap<string, string>;
  readonly carrierTraits: ReadonlyMap<string, RustNamedTypeTraitContract>;
}

interface ProjectionOwner {
  readonly providerModuleId: string;
  readonly moduleSpecifier: string;
}

interface ProjectionContext {
  readonly dependency: RustCompilerDependency;
  readonly modulePath: readonly string[];
  readonly owner: ProjectionOwner;
  readonly imports: Map<string, Set<string>>;
  readonly carrierPaths: Map<string, string>;
  readonly carrierTraits: Map<string, RustNamedTypeTraitContract>;
  readonly standardTypes: ReadonlyMap<string, RustCompilerStandardTypeLocation>;
  readonly localStandardTypeNames: ReadonlyMap<string, string>;
  readonly defaultTypeBindings?: ReadonlyMap<string, RustCompilerType>;
  readonly currentType?: {
    readonly exportId: string;
    readonly name: string;
    readonly carrier: TargetTypeRef;
    readonly sourceType: ProviderTypeExpression;
    readonly typeParameters: readonly string[];
    readonly canonicalPath: readonly string[];
    readonly targetPath: readonly string[];
  };
}

const sourcePrimitiveByRustName = new Map<string, Parameters<typeof rustSourcePrimitiveTargetType>[0]>([
  ["bool", "bool"],
  ["i8", "int8"],
  ["u8", "uint8"],
  ["i16", "int16"],
  ["u16", "uint16"],
  ["i32", "int32"],
  ["u32", "uint32"],
  ["i64", "int64"],
  ["u64", "uint64"],
  ["i128", "int128"],
  ["u128", "uint128"],
  ["isize", "native-int"],
  ["usize", "native-uint"],
  ["f32", "float32"],
  ["f64", "float64"],
]);

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

function sourceMethodIsInstance(method: RustCompilerFunction): boolean {
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

function projectFunction(
  fn: RustCompilerFunction,
  context: ProjectionContext,
  exportId: string,
  constructor: boolean,
  ownerTargetPath: readonly string[],
): {
  readonly memberId?: string;
  readonly signature: ProviderSignatureDeclaration;
  readonly operation: RustProviderOperationDefinition;
} {
  const instanceMethod = sourceMethodIsInstance(fn);
  const memberId = context.currentType === undefined
    ? undefined
    : `${exportId}::${constructor ? "constructor" : instanceMethod ? "method" : "static"}:${fn.name}`;
  const signatureId = `${memberId ?? exportId}::signature:${functionSignatureDigest(fn)}`;
  const parameters: ProviderParameterDeclaration[] = [];
  const parameterCarriers: TargetTypeRef[] = [];
  const argumentModes: ("value" | "ref" | "mut-ref")[] = [];
  if (fn.receiver?.kind === "custom") {
    const passing = parameterPassing(fn.receiver.type);
    parameters.push(Object.freeze({
      name: "receiver",
      type: sourceTypeFor(passing.type, context, "parameter"),
      ...(passing.sourceMode === "by-value" ? {} : { passingMode: passing.sourceMode }),
    }));
    parameterCarriers.push(targetTypeFor(passing.type, context, "parameter"));
    argumentModes.push(passing.targetMode);
  }
  for (let parameterIndex = 0; parameterIndex < fn.parameters.length; parameterIndex += 1) {
    const parameter = fn.parameters[parameterIndex]!;
    const passing = parameterPassing(parameter.type);
    parameters.push(Object.freeze({
      name: `argument${parameterIndex}`,
      type: sourceTypeFor(passing.type, context, "parameter"),
      ...(passing.sourceMode === "by-value" ? {} : { passingMode: passing.sourceMode }),
    }));
    parameterCarriers.push(targetTypeFor(passing.type, context, "parameter"));
    argumentModes.push(passing.targetMode);
  }
  if (fn.variadic) {
    parameters.push(Object.freeze({
      name: uniqueVariadicParameterName(parameters),
      type: { kind: "array", elementType: { kind: "unknown" } },
      rest: true,
    } satisfies ProviderParameterDeclaration));
  }
  const result = compilerFunctionResult(fn.result);
  const exposedResultType = fn.borrowedResult?.sourceType ?? result.type;
  const resultCarrier = constructor
    ? requireCurrentType(context).carrier
    : targetTypeFor(exposedResultType, context, "result");
  const returnType = constructor ? undefined : sourceTypeFor(exposedResultType, context, "result");
  const resultConversion = fn.borrowedResult === undefined
    ? undefined
    : fn.borrowedResult.conversion === "owned-string"
      ? rustBorrowedStrToStringValueConversion
      : Object.freeze({ kind: "copy-from-reference" as const, target: resultCarrier });
  const methodTypeParameters = uniqueText([
    ...(context.currentType !== undefined && !instanceMethod && !constructor
      ? context.currentType.typeParameters
      : []),
    ...fn.typeParameters.map((parameter) => parameter.name),
  ]);
  const allTypeParameters = uniqueText([
    ...(context.currentType?.typeParameters ?? []),
    ...methodTypeParameters,
  ]);
  const targetTypeArguments = Object.freeze(fn.typeParameters.map(({ name }): TargetTypeRef => Object.freeze({
    kind: "type-parameter",
    name,
  })));
  if (fn.variadic && (context.currentType !== undefined || fn.receiver !== undefined)) {
    throw new Error(`Rust C-variadic function '${fn.name}' must be one free provider function.`);
  }
  const traitTarget = fn.traitDispatch === undefined
    ? undefined
    : {
        form: "trait-call" as const,
        owner: requireCurrentType(context).carrier,
        traitPath: targetTraitPath(fn.traitDispatch.path, context),
        traitTypeArguments: fn.traitDispatch.typeArguments.map((argument) =>
          targetTypeFor(argument, context, "result", true)),
        method: fn.name,
        ...(instanceMethod
          ? {
              receiverMode: fn.receiver?.kind === "value"
                ? "value" as const
                : fn.receiver?.kind === "mutable"
                  ? "mut-ref" as const
                  : "ref" as const,
            }
          : {}),
        ...(argumentModes.every((mode) => mode === "value") ? {} : { argModes: argumentModes }),
      };
  const target = traitTarget ?? (fn.variadic
    ? {
        form: "call-c-variadic" as const,
        path: ownerTargetPath.join("::"),
        fixedArgumentModes: argumentModes,
      }
    : context.currentType === undefined || !instanceMethod
    ? {
        form: "call" as const,
        path: context.currentType === undefined
          ? ownerTargetPath.join("::")
          : [...ownerTargetPath, fn.name].join("::"),
        ...(argumentModes.every((mode) => mode === "value") ? {} : { argModes: argumentModes }),
      }
    : {
        form: "receiver-method" as const,
        name: fn.name,
        ...(argumentModes.every((mode) => mode === "value") ? {} : { argModes: argumentModes }),
        ...(fn.receiver?.kind === "mutable" ? { mutatesReceiver: true } : {}),
      });
  const operation = {
    exportId,
    ...(memberId === undefined ? {} : { memberId }),
    signatureId,
    operationKind: constructor ? "constructor" as const : "method" as const,
    target,
    resultCarrier,
    parameterCarriers,
    ...(context.currentType === undefined || !instanceMethod
      ? {}
      : { receiverCarrier: context.currentType.carrier }),
    ...(allTypeParameters.length === 0 ? {} : { typeParameters: allTypeParameters }),
    ...typeRequirements(fn.typeRequirements, allTypeParameters),
    ...(targetTypeArguments.length === 0 ? {} : { targetTypeArguments }),
    ...(resultConversion === undefined ? {} : { resultConversion }),
    ...(fn.asynchronous ? { isAsync: true as const } : {}),
    ...(fn.unsafe ? { isUnsafe: true as const } : {}),
  };
  return {
    ...(memberId === undefined ? {} : { memberId }),
    signature: Object.freeze({
      id: signatureId,
      name: fn.name,
      parameters: Object.freeze(parameters),
      ...(returnType === undefined ? {} : { returnType }),
      ...(methodTypeParameters.length === 0
        ? {}
        : { typeParameters: Object.freeze(methodTypeParameters.map((name) => Object.freeze({ name }))) }),
    }),
    operation: result.fallible
      ? operationRow({
          ...operation,
          isFallible: true,
          errorBoundary: "target-runtime",
        })
      : operationRow(operation),
  };
}

function selectUnambiguousMembers(
  members: readonly ProviderMemberDeclaration[],
  operations: readonly RustProviderOperationDefinition[],
): {
  readonly members: readonly ProviderMemberDeclaration[];
  readonly operations: readonly RustProviderOperationDefinition[];
} {
  const membersBySourceSlot = new Map<string, ProviderMemberDeclaration[]>();
  for (const member of members) {
    if (typeof member.name !== "string") {
      throw new Error("Rust compiler providers may expose only identifier-named source members.");
    }
    const key = `${member.static === true ? "static" : "instance"}\0${member.name}`;
    const group = membersBySourceSlot.get(key) ?? [];
    group.push(member);
    membersBySourceSlot.set(key, group);
  }
  const ambiguousMemberIds = new Set<string>();
  for (const group of membersBySourceSlot.values()) {
    if (group.length <= 1) {
      continue;
    }
    for (const member of group) {
      ambiguousMemberIds.add(member.id);
    }
  }
  return {
    members: Object.freeze(members.filter((member) => !ambiguousMemberIds.has(member.id))),
    operations: Object.freeze(operations.filter((operation) =>
      operation.memberId === undefined || !ambiguousMemberIds.has(operation.memberId))),
  };
}

function uniqueVariadicParameterName(
  parameters: readonly ProviderParameterDeclaration[],
): string {
  const occupied = new Set(parameters.map((parameter) => parameter.name));
  let name = "variadicArguments";
  while (occupied.has(name)) {
    name = `_${name}`;
  }
  return name;
}

function compilerFunctionResult(type: RustCompilerType): {
  readonly type: RustCompilerType;
  readonly fallible: boolean;
} {
  if (type.kind === "path" && isTsonicResultPath(type)) {
    return { type: type.typeArguments[0]!, fallible: true };
  }
  return { type, fallible: false };
}

function isTsonicResultPath(type: Extract<RustCompilerType, { readonly kind: "path" }>): boolean {
  return type.crateName === "tsonic_rust_runtime" &&
    type.modulePath.length === 1 &&
    type.modulePath[0] === "error" &&
    type.name === "TsonicResult" &&
    type.typeArguments.length === 1;
}

function sourceTypeFor(
  type: RustCompilerType,
  context: ProjectionContext,
  position: "parameter" | "result",
  nested = false,
): ProviderTypeExpression {
  if (type.kind === "generic") {
    const bound = context.defaultTypeBindings?.get(type.name);
    if (bound !== undefined) {
      return sourceTypeFor(bound, context, position, nested);
    }
  }
  if (type.kind === "reference") {
    if (position === "result") {
      throw new Error("Borrowed Rust results require an explicit lifetime-bearing source contract.");
    }
    return sourceTypeFor(type.target, context, position, nested);
  }
  switch (type.kind) {
    case "unit":
      return { kind: "void" };
    case "primitive": {
      if (type.name === "str") {
        return { kind: "string" };
      }
      if (type.name === "never") {
        return { kind: "never" };
      }
      const primitive = sourcePrimitiveByRustName.get(type.name);
      if (primitive === undefined) {
        throw new Error(`Rust primitive '${type.name}' has no source primitive contract.`);
      }
      return { kind: "source-primitive", name: primitive };
    }
    case "generic":
      return { kind: "type-parameter", name: type.name };
    case "self":
      return requireCurrentType(context).sourceType;
    case "tuple":
      return { kind: "tuple", elementTypes: type.elements.map((element) => sourceTypeFor(element, context, position, true)) };
    case "array":
      return { kind: "array", elementType: sourceTypeFor(type.element, context, position, true) };
    case "slice":
      if (position === "result" && !nested) {
        throw new Error("Borrowed Rust slice results require an explicit lifetime-bearing source contract.");
      }
      return { kind: "array", elementType: sourceTypeFor(type.element, context, position, true) };
    case "raw-pointer":
      return importedSourceType(
        context,
        rustTypesModule,
        type.mutable ? rustMutPointerExport : rustConstPointerExport,
        [sourceTypeFor(type.target, context, position, true)],
      );
    case "function-pointer":
      return importedSourceType(context, "@tsonic/core/types.js", "FunctionPointer", [{
          kind: "tuple",
          elementTypes: type.parameters.map((parameter) =>
            sourceTypeFor(parameter, context, position, true)),
        }, sourceTypeFor(type.result, context, position, true)]);
    case "associated-type":
      throw new Error("Unresolved Rust associated type reached source provider projection.");
    case "path": {
      if (isRustStringPath(type)) {
        return { kind: "string" };
      }
      if (isRustOptionPath(type)) {
        const arguments_ = type.typeArguments.map((argument) =>
          sourceTypeFor(argument, context, position, true));
        if (arguments_.length !== 1) {
          throw new Error("Rust Option must carry exactly one source type argument.");
        }
        return { kind: "union", types: [arguments_[0]!, { kind: "undefined" }] };
      }
      const standard = context.standardTypes.get(canonicalCompilerTypePathKey(type));
      if (standard !== undefined) {
        const typeArguments = standardSourceTypeArguments(type, standard, context, position);
        const localName = context.localStandardTypeNames.get(canonicalCompilerTypePathKey(type));
        return importedSourceType(
          context,
          localName === undefined ? standard.sourceModuleSpecifier : context.owner.moduleSpecifier,
          localName ?? standard.sourceExportName,
          typeArguments,
        );
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
        ...(type.typeArguments.length === 0
          ? {}
          : { typeArguments: type.typeArguments.map((argument) => sourceTypeFor(argument, context, position, true)) }),
      };
    }
  }
}

function targetTypeFor(
  type: RustCompilerType,
  context: ProjectionContext,
  position: "parameter" | "result",
  nested = false,
): TargetTypeRef {
  if (type.kind === "generic") {
    const bound = context.defaultTypeBindings?.get(type.name);
    if (bound !== undefined) {
      return targetTypeFor(bound, context, position, nested);
    }
  }
  switch (type.kind) {
    case "unit":
      return rustUnitTargetType();
    case "primitive": {
      if (type.name === "str") {
        return rustStringTargetType();
      }
      if (type.name === "never") {
        return rustNeverTargetType();
      }
      const primitive = sourcePrimitiveByRustName.get(type.name);
      if (primitive === undefined) {
        throw new Error(`Rust primitive '${type.name}' has no target carrier contract.`);
      }
      return rustSourcePrimitiveTargetType(primitive);
    }
    case "generic":
      return { kind: "type-parameter", name: type.name };
    case "self":
      return requireCurrentType(context).carrier;
    case "tuple":
      return { kind: "tuple", elements: type.elements.map((element) => targetTypeFor(element, context, position, true)) };
    case "array":
      return rustFixedArrayTargetType(targetTypeFor(type.element, context, position, true), type.length);
    case "slice":
      if (position === "result" && !nested) {
        throw new Error("Borrowed Rust slice results require an explicit lifetime-bearing target carrier.");
      }
      return nested
        ? { kind: "slice", element: targetTypeFor(type.element, context, position, true) }
        : { kind: "array", element: targetTypeFor(type.element, context, position, true) };
    case "reference":
      return {
        kind: "reference",
        referent: targetTypeFor(type.target, context, "parameter", true),
        mutable: type.mutable,
        ...(type.lifetime === undefined ? {} : { lifetime: type.lifetime }),
      };
    case "raw-pointer":
      return {
        kind: "pointer",
        pointee: targetTypeFor(type.target, context, position, true),
        mutability: type.mutable ? "mut" : "const",
      };
    case "function-pointer":
      return {
        kind: "function-pointer",
        args: type.parameters.map((parameter) =>
          targetTypeFor(parameter, context, position, true)),
        result: targetTypeFor(type.result, context, position, true),
        abi: [providerFunctionPointerAbi(type.abi)],
        ...(type.unsafe ? { isUnsafe: true } : {}),
      };
    case "associated-type":
      throw new Error("Unresolved Rust associated type reached target provider projection.");
    case "path": {
      if (isRustStringPath(type)) {
        return rustStringTargetType();
      }
      if (isRustOptionPath(type)) {
        const arguments_ = type.typeArguments.map((argument) =>
          targetTypeFor(argument, context, position, true));
        if (arguments_.length !== 1) {
          throw new Error("Rust Option must carry exactly one target type argument.");
        }
        return { kind: "target-named", id: rustOptionTargetId, typeArguments: arguments_ };
      }
      const standard = context.standardTypes.get(canonicalCompilerTypePathKey(type));
      if (standard !== undefined) {
        const arguments_ = standardTargetTypeArguments(type, standard, context, position);
        const path = standard.targetPath.join("::");
        recordCarrierPath(context.carrierPaths, standard.targetId, path);
        return {
          kind: "target-named",
          id: standard.targetId,
          ...(arguments_.length === 0 ? {} : { typeArguments: arguments_ }),
        };
      }
      if (type.crateName !== context.dependency.crateName) {
        throw new Error(`External Rust type '${rustCompilerTypeText(type)}' has no target carrier contract.`);
      }
      const canonicalPath = [type.crateName, ...type.modulePath, type.name];
      const id = compilerTargetTypeId(context.dependency, canonicalPath);
      const path = rustPath(context.dependency.targetCrateName, type.modulePath, type.name);
      recordCarrierPath(context.carrierPaths, id, path);
      const typeArguments = type.typeArguments.map((argument) =>
        targetTypeFor(argument, context, position, true));
      return {
        kind: "target-named",
        id,
        ...(typeArguments.length === 0 ? {} : { typeArguments }),
      };
    }
  }
}

function parameterPassing(type: RustCompilerType): {
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

function operationRow(
  operation: RustProviderOperationDefinition,
): RustProviderOperationDefinition {
  return Object.freeze(operation);
}

function materializeImports(
  imports: ReadonlyMap<string, ReadonlySet<string>>,
  currentModule: string,
): NonNullable<RustProviderModuleDefinition["imports"]> {
  return Object.freeze([...imports.entries()]
    .filter(([moduleSpecifier]) => moduleSpecifier !== currentModule)
    .sort(([left], [right]) => compareText(left, right))
    .map(([moduleSpecifier, names]) => Object.freeze({
      moduleSpecifier,
      namedImports: Object.freeze([...names].sort(compareText).map((exportedName) => Object.freeze({ exportedName }))),
    })));
}

function recordCarrierPath(paths: Map<string, string>, id: string, path: string): void {
  const existing = paths.get(id);
  if (existing !== undefined && existing !== path) {
    throw new Error(`Rust compiler target carrier '${id}' maps to both '${existing}' and '${path}'.`);
  }
  paths.set(id, path);
}

function recordCarrierTraits(
  traits: Map<string, RustNamedTypeTraitContract>,
  id: string,
  contract: RustNamedTypeTraitContract,
): void {
  const existing = traits.get(id);
  if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(contract)) {
    throw new Error(`Rust compiler target carrier '${id}' has conflicting native trait contracts.`);
  }
  traits.set(id, contract);
}

function projectCompilerTraitContract(
  contract: RustCompilerTypeTraits,
): RustNamedTypeTraitContract {
  const implementations = contract.implementations.map((implementation) => Object.freeze({
    traitPath: compilerRequirementTraitPath(implementation.trait),
    requirements: Object.freeze(implementation.requirements.map((requirement) => Object.freeze({
      typeArgumentIndex: requirement.typeArgumentIndex,
      traitPath: compilerRequirementTraitPath(requirement.requirement),
    })).sort((left, right) =>
      left.typeArgumentIndex - right.typeArgumentIndex || compareText(left.traitPath, right.traitPath))),
  })).sort((left, right) => compareText(
    `${left.traitPath}\0${JSON.stringify(left.requirements)}`,
    `${right.traitPath}\0${JSON.stringify(right.requirements)}`,
  ));
  return Object.freeze({ implementations: Object.freeze(implementations) });
}

function compilerRequirementTraitPath(
  requirement: RustCompilerTypeParameter["requirements"][number],
): string {
  return requirement === "clone"
    ? "core::clone::Clone"
    : requirement === "copy"
      ? "core::marker::Copy"
      : requirement.path;
}

function typeRequirements(
  parameters: readonly RustCompilerTypeParameter[],
  allowedTypeParameters: readonly string[],
): { readonly typeRequirements?: readonly RustProviderTypeParameterRequirement[] } {
  const allowed = new Set(allowedTypeParameters);
  const requirements = parameters
    .filter((parameter) => allowed.has(parameter.name) && parameter.requirements.length > 0)
    .map((parameter) => Object.freeze({
      name: parameter.name,
      requirements: Object.freeze([...parameter.requirements]
        .sort((left, right) => compareText(typeRequirementKey(left), typeRequirementKey(right)))),
    }))
    .sort((left, right) => compareText(left.name, right.name));
  return requirements.length === 0
    ? {}
    : { typeRequirements: Object.freeze(requirements) };
}

export function compilerModuleSpecifier(alias: string, modulePath: readonly string[]): string {
  const path = modulePath.length === 0 ? "index" : modulePath.join("/");
  return `@tsonic/rust/crates/${alias}/${path}.js`;
}

export function compilerModulePathFromSpecifier(alias: string, specifier: string): readonly string[] | undefined {
  const prefix = `@tsonic/rust/crates/${alias}/`;
  if (!specifier.startsWith(prefix) || !specifier.endsWith(".js")) {
    return undefined;
  }
  const raw = specifier.slice(prefix.length, -3);
  if (raw === "index") {
    return Object.freeze([]);
  }
  const segments = raw.split("/");
  return segments.length > 0 && segments.every((segment) => /^[A-Za-z_][A-Za-z0-9_]*$/u.test(segment))
    ? Object.freeze(segments)
    : undefined;
}

export function compilerProviderVersion(projectDigest: string): string {
  return `1.${projectDigest.slice(0, 32)}`;
}

export function compilerProviderModuleId(dependency: RustCompilerDependency, modulePath: readonly string[]): string {
  return `cargo:${digestText(dependency.packageId).slice(0, 24)}:${modulePath.length === 0 ? "root" : modulePath.join("::")}`;
}

function compilerExportId(dependency: RustCompilerDependency, modulePath: readonly string[], name: string): string {
  return `${dependency.packageId}::${[...modulePath, name].join("::")}`;
}

function compilerTargetTypeId(
  dependency: RustCompilerDependency,
  canonicalPath: readonly string[],
): string {
  return `rust.cargo.${digestText(dependency.packageId).slice(0, 24)}.${canonicalPath.join(".")}`;
}

function rustPath(crateName: string, modulePath: readonly string[], ...tail: readonly string[]): string {
  return [crateName, ...modulePath, ...tail].join("::");
}

function targetTraitPath(path: string, context: ProjectionContext): string {
  const segments = path.split("::");
  if (segments[0] === context.dependency.crateName) {
    segments[0] = context.dependency.targetCrateName;
  }
  return segments.join("::");
}

function functionSignatureDigest(fn: RustCompilerFunction): string {
  return digestText(JSON.stringify(fn)).slice(0, 24);
}

function providerFunctionPointerAbi(abi: string): string {
  if (abi === "Rust") {
    return "target-default";
  }
  if (abi === "C" || abi === "system") {
    return abi;
  }
  throw new Error(`Rust function pointer ABI '${abi}' has no source contract.`);
}

function importedSourceType(
  context: ProjectionContext,
  moduleSpecifier: string,
  exportName: string,
  typeArguments: readonly ProviderTypeExpression[],
): ProviderTypeExpression {
  const names = context.imports.get(moduleSpecifier) ?? new Set<string>();
  names.add(exportName);
  context.imports.set(moduleSpecifier, names);
  return {
    kind: "provider-ref",
    moduleSpecifier,
    exportName,
    typeArguments,
  };
}

function digestText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function requireCurrentType(context: ProjectionContext): NonNullable<ProjectionContext["currentType"]> {
  if (context.currentType === undefined) {
    throw new Error("Rust Self type occurs outside a projected type declaration.");
  }
  return context.currentType;
}

function isRustStringPath(type: Extract<RustCompilerType, { readonly kind: "path" }>): boolean {
  return type.name === "String" &&
    (type.crateName === "alloc" || type.crateName === "std") &&
    type.modulePath[type.modulePath.length - 1] === "string" &&
    type.typeArguments.length === 0;
}

function isRustOptionPath(type: Extract<RustCompilerType, { readonly kind: "path" }>): boolean {
  return type.crateName === "core" &&
    type.modulePath.length === 1 &&
    type.modulePath[0] === "option" &&
    type.name === "Option" &&
    type.typeArguments.length === 1;
}

function standardSourceTypeArguments(
  type: Extract<RustCompilerType, { readonly kind: "path" }>,
  location: RustCompilerStandardTypeLocation,
  context: ProjectionContext,
  position: "parameter" | "result",
): readonly ProviderTypeExpression[] {
  const count = requireStandardSourceTypeArgumentCount(type, location);
  return Object.freeze(type.typeArguments.slice(0, count)
    .map((argument) => sourceTypeFor(argument, context, position, true)));
}

function standardTargetTypeArguments(
  type: Extract<RustCompilerType, { readonly kind: "path" }>,
  location: RustCompilerStandardTypeLocation,
  context: ProjectionContext,
  position: "parameter" | "result",
): readonly TargetTypeRef[] {
  const count = requireStandardSourceTypeArgumentCount(type, location);
  return Object.freeze(type.typeArguments.slice(0, count)
    .map((argument) => targetTypeFor(argument, context, position, true)));
}

function requireStandardSourceTypeArgumentCount(
  type: Extract<RustCompilerType, { readonly kind: "path" }>,
  location: RustCompilerStandardTypeLocation,
): number {
  const count = location.sourceTypeArgumentCount;
  if (type.typeArguments.length < count) {
    throw new Error(
      `Rust standard-library type '${rustCompilerTypeText(type)}' supplies ${type.typeArguments.length} ` +
      `type arguments for source arity ${count}.`,
    );
  }
  return count;
}

function sourceVisibleTypeParameters(
  parameters: readonly RustCompilerTypeParameter[],
): readonly RustCompilerTypeParameter[] {
  const firstDefault = parameters.findIndex((parameter) => parameter.defaultType !== undefined);
  if (firstDefault < 0) {
    return parameters;
  }
  if (parameters.slice(firstDefault).some((parameter) => parameter.defaultType === undefined)) {
    throw new Error("Rust default type parameters must form one trailing source-omittable suffix.");
  }
  return Object.freeze(parameters.slice(0, firstDefault));
}

function withDefaultTypeBindings(
  context: ProjectionContext,
  parameters: readonly RustCompilerTypeParameter[],
): ProjectionContext {
  const firstDefault = parameters.findIndex((parameter) => parameter.defaultType !== undefined);
  if (firstDefault < 0) {
    return context;
  }
  if (parameters.slice(firstDefault).some((parameter) => parameter.defaultType === undefined)) {
    throw new Error("Rust default type parameters must form one trailing source-omittable suffix.");
  }
  const bindings = new Map(context.defaultTypeBindings ?? []);
  for (const parameter of parameters.slice(firstDefault)) {
    const defaultType = parameter.defaultType;
    if (defaultType === undefined) {
      throw new Error(`Rust default type parameter '${parameter.name}' has no default type.`);
    }
    bindings.set(parameter.name, substituteRustCompilerType(defaultType, bindings));
  }
  return { ...context, defaultTypeBindings: bindings };
}

function rustCompilerTypeNamesCurrentType(
  type: RustCompilerType,
  context: ProjectionContext,
): boolean {
  if (type.kind === "self") {
    return true;
  }
  const current = requireCurrentType(context);
  if (type.kind !== "path" ||
    canonicalCompilerTypePathKey(type) !== canonicalPathKey(current.canonicalPath) ||
    type.typeArguments.length < current.typeParameters.length) {
    return false;
  }
  return current.typeParameters.every((name, index) => {
    const argument = type.typeArguments[index];
    return argument?.kind === "generic" && argument.name === name;
  });
}

function canonicalCompilerTypePathKey(
  type: Extract<RustCompilerType, { readonly kind: "path" }>,
): string {
  return canonicalPathKey([type.crateName, ...type.modulePath, type.name]);
}

function canonicalPathKey(path: readonly string[]): string {
  return path.join("\0");
}

function typeRequirementKey(
  requirement: RustCompilerTypeParameter["requirements"][number],
): string {
  return typeof requirement === "string" ? requirement : `trait:${requirement.path}`;
}

function rustCompilerTypeText(type: Extract<RustCompilerType, { readonly kind: "path" }>): string {
  return [type.crateName, ...type.modulePath, type.name].join("::");
}

function uniqueText(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort(compareText));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
