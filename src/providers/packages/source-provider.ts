import { materializeClosedMetadata } from "../../policy/model/closed-data.js";
import { TstsSourceProviderContractVersion } from "@tsonic/tsts";
import type {
  CompilerExtension,
  ProviderDeclarationModel,
  ProviderExportDeclaration,
  ProviderMemberDeclaration,
  ProviderModuleResolution,
  ProviderParameterDeclaration,
  ProviderSignatureDeclaration,
  ProviderTypeExpression,
  ProviderTypeParameterDeclaration,
  SourceDeclarationProvider,
} from "@tsonic/tsts";
import type { RustProviderPackageDefinition } from "./model.js";

export function createRustProviderPackageSourceExtension(definition: RustProviderPackageDefinition): CompilerExtension {
  return {
    identity: {
      id: `tsonic.rust.provider-package.${definition.id}`,
      version: definition.version,
    },
    initialize(context): void {
      context.registerSourceDeclarationProvider(createRustProviderPackageSourceProvider(definition));
    },
  };
}

export function createRustProviderPackageSourceProvider(definition: RustProviderPackageDefinition): SourceDeclarationProvider {
  const modulesBySpecifier = new Map(definition.modules.map((module) => [module.moduleSpecifier, module]));
  const canonicalSpecifierByPublicSpecifier = new Map<string, string>(
    definition.modules.map((module) => [module.moduleSpecifier, module.moduleSpecifier]),
  );
  for (const alias of definition.moduleAliases ?? []) {
    canonicalSpecifierByPublicSpecifier.set(alias.moduleSpecifier, alias.canonicalModuleSpecifier);
  }
  return {
    identity: {
      id: rustProviderBindingProviderId(definition.id),
      version: definition.version,
      extensionContractVersion: TstsSourceProviderContractVersion,
    },
    declarationMaterialization: "complete",
    ownsModule(specifier: string) {
      return canonicalSpecifierByPublicSpecifier.has(specifier)
        ? { kind: "owned" as const }
        : { kind: "unowned" as const };
    },
    resolveModule(specifier: string) {
      const canonicalSpecifier = canonicalSpecifierByPublicSpecifier.get(specifier);
      const module = canonicalSpecifier === undefined ? undefined : modulesBySpecifier.get(canonicalSpecifier);
      if (module === undefined) {
        return {
          extensionId: `tsonic.rust.provider-package.${definition.id}`,
          extensionCode: "RUST_PROVIDER_MODULE_NOT_OWNED",
          numericCode: 0,
          category: "error" as const,
          message: `Provider package '${definition.id}' does not own module '${specifier}'.`,
        };
      }
      return {
        kind: "virtual" as const,
        moduleSpecifier: specifier,
        virtualFileName: `tsts-provider://tsonic-rust/${definition.id}/${encodeURIComponent(specifier)}.d.ts`,
        providerModuleId: module.providerModuleId,
        packageName: specifier,
        packageVersion: definition.version,
      };
    },
    getDeclarationModel(resolution: ProviderModuleResolution): ProviderDeclarationModel {
      const canonicalSpecifier = canonicalSpecifierByPublicSpecifier.get(resolution.moduleSpecifier);
      const module = canonicalSpecifier === undefined ? undefined : modulesBySpecifier.get(canonicalSpecifier);
      if (module === undefined) {
        throw new Error(`Provider package '${definition.id}' cannot render unowned module '${resolution.moduleSpecifier}'.`);
      }
      if (resolution.providerModuleId !== module.providerModuleId) {
        throw new Error(`Provider package '${definition.id}' module '${resolution.moduleSpecifier}' was resolved with provider module id '${resolution.providerModuleId}', expected '${module.providerModuleId}'.`);
      }
      return materializeClosedMetadata({
        moduleSpecifier: resolution.moduleSpecifier,
        providerModuleId: module.providerModuleId,
        ...(module.imports === undefined ? {} : { imports: module.imports }),
        exports: module.exports.map((declaration) => rebaseProviderExport(
          declaration,
          module.moduleSpecifier,
          resolution.moduleSpecifier,
        )),
      });
    },
  };
}

function rebaseProviderExport(
  declaration: ProviderExportDeclaration,
  canonicalModuleSpecifier: string,
  publicModuleSpecifier: string,
): ProviderExportDeclaration {
  const mapType = (type: ProviderTypeExpression): ProviderTypeExpression =>
    rebaseProviderType(type, canonicalModuleSpecifier, publicModuleSpecifier);
  return {
    ...declaration,
    ...(declaration.type === undefined ? {} : { type: mapType(declaration.type) }),
    ...(declaration.typeParameters === undefined
      ? {}
      : { typeParameters: declaration.typeParameters.map((parameter) => rebaseProviderTypeParameter(parameter, mapType)) }),
    ...(declaration.heritage === undefined
      ? {}
      : { heritage: declaration.heritage.map((entry) => ({ ...entry, type: mapType(entry.type) })) }),
    ...(declaration.signatures === undefined
      ? {}
      : { signatures: declaration.signatures.map((signature) => rebaseProviderSignature(signature, mapType)) }),
    ...(declaration.members === undefined
      ? {}
      : { members: declaration.members.map((member) => rebaseProviderMember(member, mapType)) }),
  };
}

function rebaseProviderMember(
  member: ProviderMemberDeclaration,
  mapType: (type: ProviderTypeExpression) => ProviderTypeExpression,
): ProviderMemberDeclaration {
  return {
    ...member,
    ...(member.type === undefined ? {} : { type: mapType(member.type) }),
    ...(member.signatures === undefined
      ? {}
      : { signatures: member.signatures.map((signature) => rebaseProviderSignature(signature, mapType)) }),
  };
}

function rebaseProviderSignature(
  signature: ProviderSignatureDeclaration,
  mapType: (type: ProviderTypeExpression) => ProviderTypeExpression,
): ProviderSignatureDeclaration {
  return {
    ...signature,
    parameters: signature.parameters.map((parameter) => rebaseProviderParameter(parameter, mapType)),
    ...(signature.returnType === undefined ? {} : { returnType: mapType(signature.returnType) }),
    ...(signature.typeParameters === undefined
      ? {}
      : { typeParameters: signature.typeParameters.map((parameter) => rebaseProviderTypeParameter(parameter, mapType)) }),
  };
}

function rebaseProviderParameter(
  parameter: ProviderParameterDeclaration,
  mapType: (type: ProviderTypeExpression) => ProviderTypeExpression,
): ProviderParameterDeclaration {
  return {
    ...parameter,
    type: mapType(parameter.type),
    ...(parameter.defaultType === undefined ? {} : { defaultType: mapType(parameter.defaultType) }),
  };
}

function rebaseProviderTypeParameter(
  parameter: ProviderTypeParameterDeclaration,
  mapType: (type: ProviderTypeExpression) => ProviderTypeExpression,
): ProviderTypeParameterDeclaration {
  return {
    ...parameter,
    ...(parameter.constraints === undefined ? {} : { constraints: parameter.constraints.map(mapType) }),
    ...(parameter.defaultType === undefined ? {} : { defaultType: mapType(parameter.defaultType) }),
  };
}

function rebaseProviderType(
  type: ProviderTypeExpression,
  canonicalModuleSpecifier: string,
  publicModuleSpecifier: string,
): ProviderTypeExpression {
  const mapType = (nested: ProviderTypeExpression): ProviderTypeExpression =>
    rebaseProviderType(nested, canonicalModuleSpecifier, publicModuleSpecifier);
  switch (type.kind) {
    case "provider-ref":
      return {
        ...type,
        moduleSpecifier: type.moduleSpecifier === canonicalModuleSpecifier
          ? publicModuleSpecifier
          : type.moduleSpecifier,
        ...(type.typeArguments === undefined ? {} : { typeArguments: type.typeArguments.map(mapType) }),
      };
    case "source-global":
      return {
        ...type,
        ...(type.typeArguments === undefined ? {} : { typeArguments: type.typeArguments.map(mapType) }),
      };
    case "array":
      return { ...type, elementType: mapType(type.elementType) };
    case "tuple":
      return { ...type, elementTypes: type.elementTypes.map(mapType) };
    case "union":
    case "intersection":
      return { ...type, types: type.types.map(mapType) };
    case "function":
      return {
        ...type,
        parameters: type.parameters.map((parameter) => rebaseProviderParameter(parameter, mapType)),
        returnType: mapType(type.returnType),
        ...(type.typeParameters === undefined
          ? {}
          : { typeParameters: type.typeParameters.map((parameter) => rebaseProviderTypeParameter(parameter, mapType)) }),
      };
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
    case "literal":
    case "source-primitive":
    case "type-parameter":
      return type;
  }
}

export function rustProviderBindingProviderId(packageId: string): string {
  return `tsonic.rust.provider-package.${packageId}.binding`;
}
