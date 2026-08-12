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
  rustIsizeTargetType,
  rustOptionTargetId,
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
  rustUnitTargetType,
  rustUsizeTargetType,
} from "../../source/rust-target-types.js";
import {
  rustStdCollectionsModule,
  rustStdHashMapTargetId,
  rustStdHashSetTargetId,
  rustStdVecModule,
  rustStdVecTargetId,
} from "./std-catalog.js";
import type {
  RustCompilerDependency,
  RustCompilerExport,
  RustCompilerFunction,
  RustCompilerModuleModel,
  RustCompilerType,
} from "./model.js";

export interface RustCompilerProviderProjection {
  readonly declarationModel: ProviderDeclarationModel;
  readonly module: RustProviderModuleDefinition;
  readonly operations: readonly RustProviderOperationDefinition[];
  readonly types: readonly RustProviderTypeDefinition[];
  readonly carrierPaths: ReadonlyMap<string, string>;
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
  readonly currentType?: {
    readonly exportId: string;
    readonly name: string;
    readonly carrier: TargetTypeRef;
    readonly sourceType: ProviderTypeExpression;
    readonly typeParameters: readonly string[];
  };
}

const sourcePrimitiveByRustName = new Map<string, Parameters<typeof rustSourcePrimitiveTargetType>[0]>([
  ["bool", "bool"],
  ["char", "char"],
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
  for (const exported of module.exports) {
    const projected = projectExport(exported, {
      dependency: module.dependency,
      modulePath: module.modulePath,
      owner,
      imports,
      carrierPaths,
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
  if (exported.kind === "function") {
    const projected = projectFunction(exported.function, context, exportId, false);
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
  const typeParameterNames = exported.typeParameters.map((parameter) => parameter.name);
  const targetPath = rustPath(context.dependency.targetCrateName, context.modulePath, exported.name);
  const targetTypeId = compilerTargetTypeId(context.dependency, context.modulePath, exported.name);
  const typeArguments = typeParameterNames.map((name): TargetTypeRef => ({ kind: "type-parameter", name }));
  const sourceTypeArguments = typeParameterNames.map((name): ProviderTypeExpression => ({ kind: "type-parameter", name }));
  recordCarrierPath(context.carrierPaths, targetTypeId, targetPath);
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
    ...context,
    currentType: {
      exportId,
      name: exported.name,
      carrier: typeCarrier,
      sourceType,
      typeParameters: typeParameterNames,
    },
  };
  const members: ProviderMemberDeclaration[] = [];
  const operations: RustProviderOperationDefinition[] = [];
  for (const field of exported.fields) {
    const sourceFieldType = sourceTypeFor(field.type, typeContext, "result");
    const targetFieldType = targetTypeFor(field.type, typeContext, "result");
    const memberId = `${exportId}::field:${field.name}`;
    members.push(Object.freeze({
      id: memberId,
      name: field.name,
      kind: "field",
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
    }));
  }
  for (const method of exported.methods) {
    const constructor = method.receiver === undefined && method.name === "new" && method.result.kind === "self";
    const projected = projectFunction(method, typeContext, exportId, constructor);
    members.push(Object.freeze({
      id: projected.memberId!,
      name: constructor ? "constructor" : method.name,
      kind: constructor ? "constructor" : "method",
      ...(method.receiver === undefined && !constructor ? { static: true } : {}),
      signatures: Object.freeze([projected.signature]),
    }));
    operations.push(projected.operation);
  }
  const declaration: ProviderExportDeclaration = Object.freeze({
    id: exportId,
    name: exported.name,
    exportName: exported.name,
    kind: "class",
    ...(typeParameterNames.length === 0
      ? {}
      : { typeParameters: Object.freeze(typeParameterNames.map((name) => Object.freeze({ name }))) }),
    members: Object.freeze(members),
  });
  return {
    declaration,
    operations: Object.freeze(operations),
    type: Object.freeze({
      exportId,
      targetCarrier: typeCarrier,
    }),
  };
}

function projectFunction(
  fn: RustCompilerFunction,
  context: ProjectionContext,
  exportId: string,
  constructor: boolean,
): {
  readonly memberId?: string;
  readonly signature: ProviderSignatureDeclaration;
  readonly operation: RustProviderOperationDefinition;
} {
  const memberId = context.currentType === undefined
    ? undefined
    : `${exportId}::${constructor ? "constructor" : fn.receiver === undefined ? "static" : "method"}:${fn.name}`;
  const signatureId = `${memberId ?? exportId}::signature:${functionSignatureDigest(fn)}`;
  const parameters: ProviderParameterDeclaration[] = [];
  const parameterCarriers: TargetTypeRef[] = [];
  const argumentModes: ("value" | "ref" | "mut-ref")[] = [];
  for (const parameter of fn.parameters) {
    const passing = parameterPassing(parameter.type);
    parameters.push(Object.freeze({
      name: parameter.name,
      type: sourceTypeFor(passing.type, context, "parameter"),
      ...(passing.sourceMode === "by-value" ? {} : { passingMode: passing.sourceMode }),
    }));
    parameterCarriers.push(targetTypeFor(passing.type, context, "parameter"));
    argumentModes.push(passing.targetMode);
  }
  const resultCarrier = constructor
    ? requireCurrentType(context).carrier
    : targetTypeFor(fn.result, context, "result");
  const returnType = constructor ? undefined : sourceTypeFor(fn.result, context, "result");
  const methodTypeParameters = fn.typeParameters.map((parameter) => parameter.name);
  const allTypeParameters = uniqueText([
    ...(context.currentType?.typeParameters ?? []),
    ...methodTypeParameters,
  ]);
  const target = context.currentType === undefined || fn.receiver === undefined
    ? {
        form: "call" as const,
        path: rustPath(context.dependency.targetCrateName, context.modulePath, ...(context.currentType === undefined
          ? [fn.name]
          : [context.currentType.name, fn.name])),
        ...(argumentModes.every((mode) => mode === "value") ? {} : { argModes: argumentModes }),
      }
    : {
        form: "receiver-method" as const,
        name: fn.name,
        ...(argumentModes.every((mode) => mode === "value") ? {} : { argModes: argumentModes }),
        ...(fn.receiver === "mutable" ? { mutatesReceiver: true } : {}),
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
    operation: operationRow({
      exportId,
      ...(memberId === undefined ? {} : { memberId }),
      signatureId,
      operationKind: constructor ? "constructor" : "method",
      target,
      resultCarrier,
      parameterCarriers,
      ...(context.currentType === undefined || fn.receiver === undefined
        ? {}
        : { receiverCarrier: context.currentType.carrier }),
      ...(allTypeParameters.length === 0 ? {} : { typeParameters: allTypeParameters }),
      ...(fn.asynchronous ? { isAsync: true } : {}),
      ...(fn.unsafe ? { isUnsafe: true } : {}),
    }),
  };
}

function sourceTypeFor(
  type: RustCompilerType,
  context: ProjectionContext,
  position: "parameter" | "result",
): ProviderTypeExpression {
  if (type.kind === "reference") {
    if (position === "result") {
      throw new Error("Borrowed Rust results require an explicit lifetime-bearing source contract.");
    }
    return sourceTypeFor(type.target, context, position);
  }
  switch (type.kind) {
    case "unit":
      return { kind: "void" };
    case "primitive": {
      if (type.name === "str") {
        return { kind: "string" };
      }
      if (type.name === "isize") {
        return { kind: "source-primitive", name: "native-int" };
      }
      if (type.name === "usize") {
        return { kind: "source-primitive", name: "native-uint" };
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
      return { kind: "tuple", elementTypes: type.elements.map((element) => sourceTypeFor(element, context, position)) };
    case "array":
      return { kind: "array", elementType: sourceTypeFor(type.element, context, position) };
    case "slice":
      if (position === "result") {
        throw new Error("Borrowed Rust slice results require an explicit lifetime-bearing source contract.");
      }
      return { kind: "array", elementType: sourceTypeFor(type.element, context, position) };
    case "raw-pointer":
      return importedSourceType(
        context,
        rustTypesModule,
        type.mutable ? rustMutPointerExport : rustConstPointerExport,
        [sourceTypeFor(type.target, context, position)],
      );
    case "function-pointer":
      return importedSourceType(context, "@tsonic/core/types.js", "FunctionPointer", [{
          kind: "tuple",
          elementTypes: type.parameters.map((parameter) =>
            sourceTypeFor(parameter, context, position)),
        }, sourceTypeFor(type.result, context, position)]);
    case "path": {
      if (isRustStringPath(type)) {
        return { kind: "string" };
      }
      const standard = standardSourceType(type, context, position);
      if (standard !== undefined) {
        return standard;
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
          : { typeArguments: type.typeArguments.map((argument) => sourceTypeFor(argument, context, position)) }),
      };
    }
  }
}

function targetTypeFor(
  type: RustCompilerType,
  context: ProjectionContext,
  position: "parameter" | "result",
): TargetTypeRef {
  if (type.kind === "reference") {
    if (position === "result") {
      throw new Error("Borrowed Rust results require an explicit lifetime-bearing target carrier.");
    }
    return targetTypeFor(type.target, context, position);
  }
  switch (type.kind) {
    case "unit":
      return rustUnitTargetType();
    case "primitive": {
      if (type.name === "str") {
        return rustStringTargetType();
      }
      if (type.name === "isize") {
        return rustIsizeTargetType();
      }
      if (type.name === "usize") {
        return rustUsizeTargetType();
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
      return { kind: "tuple", elements: type.elements.map((element) => targetTypeFor(element, context, position)) };
    case "array":
      return rustFixedArrayTargetType(targetTypeFor(type.element, context, position), type.length);
    case "slice":
      throw new Error("Rust slice parameters require a dedicated slice carrier contract.");
    case "raw-pointer":
      return {
        kind: "pointer",
        pointee: targetTypeFor(type.target, context, position),
        mutability: type.mutable ? "mut" : "const",
      };
    case "function-pointer":
      return {
        kind: "function-pointer",
        args: type.parameters.map((parameter) =>
          targetTypeFor(parameter, context, position)),
        result: targetTypeFor(type.result, context, position),
        abi: [providerFunctionPointerAbi(type.abi)],
        ...(type.unsafe ? { isUnsafe: true } : {}),
      };
    case "path": {
      if (isRustStringPath(type)) {
        return rustStringTargetType();
      }
      const standard = standardTargetType(type, context, position);
      if (standard !== undefined) {
        return standard;
      }
      if (type.crateName !== context.dependency.crateName) {
        throw new Error(`External Rust type '${rustCompilerTypeText(type)}' has no target carrier contract.`);
      }
      const id = compilerTargetTypeId(context.dependency, type.modulePath, type.name);
      const path = rustPath(context.dependency.targetCrateName, type.modulePath, type.name);
      recordCarrierPath(context.carrierPaths, id, path);
      const typeArguments = type.typeArguments.map((argument) =>
        targetTypeFor(argument, context, position));
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

function compilerTargetTypeId(dependency: RustCompilerDependency, modulePath: readonly string[], name: string): string {
  return `rust.cargo.${digestText(dependency.packageId).slice(0, 24)}.${[...modulePath, name].join(".")}`;
}

function rustPath(crateName: string, modulePath: readonly string[], ...tail: readonly string[]): string {
  return [crateName, ...modulePath, ...tail].join("::");
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

function standardSourceType(
  type: Extract<RustCompilerType, { readonly kind: "path" }>,
  context: ProjectionContext,
  position: "parameter" | "result",
): ProviderTypeExpression | undefined {
  const kind = rustStandardTypeKind(type);
  if (kind === undefined) {
    return undefined;
  }
  const arguments_ = type.typeArguments.map((argument) => sourceTypeFor(argument, context, position));
  switch (kind) {
    case "option":
      return arguments_.length === 1
        ? { kind: "union", types: [arguments_[0]!, { kind: "undefined" }] }
        : undefined;
    case "vec":
      if (arguments_.length !== 1) {
        return undefined;
      }
      {
        const names = context.imports.get(rustStdVecModule) ?? new Set<string>();
        names.add("Vec");
        context.imports.set(rustStdVecModule, names);
      }
      return {
        kind: "provider-ref",
        moduleSpecifier: rustStdVecModule,
        exportName: "Vec",
        typeArguments: arguments_,
      };
    case "hash-map":
    case "hash-set": {
      const exportName = kind === "hash-map" ? "HashMap" : "HashSet";
      const names = context.imports.get(rustStdCollectionsModule) ?? new Set<string>();
      names.add(exportName);
      context.imports.set(rustStdCollectionsModule, names);
      return {
        kind: "provider-ref",
        moduleSpecifier: rustStdCollectionsModule,
        exportName,
        typeArguments: arguments_,
      };
    }
  }
}

function standardTargetType(
  type: Extract<RustCompilerType, { readonly kind: "path" }>,
  context: ProjectionContext,
  position: "parameter" | "result",
): TargetTypeRef | undefined {
  const kind = rustStandardTypeKind(type);
  if (kind === undefined) {
    return undefined;
  }
  const arguments_ = type.typeArguments.map((argument) => targetTypeFor(argument, context, position));
  switch (kind) {
    case "option":
      return arguments_.length === 1
        ? { kind: "target-named", id: rustOptionTargetId, typeArguments: arguments_ }
        : undefined;
    case "vec":
      if (arguments_.length !== 1) {
        return undefined;
      }
      recordCarrierPath(context.carrierPaths, rustStdVecTargetId, "std::vec::Vec");
      return { kind: "target-named", id: rustStdVecTargetId, typeArguments: arguments_ };
    case "hash-map":
    case "hash-set": {
      const id = kind === "hash-map" ? rustStdHashMapTargetId : rustStdHashSetTargetId;
      const path = kind === "hash-map" ? "std::collections::HashMap" : "std::collections::HashSet";
      recordCarrierPath(context.carrierPaths, id, path);
      return { kind: "target-named", id, typeArguments: arguments_ };
    }
  }
}

type RustStandardTypeKind = "option" | "vec" | "hash-map" | "hash-set";

const rustStandardTypePolicies: readonly {
  readonly kind: RustStandardTypeKind;
  readonly crateName: string;
  readonly modulePath: readonly string[];
  readonly name: string;
  readonly arity: number;
}[] = Object.freeze([
  { kind: "option", crateName: "core", modulePath: ["option"], name: "Option", arity: 1 },
  { kind: "vec", crateName: "alloc", modulePath: ["vec"], name: "Vec", arity: 1 },
  { kind: "hash-map", crateName: "std", modulePath: ["collections", "hash", "map"], name: "HashMap", arity: 2 },
  { kind: "hash-set", crateName: "std", modulePath: ["collections", "hash", "set"], name: "HashSet", arity: 1 },
]);

function rustStandardTypeKind(
  type: Extract<RustCompilerType, { readonly kind: "path" }>,
): RustStandardTypeKind | undefined {
  return rustStandardTypePolicies.find((policy) =>
    policy.crateName === type.crateName &&
    policy.name === type.name &&
    policy.arity === type.typeArguments.length &&
    policy.modulePath.length === type.modulePath.length &&
    policy.modulePath.every((segment, index) => segment === type.modulePath[index]))?.kind;
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
