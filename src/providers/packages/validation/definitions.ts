import { asRecord, requireExactKeys, requireNonEmpty, requireRustIdentifier, requireRustPath, rustSourcePrimitiveHasCarrier, validateCarrier, validateRustGenerics } from "./carriers.js";
import { isClosedMetadata } from "../../../target-model/metadata/closed-data.js";
import { isRustFallibleErrorBoundary } from "../../../target-model/operations/error-boundary.js";
import {
  isRustNamedTypeTraitContract,
  isRustSemanticIdentity,
  rustGenericParameterIdentity,
  rustTargetTypeAssociatedProjectionKeys,
  rustTargetTypeOpenGenericIdentityKeys,
} from "../../../target-model/types/index.js";
import {
  rustSemanticIdentityKey,
  rustTypeSemanticKey,
} from "../../../target-model/semantics/index.js";
import { isRustTargetTypeRef } from "../../../target-model/types/equality.js";
import {
  validateOperationRows,
  validateSourceGenericBindings,
  validateTargetGenericParameterMapping,
  validateTargetOpenGenericParameters,
  validateTypeParameterRequirements,
} from "./operations.js";
import type {
  ProviderExportDeclaration,
  ProviderMemberDeclaration,
  ProviderParameterDeclaration,
  ProviderSignatureDeclaration,
  ProviderTypeExpression,
  ProviderTypeParameterDeclaration,
} from "@tsonic/tsts";
import type { ExportRecord, Fail, MemberRecord, SignatureRecord } from "./model.js";
import type { RustProviderPackageDefinition } from "../index.js";
import { rustProviderBindingProviderId } from "../identity.js";

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
  requireNonEmpty(definition.compilationSnapshotId, "compilation snapshot id", fail);
  requireExactKeys(asRecord(definition), [
    "id", "displayName", "version", "compilationSnapshotId", "requiredSurfaces", "sourceDependencies", "moduleAliases", "modules", "types", "operations", "crates",
    "aliasImports", "traitContracts", "binaryEpilogues",
  ], "package", fail);

  const modulesBySpecifier = new Map<string, RustProviderPackageDefinition["modules"][number]>();
  const modulesByProviderId = new Map<string, RustProviderPackageDefinition["modules"][number]>();
  const exportsById = new Map<string, ExportRecord>();
  const membersById = new Map<string, MemberRecord>();
  const signaturesById = new Map<string, SignatureRecord>();
  const exportNamesByModule = new Map<string, Set<string>>();

  for (const dependency of definition.sourceDependencies ?? []) {
    requireExactKeys(asRecord(dependency), ["moduleSpecifier", "exportedNames"], "source dependency", fail);
    requireNonEmpty(dependency.moduleSpecifier, "source dependency module specifier", fail);
    if (exportNamesByModule.has(dependency.moduleSpecifier)) {
      fail(`duplicate source dependency module '${dependency.moduleSpecifier}'`);
    }
    if (dependency.exportedNames.length === 0) {
      fail(`source dependency '${dependency.moduleSpecifier}' must declare at least one export`);
    }
    const names = new Set<string>();
    for (const exportedName of dependency.exportedNames) {
      requireNonEmpty(exportedName, `source dependency export in '${dependency.moduleSpecifier}'`, fail);
      if (names.has(exportedName)) {
        fail(`source dependency '${dependency.moduleSpecifier}' repeats export '${exportedName}'`);
      }
      names.add(exportedName);
    }
    exportNamesByModule.set(dependency.moduleSpecifier, names);
  }

  for (const module of definition.modules) {
    requireExactKeys(asRecord(module), ["moduleSpecifier", "providerModuleId", "imports", "exports"], "module", fail);
    requireNonEmpty(module.moduleSpecifier, "module specifier", fail);
    requireNonEmpty(module.providerModuleId, `provider module id for '${module.moduleSpecifier}'`, fail);
    if (modulesBySpecifier.has(module.moduleSpecifier)) {
      fail(`duplicate module '${module.moduleSpecifier}'`);
    }
    if (exportNamesByModule.has(module.moduleSpecifier)) {
      fail(`module '${module.moduleSpecifier}' conflicts with a source dependency of the same name`);
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

  validateModuleAliases(definition, modulesBySpecifier, exportNamesByModule, fail);

  for (const module of definition.modules) {
    const importedExports = validateImports(module, exportNamesByModule, fail);
    for (const exported of module.exports) {
      walkExportTypes(exported, module.moduleSpecifier, importedExports, exportNamesByModule, fail);
    }
  }

  validateCrates(definition, fail);
  validateAliases(definition, fail);
  validateTraitContracts(definition, fail);
  validateBinaryEpilogues(definition, fail);
  validateTypeRelations(definition, exportsById, fail);
  validateOperationRows(definition, exportsById, membersById, signaturesById, fail);
}

function validateModuleAliases(
  definition: RustProviderPackageDefinition,
  modulesBySpecifier: ReadonlyMap<string, RustProviderPackageDefinition["modules"][number]>,
  occupiedSpecifiers: ReadonlyMap<string, ReadonlySet<string>>,
  fail: Fail,
): void {
  const aliases = new Set<string>();
  for (const alias of definition.moduleAliases ?? []) {
    requireExactKeys(asRecord(alias), ["moduleSpecifier", "canonicalModuleSpecifier"], "module alias", fail);
    requireNonEmpty(alias.moduleSpecifier, "module alias specifier", fail);
    requireNonEmpty(alias.canonicalModuleSpecifier, `canonical module for alias '${alias.moduleSpecifier}'`, fail);
    if (!modulesBySpecifier.has(alias.canonicalModuleSpecifier)) {
      fail(`module alias '${alias.moduleSpecifier}' names unknown canonical module '${alias.canonicalModuleSpecifier}'`);
    }
    if (occupiedSpecifiers.has(alias.moduleSpecifier)) {
      fail(`module alias '${alias.moduleSpecifier}' conflicts with a declared module or source dependency`);
    }
    if (aliases.has(alias.moduleSpecifier)) {
      fail(`duplicate module alias '${alias.moduleSpecifier}'`);
    }
    aliases.add(alias.moduleSpecifier);
  }
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
  exportNamesByModule: ReadonlyMap<string, ReadonlySet<string>>,
  fail: Fail,
): ReadonlyMap<string, ReadonlySet<string>> {
  const importedExports = new Map<string, Set<string>>();
  for (const imported of module.imports ?? []) {
    requireExactKeys(asRecord(imported), ["moduleSpecifier", "namedImports"], `import in '${module.moduleSpecifier}'`, fail);
    requireNonEmpty(imported.moduleSpecifier, `import module specifier in '${module.moduleSpecifier}'`, fail);
    if (!exportNamesByModule.has(imported.moduleSpecifier)) {
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
      if (!rustSourcePrimitiveHasCarrier(type.name)) {
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

function validateTraitContracts(definition: RustProviderPackageDefinition, fail: Fail): void {
  const identities = new Set<string>();
  const expectedProviderId = rustProviderBindingProviderId(definition.id);
  const expectedSnapshotId = definition.compilationSnapshotId;
  for (const entry of definition.traitContracts ?? []) {
    requireExactKeys(asRecord(entry), ["typeIdentity", "contract"], "trait contract", fail);
    if (!isRustSemanticIdentity(entry.typeIdentity) ||
      entry.typeIdentity.kind !== "provider" ||
      entry.typeIdentity.providerId !== expectedProviderId ||
      entry.typeIdentity.providerVersion !== definition.version ||
      entry.typeIdentity.compilationSnapshotId !== expectedSnapshotId) {
      fail("trait contract type identity is not owned by the exact provider package snapshot");
    }
    const identityKey = rustSemanticIdentityKey(entry.typeIdentity);
    if (identities.has(identityKey)) {
      fail(`duplicate trait contract for '${identityKey}'`);
    }
    identities.add(identityKey);
    if (!isRustNamedTypeTraitContract(entry.contract)) {
      fail(`type '${identityKey}' has an invalid native trait contract`);
    }
  }
}

function validateBinaryEpilogues(definition: RustProviderPackageDefinition, fail: Fail): void {
  const ids = new Set<string>();
  const crates = new Set(definition.crates.map((crate) => crate.crateName));
  for (const epilogue of definition.binaryEpilogues ?? []) {
    const record = asRecord(epilogue);
    const epilogueId = epilogue.id;
    requireExactKeys(
      record,
      ["id", "path", "requiredCrate", "isFallible", "errorBoundary", "errorCarrier"],
      "binary epilogue",
      fail,
    );
    requireNonEmpty(epilogue.id, "binary epilogue id", fail);
    requireRustPath(epilogue.path, `path for binary epilogue '${epilogue.id}'`, fail);
    requireRustIdentifier(epilogue.requiredCrate, `required crate for binary epilogue '${epilogue.id}'`, fail);
    if (!crates.has(epilogue.requiredCrate)) {
      fail(`binary epilogue '${epilogue.id}' requires undeclared crate '${epilogue.requiredCrate}'`);
    }
    if (epilogue.isFallible !== undefined && epilogue.isFallible !== true) {
      fail(`binary epilogue '${epilogue.id}' has invalid isFallible value`);
    }
    if (epilogue.isFallible === true && !isRustFallibleErrorBoundary(epilogue.errorBoundary)) {
      fail(`fallible binary epilogue '${epilogue.id}' requires an exact errorBoundary`);
    }
    if (epilogue.isFallible !== true && record.errorBoundary !== undefined) {
      fail(`infallible binary epilogue '${epilogue.id}' cannot declare an errorBoundary`);
    }
    if (record.errorBoundary === "provider-native") {
      if (!isRustTargetTypeRef(record.errorCarrier)) {
        fail(`provider-native binary epilogue '${epilogueId}' requires an exact errorCarrier`);
      } else {
        validateCarrier(
          record.errorCarrier,
          definition,
          `binary epilogue '${epilogueId}'.errorCarrier`,
          fail,
          { position: "return" },
        );
      }
    } else if (record.errorCarrier !== undefined) {
      fail(`binary epilogue '${epilogueId}' cannot declare an errorCarrier outside a provider-native boundary`);
    }
    if (ids.has(epilogue.id)) {
      fail(`duplicate binary epilogue id '${epilogue.id}'`);
    }
    ids.add(epilogue.id);
  }
}

function validateTypeRelations(
  definition: RustProviderPackageDefinition,
  exportsById: ReadonlyMap<string, ExportRecord>,
  fail: Fail,
): void {
  const relatedExports = new Set<string>();
  for (const relation of definition.types ?? []) {
    requireExactKeys(asRecord(relation), ["exportId", "targetDeclarationKind", "targetTraitKind", "targetTraitSafety", "targetTraitRequiresImplementationItems", "sourceGenericBindings", "targetImplicitParameters", "semanticRoles", "targetGenerics", "targetCarrier", "typeRequirements", "objectLiteralConstruction"], "type relation", fail);
    requireNonEmpty(relation.exportId, "type relation export id", fail);
    if (relation.targetDeclarationKind !== "struct" &&
      relation.targetDeclarationKind !== "enum" &&
      relation.targetDeclarationKind !== "union" &&
      relation.targetDeclarationKind !== "trait" &&
      relation.targetDeclarationKind !== "type-alias") {
      fail(`export '${relation.exportId}' has invalid target declaration kind '${String(relation.targetDeclarationKind)}'`);
    }
    if (relation.targetDeclarationKind === "trait") {
      if (relation.targetTraitKind !== "ordinary" && relation.targetTraitKind !== "auto") {
        fail(`trait export '${relation.exportId}' has no exact ordinary/auto trait kind`);
      }
      if (relation.targetTraitSafety !== "safe" && relation.targetTraitSafety !== "unsafe") {
        fail(`trait export '${relation.exportId}' has no exact safe/unsafe trait contract`);
      }
      if (typeof relation.targetTraitRequiresImplementationItems !== "boolean") {
        fail(`trait export '${relation.exportId}' has no exact implementation-item requirement contract`);
      }
    } else if (relation.targetTraitKind !== undefined || relation.targetTraitSafety !== undefined) {
      fail(`non-trait export '${relation.exportId}' cannot declare target trait contracts`);
    } else if (relation.targetTraitRequiresImplementationItems !== undefined) {
      fail(`non-trait export '${relation.exportId}' cannot declare implementation-item requirements`);
    }
    const exported = exportsById.get(relation.exportId)?.declaration;
    if (exported === undefined) {
      fail(`type relation targets undeclared exportId '${relation.exportId}'`);
    }
    if (relatedExports.has(relation.exportId)) {
      fail(`export '${relation.exportId}' has more than one Rust target type relation`);
    }
    relatedExports.add(relation.exportId);
    if (!isRustTargetTypeRef(relation.targetCarrier)) {
      fail(`export '${relation.exportId}' has an invalid closed Rust target carrier`);
    }
    validateTypeSemanticRoles(relation, fail);
    validateRustGenerics(
      relation.targetGenerics,
      definition,
      `export '${relation.exportId}'.targetGenerics`,
      fail,
    );
    const implicitTargetIdentities = validateTargetOpenGenericParameters(
      relation.targetImplicitParameters ?? [],
      `export '${relation.exportId}'.targetImplicitParameters`,
      fail,
      definition,
    );
    validateTargetGenericParameterMapping(
      relation.targetGenerics,
      relation.sourceGenericBindings,
      implicitTargetIdentities,
      `export '${relation.exportId}'.targetGenerics`,
      fail,
    );
    if (relation.objectLiteralConstruction !== undefined && (
      !isClosedMetadata(relation.objectLiteralConstruction) ||
      Object.keys(relation.objectLiteralConstruction).length !== 1 ||
      relation.objectLiteralConstruction.kind !== "struct-default" ||
      relation.targetCarrier.kind !== "path"
    )) {
      fail(`export '${relation.exportId}' has an invalid Rust object-literal construction contract`);
    }
    const sourceTypeParameters = validateSourceGenericBindings(
      relation.sourceGenericBindings,
      `export '${relation.exportId}'.sourceGenericBindings`,
      fail,
      definition,
    );
    const declaredTypeParameters = (exported.typeParameters ?? []).map((parameter) => parameter.name);
    if (declaredTypeParameters.length !== relation.sourceGenericBindings.length ||
      declaredTypeParameters.some((name, index) =>
        name !== relation.sourceGenericBindings[index]?.sourceName)) {
      fail(`export '${relation.exportId}' source generic parameters do not exactly match its declaration`);
    }
    validateTypeParameterRequirements(
      relation.typeRequirements,
      sourceTypeParameters,
      definition,
      `export '${relation.exportId}' type requirements`,
      fail,
    );
    const declaredTargetIdentities = new Map(relation.sourceGenericBindings.flatMap((binding) => {
      if (binding.target.kind !== "generic-parameter") return [];
      const identity = rustGenericParameterIdentity(binding.target.parameter);
      return identity === undefined ? [] : [[identity.identityKey, binding.sourceName] as const];
    }));
    const referencedTargetIdentities = new Set(
      rustTargetTypeOpenGenericIdentityKeys(relation.targetCarrier),
    );
    for (const identityKey of referencedTargetIdentities) {
      if (!declaredTargetIdentities.has(identityKey)) {
        fail(`export '${relation.exportId}' target carrier references undeclared target generic parameter '${identityKey}'`);
      }
    }
    for (const [identityKey, sourceName] of declaredTargetIdentities) {
      if (!referencedTargetIdentities.has(identityKey)) {
        fail(`export '${relation.exportId}' source parameter '${sourceName}' has no target generic use '${identityKey}'`);
      }
    }
    const referencedAssociatedProjections = new Set(
      rustTargetTypeAssociatedProjectionKeys(relation.targetCarrier),
    );
    for (const binding of relation.sourceGenericBindings) {
      if (binding.target.kind !== "associated-type") continue;
      const projectionKey = rustTypeSemanticKey(binding.target.projection);
      if (!referencedAssociatedProjections.has(projectionKey)) {
        fail(`export '${relation.exportId}' source parameter '${binding.sourceName}' has no target associated-type use '${projectionKey}'`);
      }
    }
  }
}

function validateTypeSemanticRoles(
  relation: NonNullable<RustProviderPackageDefinition["types"]>[number],
  fail: Fail,
): void {
  if (relation.semanticRoles === undefined) return;
  if (!Array.isArray(relation.semanticRoles)) {
    fail(`export '${relation.exportId}' semanticRoles must be a dense array`);
    return;
  }
  const kinds = new Set<string>();
  for (const role of relation.semanticRoles) {
    if (role.kind !== "pin-wrapper" && role.kind !== "callable-trait") {
      fail(`export '${relation.exportId}' has unknown semantic role '${String(role.kind)}'`);
      continue;
    }
    if (kinds.has(role.kind)) {
      fail(`export '${relation.exportId}' repeats semantic role '${role.kind}'`);
    }
    kinds.add(role.kind);
    if (role.kind === "pin-wrapper") {
      requireExactKeys(asRecord(role), ["kind", "pointerArgumentIndex"], `export '${relation.exportId}' semantic role`, fail);
      if (!Number.isSafeInteger(role.pointerArgumentIndex) || role.pointerArgumentIndex < 0 ||
        relation.targetCarrier.kind !== "path" ||
        relation.targetCarrier.arguments[role.pointerArgumentIndex] === undefined ||
        relation.targetCarrier.arguments[role.pointerArgumentIndex]?.kind !== "type") {
        fail(`export '${relation.exportId}' pin-wrapper role must select one exact target type argument`);
      }
      continue;
    }
    requireExactKeys(
      asRecord(role),
      ["kind", "callTrait", "parameterTupleSourceName", "resultSourceName"],
      `export '${relation.exportId}' semantic role`,
      fail,
    );
    if (role.callTrait !== "fn" && role.callTrait !== "fn-mut" && role.callTrait !== "fn-once") {
      fail(`export '${relation.exportId}' callable-trait role has an invalid call trait`);
    }
    requireRustIdentifier(
      role.parameterTupleSourceName,
      `export '${relation.exportId}' callable argument tuple source name`,
      fail,
    );
    requireRustIdentifier(
      role.resultSourceName,
      `export '${relation.exportId}' callable result source name`,
      fail,
    );
    const argumentBinding = relation.sourceGenericBindings.find((binding) =>
      binding.sourceName === role.parameterTupleSourceName);
    const resultBinding = relation.sourceGenericBindings.find((binding) =>
      binding.sourceName === role.resultSourceName);
    if (argumentBinding?.target.kind !== "generic-parameter" ||
      argumentBinding.target.parameter.kind !== "type") {
      fail(`export '${relation.exportId}' callable-trait role must select one exact target argument-tuple parameter`);
    }
    if (resultBinding?.target.kind !== "semantic-parameter" ||
      resultBinding.target.role !== "callable-result") {
      fail(`export '${relation.exportId}' callable-trait role must select one exact callable-result semantic parameter`);
    }
  }
}
