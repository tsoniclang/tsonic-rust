import type {
  ProviderExportDeclaration,
  ProviderMemberDeclaration,
  ProviderParameterDeclaration,
  ProviderSignatureDeclaration,
  ProviderTypeExpression,
  ProviderTypeParameterDeclaration,
} from "@tsonic/tsts";
import type { TargetTypeRef } from "../../policy/types.js";
import { rustTargetTypeRefEquals } from "../../policy/equality.js";
import type { RustProviderPackageDefinition } from "./index.js";
import type {
  RustProviderConstantArgument,
  RustProviderOperationForm,
  RustValueConversion,
} from "../rust-facts/keys.js";
import { rustValueConversionContract } from "../rust-facts/value-conversions.js";
import {
  isRustBinaryOperator,
  rustBinaryOperatorTraitPath,
} from "../../common/rust-syntax.js";
import {
  rustBigIntTargetId,
  rustFixedArrayCarrierValue,
  rustJsArrayTargetId,
  rustJsDateTargetId,
  rustJsMapTargetId,
  rustJsSetTargetId,
  rustJsValueTargetId,
  rustOptionTargetId,
  rustUndefinedTargetId,
  rustPrimitiveTypeName,
  rustStringTargetId,
  rustIsizeTargetId,
  rustUsizeTargetId,
} from "../rust-target-types.js";
import { rustProviderOperationFormContractViolation } from "../rust-facts/operation-form-contract.js";
import { isClosedMetadata } from "../../common/closed-metadata.js";

type Fail = (message: string) => never;

interface ExportRecord {
  readonly moduleSpecifier: string;
  readonly declaration: ProviderExportDeclaration;
}

interface MemberRecord {
  readonly exportId: string;
  readonly declaration: ProviderMemberDeclaration;
}

interface SignatureRecord {
  readonly exportId: string;
  readonly memberId?: string;
  readonly declaration: ProviderSignatureDeclaration;
}

const builtInTargetCarrierIds = new Set([
  rustBigIntTargetId,
  rustStringTargetId,
  rustIsizeTargetId,
  rustUsizeTargetId,
  rustOptionTargetId,
  rustUndefinedTargetId,
  rustJsValueTargetId,
  rustJsArrayTargetId,
  rustJsMapTargetId,
  rustJsSetTargetId,
  rustJsDateTargetId,
  "rust.js.JsRegExp",
  "rust.js.JsRegExpMatch",
]);

const rustIdentifierPattern = /^(?:r#)?[A-Za-z_][A-Za-z0-9_]*$/u;
const rustPathPattern = /^(?:r#)?[A-Za-z_][A-Za-z0-9_]*(?:::(?:r#)?[A-Za-z_][A-Za-z0-9_]*)*$/u;

export function validateProviderPackageDefinition(definition: RustProviderPackageDefinition): void {
  const fail: Fail = (message) => {
    throw new Error(`Provider package '${definition.id}': ${message}`);
  };
  if (!isClosedMetadata(definition)) {
    fail("package metadata must be dense, finite, acyclic plain data");
  }
  requireNonEmpty(definition.id, "package id", fail);
  requireNonEmpty(definition.displayName, "display name", fail);
  requireNonEmpty(definition.version, "version", fail);
  requireExactKeys(asRecord(definition), [
    "id", "displayName", "version", "requiredSurfaces", "modules", "types", "operations", "crates",
    "aliasImports", "carrierPaths",
  ], "package", fail);

  const modulesBySpecifier = new Map<string, RustProviderPackageDefinition["modules"][number]>();
  const modulesByProviderId = new Map<string, RustProviderPackageDefinition["modules"][number]>();
  const exportsById = new Map<string, ExportRecord>();
  const membersById = new Map<string, MemberRecord>();
  const signaturesById = new Map<string, SignatureRecord>();
  const exportNamesByModule = new Map<string, Set<string>>();

  for (const module of definition.modules) {
    requireExactKeys(asRecord(module), ["moduleSpecifier", "providerModuleId", "imports", "exports"], "module", fail);
    requireNonEmpty(module.moduleSpecifier, "module specifier", fail);
    requireNonEmpty(module.providerModuleId, `provider module id for '${module.moduleSpecifier}'`, fail);
    if (modulesBySpecifier.has(module.moduleSpecifier)) {
      fail(`duplicate module '${module.moduleSpecifier}'`);
    }
    if (modulesByProviderId.has(module.providerModuleId)) {
      fail(`duplicate provider module id '${module.providerModuleId}'`);
    }
    modulesBySpecifier.set(module.moduleSpecifier, module);
    modulesByProviderId.set(module.providerModuleId, module);
    const exportNames = new Set<string>();
    exportNamesByModule.set(module.moduleSpecifier, exportNames);
    for (const exported of module.exports) {
      validateExportDeclaration(exported, fail);
      requireNonEmpty(exported.id, `export id in '${module.moduleSpecifier}'`, fail);
      requireNonEmpty(exported.name, `export name for '${exported.id}'`, fail);
      if (exportsById.has(exported.id)) {
        fail(`duplicate export id '${exported.id}'`);
      }
      if (exportNames.has(exported.name)) {
        fail(`duplicate export name '${exported.name}' in '${module.moduleSpecifier}'`);
      }
      exportsById.set(exported.id, { moduleSpecifier: module.moduleSpecifier, declaration: exported });
      exportNames.add(exported.name);
      recordSignatures(exported.signatures, exported.id, undefined, signaturesById, fail);
      for (const member of exported.members ?? []) {
        requireNonEmpty(member.id, `member id on '${exported.id}'`, fail);
        if (membersById.has(member.id)) {
          fail(`duplicate member id '${member.id}'`);
        }
        membersById.set(member.id, { exportId: exported.id, declaration: member });
        recordSignatures(member.signatures, exported.id, member.id, signaturesById, fail);
      }
    }
  }

  for (const module of definition.modules) {
    const importedExports = validateImports(module, modulesBySpecifier, exportNamesByModule, fail);
    for (const exported of module.exports) {
      walkExportTypes(exported, module.moduleSpecifier, importedExports, exportNamesByModule, fail);
    }
  }

  validateCrates(definition, fail);
  validateAliases(definition, fail);
  validateCarrierPaths(definition, fail);
  validateTypeRelations(definition, exportsById, fail);
  validateOperationRows(definition, exportsById, membersById, signaturesById, fail);
}

function recordSignatures(
  signatures: readonly ProviderSignatureDeclaration[] | undefined,
  exportId: string,
  memberId: string | undefined,
  records: Map<string, SignatureRecord>,
  fail: Fail,
): void {
  for (const signature of signatures ?? []) {
    validateSignatureDeclaration(signature, fail);
    requireNonEmpty(signature.id, `signature id on '${memberId ?? exportId}'`, fail);
    if (records.has(signature.id)) {
      fail(`duplicate signature id '${signature.id}'`);
    }
    records.set(signature.id, { exportId, ...(memberId === undefined ? {} : { memberId }), declaration: signature });
  }
}

function validateImports(
  module: RustProviderPackageDefinition["modules"][number],
  modulesBySpecifier: ReadonlyMap<string, RustProviderPackageDefinition["modules"][number]>,
  exportNamesByModule: ReadonlyMap<string, ReadonlySet<string>>,
  fail: Fail,
): ReadonlyMap<string, ReadonlySet<string>> {
  const importedExports = new Map<string, Set<string>>();
  for (const imported of module.imports ?? []) {
    requireExactKeys(asRecord(imported), ["moduleSpecifier", "namedImports"], `import in '${module.moduleSpecifier}'`, fail);
    requireNonEmpty(imported.moduleSpecifier, `import module specifier in '${module.moduleSpecifier}'`, fail);
    if (!modulesBySpecifier.has(imported.moduleSpecifier)) {
      fail(`module '${module.moduleSpecifier}' imports from undeclared module '${imported.moduleSpecifier}'`);
    }
    const names = importedExports.get(imported.moduleSpecifier) ?? new Set<string>();
    importedExports.set(imported.moduleSpecifier, names);
    for (const named of imported.namedImports) {
      requireExactKeys(asRecord(named), ["exportedName"], `import from '${imported.moduleSpecifier}'`, fail);
      requireNonEmpty(named.exportedName, `imported export name from '${imported.moduleSpecifier}'`, fail);
      if (exportNamesByModule.get(imported.moduleSpecifier)?.has(named.exportedName) !== true) {
        fail(`module '${module.moduleSpecifier}' imports undeclared export '${named.exportedName}' from '${imported.moduleSpecifier}'`);
      }
      if (names.has(named.exportedName)) {
        fail(`module '${module.moduleSpecifier}' imports '${named.exportedName}' from '${imported.moduleSpecifier}' more than once`);
      }
      names.add(named.exportedName);
    }
  }
  return importedExports;
}

function walkExportTypes(
  exported: ProviderExportDeclaration,
  moduleSpecifier: string,
  importedExports: ReadonlyMap<string, ReadonlySet<string>>,
  exportNamesByModule: ReadonlyMap<string, ReadonlySet<string>>,
  fail: Fail,
): void {
  walkType(exported.type, moduleSpecifier, importedExports, exportNamesByModule, `${exported.id}.type`, fail);
  walkTypeParameters(exported.typeParameters, moduleSpecifier, importedExports, exportNamesByModule, `${exported.id}.typeParameters`, fail);
  for (const heritage of exported.heritage ?? []) {
    walkType(heritage.type, moduleSpecifier, importedExports, exportNamesByModule, `${exported.id}.heritage`, fail);
  }
  for (const member of exported.members ?? []) {
    walkType(member.type, moduleSpecifier, importedExports, exportNamesByModule, `${member.id}.type`, fail);
    walkSignatures(member.signatures, moduleSpecifier, importedExports, exportNamesByModule, member.id, fail);
  }
  walkSignatures(exported.signatures, moduleSpecifier, importedExports, exportNamesByModule, exported.id, fail);
}

function walkSignatures(
  signatures: readonly ProviderSignatureDeclaration[] | undefined,
  moduleSpecifier: string,
  importedExports: ReadonlyMap<string, ReadonlySet<string>>,
  exportNamesByModule: ReadonlyMap<string, ReadonlySet<string>>,
  owner: string,
  fail: Fail,
): void {
  for (const signature of signatures ?? []) {
    walkParameters(signature.parameters, moduleSpecifier, importedExports, exportNamesByModule, `${owner}.${signature.id}`, fail);
    walkType(signature.returnType, moduleSpecifier, importedExports, exportNamesByModule, `${owner}.${signature.id}.returnType`, fail);
    walkTypeParameters(signature.typeParameters, moduleSpecifier, importedExports, exportNamesByModule, `${owner}.${signature.id}.typeParameters`, fail);
  }
}

function walkParameters(
  parameters: readonly ProviderParameterDeclaration[],
  moduleSpecifier: string,
  importedExports: ReadonlyMap<string, ReadonlySet<string>>,
  exportNamesByModule: ReadonlyMap<string, ReadonlySet<string>>,
  owner: string,
  fail: Fail,
): void {
  for (const parameter of parameters) {
    validateParameterDeclaration(parameter, fail);
    walkType(parameter.type, moduleSpecifier, importedExports, exportNamesByModule, `${owner}.${parameter.name}`, fail);
    walkType(parameter.defaultType, moduleSpecifier, importedExports, exportNamesByModule, `${owner}.${parameter.name}.defaultType`, fail);
  }
}

function walkTypeParameters(
  parameters: readonly ProviderTypeParameterDeclaration[] | undefined,
  moduleSpecifier: string,
  importedExports: ReadonlyMap<string, ReadonlySet<string>>,
  exportNamesByModule: ReadonlyMap<string, ReadonlySet<string>>,
  owner: string,
  fail: Fail,
): void {
  for (const parameter of parameters ?? []) {
    requireExactKeys(asRecord(parameter), ["name", "constraints", "defaultType", "variance"], `${owner}.typeParameter`, fail);
    requireNonEmpty(parameter.name, `${owner}.typeParameter.name`, fail);
    if (parameter.variance !== undefined && parameter.variance !== "in" && parameter.variance !== "out" &&
      parameter.variance !== "invariant" && parameter.variance !== "target-defined") {
      fail(`${owner}.typeParameter '${parameter.name}' has unsupported variance '${String(parameter.variance)}'`);
    }
    for (const constraint of parameter.constraints ?? []) {
      walkType(constraint, moduleSpecifier, importedExports, exportNamesByModule, `${owner}.${parameter.name}.constraint`, fail);
    }
    walkType(parameter.defaultType, moduleSpecifier, importedExports, exportNamesByModule, `${owner}.${parameter.name}.defaultType`, fail);
  }
}

function walkType(
  type: ProviderTypeExpression | undefined,
  moduleSpecifier: string,
  importedExports: ReadonlyMap<string, ReadonlySet<string>>,
  exportNamesByModule: ReadonlyMap<string, ReadonlySet<string>>,
  where: string,
  fail: Fail,
): void {
  if (type === undefined) {
    return;
  }
  const record = asRecord(type);
  switch (type.kind) {
    case "any":
    case "unknown":
    case "void":
    case "never":
    case "undefined":
    case "boolean":
    case "string":
    case "number":
    case "bigint":
    case "object":
      requireExactKeys(record, ["kind"], where, fail);
      return;
    case "source-primitive":
      requireExactKeys(record, ["kind", "name"], where, fail);
      if (rustPrimitiveTypeName(type.name) === undefined) {
        fail(`${where} uses source primitive '${type.name}' with no Rust source carrier`);
      }
      return;
    case "source-global":
      requireExactKeys(record, ["kind", "name", "typeArguments"], where, fail);
      requireNonEmpty(type.name, `${where}.name`, fail);
      for (const argument of type.typeArguments ?? []) {
        walkType(argument, moduleSpecifier, importedExports, exportNamesByModule, `${where}.typeArgument`, fail);
      }
      return;
    case "type-parameter":
      requireExactKeys(record, ["kind", "name"], where, fail);
      requireNonEmpty(type.name, `${where}.name`, fail);
      return;
    case "provider-ref": {
      requireExactKeys(record, ["kind", "moduleSpecifier", "exportName", "localName", "namespaceImport", "typeArguments"], where, fail);
      requireNonEmpty(type.moduleSpecifier, `${where}.moduleSpecifier`, fail);
      requireNonEmpty(type.exportName, `${where}.exportName`, fail);
      if (type.localName !== undefined) {
        requireNonEmpty(type.localName, `${where}.localName`, fail);
      }
      if (type.namespaceImport !== undefined) {
        requireNonEmpty(type.namespaceImport, `${where}.namespaceImport`, fail);
      }
      const declared = exportNamesByModule.get(type.moduleSpecifier)?.has(type.exportName) === true;
      const inScope = type.moduleSpecifier === moduleSpecifier || importedExports.get(type.moduleSpecifier)?.has(type.exportName) === true;
      if (!declared || !inScope) {
        fail(`${where} references provider export '${type.moduleSpecifier}::${type.exportName}' without a matching declaration and import`);
      }
      for (const argument of type.typeArguments ?? []) {
        walkType(argument, moduleSpecifier, importedExports, exportNamesByModule, `${where}.typeArgument`, fail);
      }
      return;
    }
    case "array":
      requireExactKeys(record, ["kind", "elementType"], where, fail);
      walkType(type.elementType, moduleSpecifier, importedExports, exportNamesByModule, `${where}.elementType`, fail);
      return;
    case "tuple":
      requireExactKeys(record, ["kind", "elementTypes"], where, fail);
      for (const element of type.elementTypes) {
        walkType(element, moduleSpecifier, importedExports, exportNamesByModule, `${where}.elementType`, fail);
      }
      return;
    case "union":
    case "intersection":
      requireExactKeys(record, ["kind", "types"], where, fail);
      for (const member of type.types) {
        walkType(member, moduleSpecifier, importedExports, exportNamesByModule, `${where}.member`, fail);
      }
      return;
    case "function":
      requireExactKeys(record, ["kind", "id", "parameters", "returnType", "typeParameters"], where, fail);
      requireNonEmpty(type.id, `${where}.id`, fail);
      walkParameters(type.parameters, moduleSpecifier, importedExports, exportNamesByModule, where, fail);
      walkType(type.returnType, moduleSpecifier, importedExports, exportNamesByModule, `${where}.returnType`, fail);
      walkTypeParameters(type.typeParameters, moduleSpecifier, importedExports, exportNamesByModule, `${where}.typeParameters`, fail);
      return;
    case "literal":
      requireExactKeys(record, ["kind", "value"], where, fail);
      if (type.value !== null && typeof type.value !== "string" && typeof type.value !== "number" && typeof type.value !== "boolean") {
        fail(`${where}.value is not a supported provider literal`);
      }
      return;
  }
}

function validateExportDeclaration(exported: ProviderExportDeclaration, fail: Fail): void {
  requireExactKeys(asRecord(exported), [
    "id", "name", "exportName", "exportKind", "sourceTypeFamily", "kind", "type",
    "typeParameters", "heritage", "members", "signatures", "documentation",
  ], `export '${String((exported as { readonly id?: unknown }).id)}'`, fail);
  if (!["type", "value", "namespace", "function", "class", "interface", "enum"].includes(exported.kind)) {
    fail(`export '${exported.id}' has unsupported declaration kind '${String(exported.kind)}'`);
  }
  if (exported.exportKind !== undefined && exported.exportKind !== "named" && exported.exportKind !== "default") {
    fail(`export '${exported.id}' has unsupported export kind '${String(exported.exportKind)}'`);
  }
  if (exported.sourceTypeFamily !== undefined) {
    requireExactKeys(asRecord(exported.sourceTypeFamily), ["exportName", "typeArgumentCount"], `${exported.id}.sourceTypeFamily`, fail);
    requireNonEmpty(exported.sourceTypeFamily.exportName, `${exported.id}.sourceTypeFamily.exportName`, fail);
    if (!Number.isSafeInteger(exported.sourceTypeFamily.typeArgumentCount) || exported.sourceTypeFamily.typeArgumentCount < 0) {
      fail(`${exported.id}.sourceTypeFamily.typeArgumentCount must be a non-negative safe integer`);
    }
  }
  for (const heritage of exported.heritage ?? []) {
    requireExactKeys(asRecord(heritage), ["kind", "type"], `${exported.id}.heritage`, fail);
    if (heritage.kind !== "extends" && heritage.kind !== "implements") {
      fail(`${exported.id}.heritage has unsupported kind '${String(heritage.kind)}'`);
    }
  }
  for (const member of exported.members ?? []) {
    validateMemberDeclaration(member, exported.id, fail);
  }
}

function validateMemberDeclaration(member: ProviderMemberDeclaration, owner: string, fail: Fail): void {
  requireExactKeys(asRecord(member), [
    "id", "name", "kind", "static", "readonly", "optional", "type", "signatures", "documentation",
  ], `${owner}.member`, fail);
  if (!["method", "constructor", "property", "field", "indexer"].includes(member.kind)) {
    fail(`${owner}.member '${member.id}' has unsupported kind '${String(member.kind)}'`);
  }
  validateProviderPropertyName(member.name, `${owner}.member '${member.id}'.name`, fail);
}

function validateProviderPropertyName(name: ProviderMemberDeclaration["name"], where: string, fail: Fail): void {
  if (typeof name === "string") {
    requireNonEmpty(name, where, fail);
    return;
  }
  const record = asRecord(name);
  if (name.kind === "identifier" || name.kind === "string-literal") {
    requireExactKeys(record, ["kind", "text"], where, fail);
    requireNonEmpty(name.text, `${where}.text`, fail);
    return;
  }
  if (name.kind === "number-literal") {
    requireExactKeys(record, ["kind", "value"], where, fail);
    if (!Number.isFinite(name.value)) {
      fail(`${where}.value must be finite`);
    }
    return;
  }
  if (name.kind === "well-known-symbol") {
    requireExactKeys(record, ["kind", "name"], where, fail);
    const names = new Set(["asyncIterator", "hasInstance", "isConcatSpreadable", "iterator", "match", "matchAll", "replace", "search", "species", "split", "toPrimitive", "toStringTag", "unscopables"]);
    if (!names.has(name.name)) {
      fail(`${where}.name has unsupported well-known symbol '${String(name.name)}'`);
    }
    return;
  }
  fail(`${where} has unsupported provider property-name kind '${String((name as { readonly kind?: unknown }).kind)}'`);
}

function validateSignatureDeclaration(signature: ProviderSignatureDeclaration, fail: Fail): void {
  requireExactKeys(asRecord(signature), ["id", "name", "parameters", "returnType", "typeParameters", "documentation"], `signature '${String((signature as { readonly id?: unknown }).id)}'`, fail);
  requireNonEmpty(signature.id, "signature id", fail);
  if (signature.name !== undefined) {
    requireNonEmpty(signature.name, `${signature.id}.name`, fail);
  }
}

function validateParameterDeclaration(parameter: ProviderParameterDeclaration, fail: Fail): void {
  requireExactKeys(asRecord(parameter), ["name", "type", "passingMode", "optional", "rest", "defaultType"], `parameter '${String((parameter as { readonly name?: unknown }).name)}'`, fail);
  requireNonEmpty(parameter.name, "parameter name", fail);
  const passingModes = new Set(["by-value", "byref-readonly", "byref-readwrite", "byref-writeonly-must-init", "borrow-shared", "borrow-mut", "move"]);
  if (parameter.passingMode !== undefined && !passingModes.has(parameter.passingMode)) {
    fail(`parameter '${parameter.name}' has unsupported passing mode '${String(parameter.passingMode)}'`);
  }
  if (parameter.rest === true && parameter.optional === true) {
    fail(`parameter '${parameter.name}' cannot be both rest and optional`);
  }
}

function validateCrates(definition: RustProviderPackageDefinition, fail: Fail): void {
  const crateNames = new Set<string>();
  for (const crate of definition.crates) {
    requireExactKeys(asRecord(crate), ["crateName", "cargoPath", "registryPatch"], "crate", fail);
    requireRustIdentifier(crate.crateName, "crate name", fail);
    requireNonEmpty(crate.cargoPath, `cargo path for '${crate.crateName}'`, fail);
    if (crate.registryPatch !== undefined && crate.registryPatch !== "crates-io") {
      fail(`crate '${crate.crateName}' has unsupported registry patch '${String(crate.registryPatch)}'`);
    }
    if (crateNames.has(crate.crateName)) {
      fail(`duplicate crate name '${crate.crateName}'`);
    }
    crateNames.add(crate.crateName);
  }
}

function validateAliases(definition: RustProviderPackageDefinition, fail: Fail): void {
  const aliases = new Set<string>();
  for (const aliasImport of definition.aliasImports ?? []) {
    requireExactKeys(asRecord(aliasImport), ["alias", "path"], "alias import", fail);
    requireRustIdentifier(aliasImport.alias, "alias import", fail);
    requireRustPath(aliasImport.path, `path for alias '${aliasImport.alias}'`, fail);
    if (aliases.has(aliasImport.alias)) {
      fail(`duplicate alias import '${aliasImport.alias}'`);
    }
    aliases.add(aliasImport.alias);
  }
}

function validateCarrierPaths(definition: RustProviderPackageDefinition, fail: Fail): void {
  for (const [carrierId, path] of Object.entries(definition.carrierPaths ?? {})) {
    requireNonEmpty(carrierId, "carrier id", fail);
    requireRustPath(path, `path for carrier '${carrierId}'`, fail);
  }
}

function validateTypeRelations(
  definition: RustProviderPackageDefinition,
  exportsById: ReadonlyMap<string, ExportRecord>,
  fail: Fail,
): void {
  const relatedExports = new Set<string>();
  for (const relation of definition.types ?? []) {
    requireExactKeys(asRecord(relation), ["exportId", "targetTypeId"], "type relation", fail);
    requireNonEmpty(relation.exportId, "type relation export id", fail);
    requireNonEmpty(relation.targetTypeId, `target type id for '${relation.exportId}'`, fail);
    if (!exportsById.has(relation.exportId)) {
      fail(`type relation targets undeclared exportId '${relation.exportId}'`);
    }
    if (relatedExports.has(relation.exportId)) {
      fail(`export '${relation.exportId}' has more than one Rust target type relation`);
    }
    relatedExports.add(relation.exportId);
    if (!builtInTargetCarrierIds.has(relation.targetTypeId) && definition.carrierPaths?.[relation.targetTypeId] === undefined) {
      fail(`export '${relation.exportId}' target type '${relation.targetTypeId}' has no closed Rust carrier path`);
    }
  }
}

function validateOperationRows(
  definition: RustProviderPackageDefinition,
  exportsById: ReadonlyMap<string, ExportRecord>,
  membersById: ReadonlyMap<string, MemberRecord>,
  signaturesById: ReadonlyMap<string, SignatureRecord>,
  fail: Fail,
): void {
  const rowKeys = new Set<string>();
  for (const row of definition.operations) {
    requireExactKeys(asRecord(row), [
      "exportId", "memberId", "signatureId", "operationKind", "target", "resultCarrier",
      "parameterCarriers", "resultConversion", "isAsync", "isFallible",
    ], `operation row '${String((row as { readonly memberId?: unknown; readonly exportId?: unknown }).memberId ?? row.exportId)}'`, fail);
    const label = row.memberId ?? row.exportId;
    if (row.operationKind !== "method" && row.operationKind !== "constructor" &&
      row.operationKind !== "property" && row.operationKind !== "indexer") {
      fail(`row '${String(label)}' has unsupported operation kind '${String(row.operationKind)}'`);
    }
    const exported = exportsById.get(row.exportId);
    if (exported === undefined) {
      fail(`row '${label}' targets undeclared exportId '${row.exportId}'`);
    }
    const member = row.memberId === undefined ? undefined : membersById.get(row.memberId);
    if (row.memberId !== undefined && (member === undefined || member.exportId !== row.exportId)) {
      fail(`row '${label}' targets memberId '${row.memberId}' outside export '${row.exportId}'`);
    }
    const signature = row.signatureId === undefined ? undefined : signaturesById.get(row.signatureId);
    if (row.signatureId !== undefined && (signature === undefined || signature.exportId !== row.exportId ||
      (row.memberId !== undefined && signature.memberId !== row.memberId))) {
      fail(`row '${label}' targets signatureId '${row.signatureId}' outside its selected declaration`);
    }
    if (row.memberId === undefined && row.operationKind === "property" &&
      exported?.declaration.kind !== "value") {
      fail(`row '${label}' declares a provider value operation for non-value export kind '${String(exported?.declaration.kind)}'`);
    }
    if (row.memberId === undefined && exported?.declaration.kind === "value" &&
      row.operationKind !== "property") {
      fail(`row '${label}' must represent provider value export '${row.exportId}' as a property operation`);
    }
    const rowKey = [row.exportId, row.memberId ?? "", row.signatureId ?? "", row.operationKind].join("\u0000");
    if (rowKeys.has(rowKey)) {
      fail(`duplicate operation selector row '${label}' for '${row.operationKind}'`);
    }
    rowKeys.add(rowKey);
    if (row.isFallible !== undefined && typeof row.isFallible !== "boolean") {
      fail(`isFallible must be boolean when present (row '${label}').`);
    }
    if (row.isAsync !== undefined && typeof row.isAsync !== "boolean") {
      fail(`isAsync must be boolean when present (row '${label}').`);
    }
    if (row.isFallible === true && row.operationKind !== "method" && row.operationKind !== "constructor" && row.operationKind !== "property") {
      fail(`isFallible is supported only on method, constructor, and property operations (row '${label}').`);
    }
    if (row.isAsync === true && row.operationKind !== "method") {
      fail(`isAsync is supported only on method operations (row '${label}').`);
    }
    validateOperationParameters(row, exported, member, signature, fail);
    validateCarrier(row.resultCarrier, definition, `${label}.resultCarrier`, fail);
    for (const [index, carrier] of (row.parameterCarriers ?? []).entries()) {
      validateCarrier(carrier, definition, `${label}.parameterCarriers[${index}]`, fail);
    }
    if (row.resultConversion !== undefined) {
      validateValueConversion(row.resultConversion, definition, `${label}.resultConversion`, undefined, row.resultCarrier, fail);
    }
    validateOperationForm(row.operationKind, row.target, definition, label, row.parameterCarriers, fail);
    const operationFormContractViolation = rustProviderOperationFormContractViolation(
      row.operationKind,
      row.target,
      row.target.form === "call-value-slice" || row.target.form === "receiver-value-array"
        ? row.target.leadingArguments.length
        : row.parameterCarriers?.length ?? 0,
    );
    if (operationFormContractViolation !== undefined) {
      fail(`${label}.target violates the closed Rust operation-form contract: ${operationFormContractViolation}`);
    }
  }
}

function validateOperationParameters(
  row: RustProviderPackageDefinition["operations"][number],
  exported: ExportRecord | undefined,
  member: MemberRecord | undefined,
  signature: SignatureRecord | undefined,
  fail: Fail,
): void {
  if (row.operationKind === "property" || row.target.form === "call-str-slice") {
    return;
  }
  const ownerSignatures = signature === undefined
    ? row.memberId === undefined
      ? exported?.declaration.signatures ?? []
      : member?.declaration.signatures ?? []
    : [signature.declaration];
  if (ownerSignatures.length === 0) {
    return;
  }
  if (row.target.form === "call-value-slice" || row.target.form === "receiver-value-array") {
    const leadingArgumentCount = row.target.leadingArguments.length;
    if (ownerSignatures.some((candidate) => candidate.parameters.length < leadingArgumentCount)) {
      fail(`row '${row.memberId ?? row.exportId}' declares ${leadingArgumentCount} leading target arguments but its selected source signature has fewer parameters`);
    }
    return;
  }
  const counts = new Set(ownerSignatures.map((candidate) => candidate.parameters.length));
  if (counts.size !== 1) {
    fail(`row '${row.memberId ?? row.exportId}' spans signatures with different parameter counts; declare exact signatureId rows`);
  }
  const [expectedCount] = counts;
  const actualCount = row.parameterCarriers?.length ?? 0;
  if (actualCount !== expectedCount) {
    fail(`row '${row.memberId ?? row.exportId}' declares ${actualCount} target parameter carriers for ${expectedCount} selected source parameters`);
  }
}

function validateOperationForm(
  operationKind: RustProviderPackageDefinition["operations"][number]["operationKind"],
  form: RustProviderOperationForm,
  definition: RustProviderPackageDefinition,
  label: string,
  parameterCarriers: readonly TargetTypeRef[] | undefined,
  fail: Fail,
): void {
  void operationKind;
  const record = form as unknown as Readonly<Record<string, unknown>>;
  switch (form.form) {
    case "marker":
      requireExactKeys(record, ["form"], `${label}.target`, fail);
      return;
    case "call":
      requireExactKeys(record, ["form", "path", "argModes", "argConversions", "argOrder", "trailingArguments", "chain"], `${label}.target`, fail);
      requireRustPath(form.path, `${label}.target.path`, fail);
      validateArgumentMetadata(form, definition, label, parameterCarriers, fail);
      validateTrailingArguments(form.trailingArguments, label, fail);
      validateChain(form.chain, label, fail);
      return;
    case "call-str-slice":
    case "path":
      requireExactKeys(record, ["form", "path"], `${label}.target`, fail);
      requireRustPath(form.path, `${label}.target.path`, fail);
      return;
    case "call-value-slice":
      requireExactKeys(record, ["form", "path", "leadingArguments", "elementCarrier"], `${label}.target`, fail);
      requireRustPath(form.path, `${label}.target.path`, fail);
      validateValueSliceArguments(form, definition, label, fail);
      return;
    case "receiver-value-array":
      requireExactKeys(record, ["form", "name", "receiverMode", "leadingArguments", "elementCarrier"], `${label}.target`, fail);
      requireRustIdentifier(form.name, `${label}.target.name`, fail);
      if (form.receiverMode !== "value" && form.receiverMode !== "ref" && form.receiverMode !== "mut-ref") {
        fail(`${label}.target.receiverMode contains unsupported mode '${String(form.receiverMode)}'`);
      }
      validateValueSliceArguments(form, definition, label, fail);
      return;
    case "method":
    case "arg-method":
    case "field":
      requireExactKeys(record, ["form", "name"], `${label}.target`, fail);
      requireRustIdentifier(form.name, `${label}.target.name`, fail);
      return;
    case "arg-receiver-method":
      requireExactKeys(record, ["form", "name", "argModes"], `${label}.target`, fail);
      requireRustIdentifier(form.name, `${label}.target.name`, fail);
      validateModes(form.argModes, label, parameterCarriers?.length, fail);
      return;
    case "index":
      requireExactKeys(record, ["form", "indexConversion"], `${label}.target`, fail);
      if (form.indexConversion !== undefined) {
        validateValueConversion(
          form.indexConversion,
          definition,
          `${label}.target.indexConversion`,
          parameterCarriers?.[0],
          undefined,
          fail,
        );
      }
      return;
    case "free-call":
      requireExactKeys(record, ["form", "path", "receiverMode", "argModes", "argConversions", "trailingArguments", "argOrder"], `${label}.target`, fail);
      requireRustPath(form.path, `${label}.target.path`, fail);
      if (form.receiverMode !== "value" && form.receiverMode !== "ref" && form.receiverMode !== "mut-ref") {
        fail(`${label}.target.receiverMode contains unsupported mode '${String(form.receiverMode)}'`);
      }
      validateArgumentMetadata(form, definition, label, parameterCarriers, fail);
      validateTrailingArguments(form.trailingArguments, label, fail);
      return;
    case "binary-operator":
      requireExactKeys(record, ["form", "operator", "trait"], `${label}.target`, fail);
      if (!isRustBinaryOperator(form.operator)) {
        fail(`${label}.target.operator '${String(form.operator)}' is not a Rust binary operator`);
      }
      requireRustPath(form.trait, `${label}.target.trait`, fail);
      if (isRustBinaryOperator(form.operator)) {
        const expectedTrait = rustBinaryOperatorTraitPath(form.operator);
        const actualTrait = expandValidationAlias(form.trait, definition.aliasImports);
        if (expectedTrait === undefined || actualTrait !== expectedTrait) {
          fail(`${label}.target operator '${form.operator}' requires exact trait '${expectedTrait ?? "<unsupported>"}', received '${actualTrait}'`);
        }
      }
      return;
    case "receiver-method":
      requireExactKeys(record, ["form", "name", "argModes", "argConversions", "argOrder", "chain", "mutatesReceiver"], `${label}.target`, fail);
      requireRustIdentifier(form.name, `${label}.target.name`, fail);
      if (form.mutatesReceiver !== undefined && typeof form.mutatesReceiver !== "boolean") {
        fail(`${label}.target.mutatesReceiver must be boolean when present`);
      }
      validateArgumentMetadata(form, definition, label, parameterCarriers, fail);
      validateChain(form.chain, label, fail);
      return;
    default:
      fail(`${label}.target has unsupported operation form '${String((form as { readonly form?: unknown }).form)}'`);
  }
}

function validateValueSliceArguments(
  form: Extract<RustProviderOperationForm, { readonly form: "call-value-slice" | "receiver-value-array" }>,
  definition: RustProviderPackageDefinition,
  label: string,
  fail: Fail,
): void {
  if (!Array.isArray(form.leadingArguments)) {
    fail(`${label}.target.leadingArguments must be a dense array`);
  }
  for (const [index, argument] of form.leadingArguments.entries()) {
    requireExactKeys(argument, ["carrier", "mode"], `${label}.target.leadingArguments[${index}]`, fail);
    validateCarrier(argument.carrier, definition, `${label}.target.leadingArguments[${index}].carrier`, fail);
    if (argument.mode !== "value" && argument.mode !== "ref" && argument.mode !== "mut-ref") {
      fail(`${label}.target.leadingArguments[${index}].mode contains unsupported mode '${String(argument.mode)}'`);
    }
  }
  validateCarrier(form.elementCarrier, definition, `${label}.target.elementCarrier`, fail);
}

function expandValidationAlias(
  path: string,
  aliases: RustProviderPackageDefinition["aliasImports"],
): string {
  const separator = path.indexOf("::");
  const root = separator < 0 ? path : path.slice(0, separator);
  const replacement = aliases?.find((entry) => entry.alias === root)?.path;
  return replacement === undefined
    ? path
    : separator < 0 ? replacement : `${replacement}${path.slice(separator)}`;
}

function validateArgumentMetadata(
  form: Extract<RustProviderOperationForm, { readonly form: "call" | "free-call" | "receiver-method" }>,
  definition: RustProviderPackageDefinition,
  label: string,
  parameterCarriers: readonly TargetTypeRef[] | undefined,
  fail: Fail,
): void {
  const parameterCount = parameterCarriers?.length;
  validateModes(form.argModes, label, parameterCount, fail);
  if (parameterCount !== undefined && form.argConversions !== undefined && form.argConversions.length > parameterCount) {
    fail(`${label}.target.argConversions has ${form.argConversions.length} entries for ${parameterCount} parameters`);
  }
  for (const [targetIndex, conversion] of (form.argConversions ?? []).entries()) {
    if (conversion !== undefined) {
      const sourceIndex = form.argOrder?.[targetIndex] ?? targetIndex;
      validateValueConversion(
        conversion,
        definition,
        `${label}.target.argConversions[${targetIndex}]`,
        parameterCarriers?.[sourceIndex],
        undefined,
        fail,
      );
    }
  }
  if (form.argOrder !== undefined) {
    if (parameterCount !== undefined && form.argOrder.length !== parameterCount) {
      fail(`${label}.target.argOrder must contain exactly ${parameterCount} parameter indexes`);
    }
    const indexes = new Set<number>();
    for (const index of form.argOrder) {
      if (!Number.isSafeInteger(index) || index < 0 || (parameterCount !== undefined && index >= parameterCount) || indexes.has(index)) {
        fail(`${label}.target.argOrder is not a valid parameter permutation`);
      }
      indexes.add(index);
    }
  }
}

function validateModes(
  modes: readonly unknown[] | undefined,
  label: string,
  parameterCount: number | undefined,
  fail: Fail,
): void {
  if (parameterCount !== undefined && modes !== undefined && modes.length !== parameterCount) {
    fail(`${label}.target.argModes must contain exactly ${parameterCount} entries when present`);
  }
  for (const mode of modes ?? []) {
    if (mode !== "value" && mode !== "ref" && mode !== "mut-ref") {
      fail(`${label}.target.argModes contains unsupported mode '${String(mode)}'`);
    }
  }
}

function validateTrailingArguments(
  arguments_: readonly RustProviderConstantArgument[] | undefined,
  label: string,
  fail: Fail,
): void {
  for (const [index, argument] of (arguments_ ?? []).entries()) {
    const record = argument as unknown as Readonly<Record<string, unknown>>;
    if (argument.kind === "integer") {
      requireExactKeys(record, ["kind", "value"], `${label}.target.trailingArguments[${index}]`, fail);
      if (!Number.isSafeInteger(argument.value)) {
        fail(`${label}.target.trailingArguments[${index}] must contain a safe integer`);
      }
      continue;
    }
    if (argument.kind === "string") {
      requireExactKeys(record, ["kind", "value"], `${label}.target.trailingArguments[${index}]`, fail);
      if (typeof argument.value !== "string") {
        fail(`${label}.target.trailingArguments[${index}] must contain a string`);
      }
      continue;
    }
    if (argument.kind === "boolean") {
      requireExactKeys(record, ["kind", "value"], `${label}.target.trailingArguments[${index}]`, fail);
      if (typeof argument.value !== "boolean") {
        fail(`${label}.target.trailingArguments[${index}] must contain a boolean`);
      }
      continue;
    }
    if (argument.kind === "none") {
      requireExactKeys(record, ["kind"], `${label}.target.trailingArguments[${index}]`, fail);
      continue;
    }
    fail(`${label}.target.trailingArguments[${index}] has unsupported kind '${String((argument as { readonly kind?: unknown }).kind)}'`);
  }
}

function validateChain(
  chain: Extract<RustProviderOperationForm, { readonly form: "call" | "receiver-method" }>["chain"],
  label: string,
  fail: Fail,
): void {
  for (const [index, step] of (chain ?? []).entries()) {
    const record = step as unknown as Readonly<Record<string, unknown>>;
    if (step.kind === "copy-selected-carrier") {
      requireExactKeys(record, ["kind"], `${label}.target.chain[${index}]`, fail);
      continue;
    }
    if (step.kind !== "method") {
      fail(`${label}.target.chain[${index}] must be a structured provider chain step`);
    }
    requireExactKeys(record, ["kind", "name"], `${label}.target.chain[${index}]`, fail);
    requireRustIdentifier(step.name, `${label}.target.chain[${index}].name`, fail);
  }
}

function validateCarrier(
  carrier: TargetTypeRef,
  definition: RustProviderPackageDefinition,
  where: string,
  fail: Fail,
): void {
  const record = carrier as unknown as Readonly<Record<string, unknown>>;
  switch (carrier.kind) {
    case "source-primitive":
      requireExactKeys(record, ["kind", "name"], where, fail);
      if (rustPrimitiveTypeName(carrier.name) === undefined) {
        fail(`${where} uses source primitive '${carrier.name}' with no Rust carrier`);
      }
      return;
    case "target-named":
      requireExactKeys(record, ["kind", "id", "typeArguments"], where, fail);
      requireNonEmpty(carrier.id, `${where}.id`, fail);
      if (!builtInTargetCarrierIds.has(carrier.id) && definition.carrierPaths?.[carrier.id] === undefined) {
        fail(`${where} names target carrier '${carrier.id}' without a Rust carrier path`);
      }
      for (const [index, argument] of (carrier.typeArguments ?? []).entries()) {
        validateCarrier(argument, definition, `${where}.typeArguments[${index}]`, fail);
      }
      return;
    case "type-parameter":
      requireExactKeys(record, ["kind", "name"], where, fail);
      requireRustIdentifier(carrier.name, `${where}.name`, fail);
      return;
    case "array":
      requireExactKeys(record, ["kind", "element", "rank"], where, fail);
      if (carrier.rank !== undefined && carrier.rank !== 1) {
        fail(`${where} has unsupported Rust array rank '${carrier.rank}'`);
      }
      validateCarrier(carrier.element, definition, `${where}.element`, fail);
      return;
    case "tuple":
      requireExactKeys(record, ["kind", "elements"], where, fail);
      for (const [index, element] of carrier.elements.entries()) {
        validateCarrier(element, definition, `${where}.elements[${index}]`, fail);
      }
      return;
    case "pointer":
      requireExactKeys(record, ["kind", "pointee", "mutability"], where, fail);
      if (carrier.pointee.kind === "target-named" && carrier.pointee.id === rustStringTargetId && carrier.mutability === "const") {
        validateCarrier(carrier.pointee, definition, `${where}.pointee`, fail);
        return;
      }
      if (carrier.pointee.kind === "array" && (carrier.mutability === "const" || carrier.mutability === "mut")) {
        validateCarrier(carrier.pointee, definition, `${where}.pointee`, fail);
        return;
      }
      fail(`${where} is not a renderable Rust pointer carrier`);
    case "target-specific": {
      requireExactKeys(record, ["kind", "target", "name", "value"], where, fail);
      const fixedArray = rustFixedArrayCarrierValue(carrier);
      if (fixedArray === undefined) {
        fail(`${where} is not a supported Rust target-specific carrier`);
      }
      validateCarrier(fixedArray.element, definition, `${where}.value.element`, fail);
      return;
    }
    default:
      fail(`${where} uses unsupported Rust carrier kind '${carrier.kind}'`);
  }
}

function validateValueConversion(
  conversion: RustValueConversion,
  definition: RustProviderPackageDefinition,
  where: string,
  expectedSource: TargetTypeRef | undefined,
  expectedTarget: TargetTypeRef | undefined,
  fail: Fail,
): void {
  requireExactKeys(asRecord(conversion), ["kind", "id"], where, fail);
  if (conversion.kind !== "semantic-conversion") {
    fail(`${where}.kind '${String((conversion as { readonly kind?: unknown }).kind)}' is not supported`);
  }
  const contract = rustValueConversionContract(conversion);
  if (contract === undefined) {
    fail(`${where}.id '${String((conversion as { readonly id?: unknown }).id)}' is not a supported Rust value conversion`);
  }
  validateCarrier(contract.source, definition, `${where}.source`, fail);
  validateCarrier(contract.target, definition, `${where}.target`, fail);
  if (expectedSource !== undefined && !rustTargetTypeRefEquals(contract.source, expectedSource)) {
    fail(`${where}.source does not match its selected source parameter carrier`);
  }
  if (expectedTarget !== undefined && !rustTargetTypeRefEquals(contract.target, expectedTarget)) {
    fail(`${where}.target does not match the selected operation result carrier`);
  }
}

function requireRustIdentifier(value: unknown, where: string, fail: Fail): asserts value is string {
  if (typeof value !== "string" || !rustIdentifierPattern.test(value)) {
    fail(`${where} '${String(value)}' is not a Rust identifier`);
  }
}

function requireRustPath(value: unknown, where: string, fail: Fail): asserts value is string {
  if (typeof value !== "string" || !rustPathPattern.test(value)) {
    fail(`${where} '${String(value)}' is not a closed Rust path`);
  }
}

function requireNonEmpty(value: unknown, where: string, fail: Fail): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${where} must not be empty`);
  }
}

function requireExactKeys(
  value: unknown,
  allowed: readonly string[],
  where: string,
  fail: Fail,
): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${where} must be a metadata object`);
  }
  const record = value as Readonly<Record<string, unknown>>;
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(record).filter((key) => !allowedSet.has(key));
  if (unexpected.length > 0) {
    fail(`${where} has unsupported field${unexpected.length === 1 ? "" : "s"} ${unexpected.map((key) => `'${key}'`).join(", ")}`);
  }
}

function asRecord(value: object): Readonly<Record<string, unknown>> {
  return value as Readonly<Record<string, unknown>>;
}
