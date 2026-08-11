import { TstsSourceProviderContractVersion } from "@tsonic/tsts";
import type {
  CompilerExtension,
  ProviderDeclarationKind,
  ProviderDeclarationModel,
  ProviderExportDeclaration,
  ProviderModuleResolution,
  SourceDeclarationProvider,
} from "@tsonic/tsts";
import type {
  TargetCapabilityContribution,
  TargetCapabilityImplementation,
  TargetCapabilityContext,
  TargetProviderContext,
  TargetRuntimeContributionContext,
  TargetRuntimeContributions,
  TargetRuntimeReference,
} from "@tsonic/target-api";
import type { TargetTypeRef } from "../../policy/types.js";
import {
  cargoCrateAttributeName,
  cargoPathReferenceKind,
  cargoRegistryPatchAttributeName,
} from "../../backend/planner/cargo-project.js";
import type { RustProviderOperationForm, RustValueConversion } from "../rust-facts/keys.js";
import { validateProviderPackageDefinition } from "./validation.js";
import {
  materializeClosedMetadata,
  snapshotClosedMetadata,
} from "../../common/closed-metadata.js";
import {
  rustFixedArrayCarrierValue,
  rustFixedArrayTargetType,
  rustNamedTargetType,
} from "../rust-target-types.js";

// Generic Rust provider-package model. Concrete module specifiers, export
// names, and Rust operation paths live only in package definitions (product
// packages or test fakes), never in generic mapping code.

export interface RustProviderModuleDefinition {
  readonly moduleSpecifier: string;
  readonly providerModuleId: string;
  // Cross-module type references (e.g. crypto returning buffer's Buffer).
  readonly imports?: readonly { readonly moduleSpecifier: string; readonly namedImports: readonly { readonly exportedName: string }[] }[];
  readonly exports: readonly ProviderExportDeclaration[];
}

export interface RustProviderOperationDefinition {
  readonly exportId: string;
  readonly memberId?: string;
  readonly signatureId?: string;
  readonly operationKind: "method" | "constructor" | "property" | "indexer";
  readonly target: RustProviderOperationForm;
  readonly resultCarrier: TargetTypeRef;
  readonly parameterCarriers?: readonly TargetTypeRef[];
  readonly resultConversion?: RustValueConversion;
  // Async provider operations produce future carriers that must be awaited.
  readonly isAsync?: boolean;
  // Fallible operations return TsonicResult and require a fallible context.
  // Method, constructor, and property operations support fallibility;
  // package creation rejects other kinds.
  readonly isFallible?: boolean;
}

export interface RustProviderTypeDefinition {
  readonly exportId: string;
  readonly targetTypeId: string;
}

export interface RustProviderTypeRow extends RustProviderTypeDefinition {
  readonly providerPackageId: string;
  readonly providerId: string;
  readonly providerVersion: string;
  readonly providerModuleId: string;
  readonly moduleSpecifier: string;
}

export interface RustProviderOperationRow extends RustProviderOperationDefinition {
  readonly providerPackageId: string;
  readonly providerId: string;
  readonly providerVersion: string;
  readonly providerModuleId: string;
  readonly moduleSpecifier: string;
}

export interface RustProviderExportRow {
  readonly exportId: string;
  readonly declarationKind: ProviderDeclarationKind;
  readonly providerPackageId: string;
  readonly providerId: string;
  readonly providerVersion: string;
  readonly providerModuleId: string;
  readonly moduleSpecifier: string;
}

export interface RustProviderCrateDefinition {
  readonly crateName: string;
  readonly cargoPath: string;
  readonly registryPatch?: "crates-io";
}

export interface RustProviderPackageDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  readonly requiredSurfaces?: readonly string[];
  readonly modules: readonly RustProviderModuleDefinition[];
  readonly types?: readonly RustProviderTypeDefinition[];
  readonly operations: readonly RustProviderOperationDefinition[];
  readonly crates: readonly RustProviderCrateDefinition[];
  // Rust module aliases used by this capability's operation row paths
  // (e.g. acme_db_ext -> acme_db::ext). Emitted as use items.
  readonly aliasImports?: readonly { readonly alias: string; readonly path: string }[];
  // Rendered Rust paths for this capability's target-named carriers
  // (e.g. acme.db.Row -> acme_db::Row).
  readonly carrierPaths?: Readonly<Record<string, string>>;
}

export const rustProviderPolicyContributionKind = "rust-provider-policy";

export interface RustProviderPolicyContribution extends TargetCapabilityContribution {
  readonly kind: typeof rustProviderPolicyContributionKind;
  readonly contractVersion: 1;
  readonly definition: RustProviderPackageDefinition;
}

export type RustProviderPackageImplementation = TargetCapabilityImplementation;

export function createRustProviderPackage(definition: RustProviderPackageDefinition): RustProviderPackageImplementation {
  let closedDefinition: RustProviderPackageDefinition;
  try {
    closedDefinition = snapshotClosedMetadata(definition);
  } catch (error) {
    throw new Error(`Provider package '${String(definition.id)}': ${error instanceof Error ? error.message : String(error)}`);
  }
  validateProviderPackageDefinition(closedDefinition);
  const bindingProviderId = rustProviderBindingProviderId(closedDefinition.id);
  return Object.freeze({
    kind: "target-capability",
    targetId: "rust",
    id: closedDefinition.id,
    displayName: closedDefinition.displayName,
    ...(closedDefinition.requiredSurfaces === undefined ? {} : { requiredSurfaces: closedDefinition.requiredSurfaces }),
    moduleOwnership: Object.freeze(closedDefinition.modules.map((module) => Object.freeze({
      specifierPrefix: module.moduleSpecifier,
      providerId: bindingProviderId,
    }))),
    sourceCompilerContributions(): { readonly extensions: readonly CompilerExtension[] } {
      return { extensions: [createRustProviderPackageSourceExtension(closedDefinition)] };
    },
    runtimeContributions(_context: TargetRuntimeContributionContext): TargetRuntimeContributions {
      return {
        references: closedDefinition.crates.map((crate): TargetRuntimeReference => ({
          kind: cargoPathReferenceKind,
          include: crate.cargoPath,
          attributes: {
            [cargoCrateAttributeName]: crate.crateName,
            ...(crate.registryPatch === undefined
              ? {}
              : { [cargoRegistryPatchAttributeName]: crate.registryPatch }),
          },
        })),
      };
    },
    createTargetContributions(): readonly RustProviderPolicyContribution[] {
      return [Object.freeze({
        kind: rustProviderPolicyContributionKind,
        contractVersion: 1 as const,
        definition: closedDefinition,
      })];
    },
  });
}

export function rustProviderPolicyContributionsOf(
  context: TargetProviderContext,
): readonly RustProviderPolicyContribution[] {
  const contributions: RustProviderPolicyContribution[] = [];
  for (const capability of context.selectedCapabilities) {
    const capabilityContext: TargetCapabilityContext = {
      project: context.project,
      target: context.target,
      targetPack: context.targetPack,
      selectedCapabilities: context.selectedCapabilities,
      selectedSurfaces: context.selectedSurfaces,
      capability,
    };
    for (const contribution of capability.createTargetContributions?.(capabilityContext) ?? []) {
      if (contribution.kind === rustProviderPolicyContributionKind) {
        const candidate = contribution as RustProviderPolicyContribution;
        if (candidate.contractVersion !== 1 || candidate.definition === undefined) {
          throw new Error(`Rust capability '${capability.id}' contributed an invalid '${rustProviderPolicyContributionKind}' contract.`);
        }
        if (candidate.definition.id !== capability.id) {
          throw new Error(`Rust capability '${capability.id}' contributed provider metadata owned by '${candidate.definition.id}'.`);
        }
        validateProviderPackageDefinition(candidate.definition);
        contributions.push(snapshotClosedMetadata(candidate));
      }
    }
  }
  return contributions;
}

export function collectRustProviderOperationRows(
  context: TargetProviderContext,
): readonly RustProviderOperationRow[] {
  return collectRustProviderSemantics(context).operations;
}

export interface RustProviderSemantics {
  readonly exports: readonly RustProviderExportRow[];
  readonly operations: readonly RustProviderOperationRow[];
  readonly carrierPaths: ReadonlyMap<string, string>;
  readonly types: readonly RustProviderTypeRow[];
}

export function collectRustProviderSemantics(
  context: TargetProviderContext,
): RustProviderSemantics {
  const exports: RustProviderExportRow[] = [];
  const operations: RustProviderOperationRow[] = [];
  const carrierPaths = new Map<string, string>();
  const types: RustProviderTypeRow[] = [];
  for (const contribution of rustProviderPolicyContributionsOf(context)) {
    const definition = contribution.definition;
    const providerId = rustProviderBindingProviderId(definition.id);
    const moduleByExportId = new Map(definition.modules.flatMap((module) =>
      module.exports.map((exported) => [exported.id, module] as const)));
    for (const module of definition.modules) {
      for (const exported of module.exports) {
        exports.push(Object.freeze({
          exportId: exported.id,
          declarationKind: exported.kind,
          providerPackageId: definition.id,
          providerId,
          providerVersion: definition.version,
          providerModuleId: module.providerModuleId,
          moduleSpecifier: module.moduleSpecifier,
        }));
      }
    }
    const carrierPathRows = definition.carrierPaths ?? {};
    for (const [carrierId, path] of Object.entries(carrierPathRows)) {
      const existing = carrierPaths.get(carrierId);
      if (existing !== undefined && existing !== path) {
        throw new Error(`Rust provider carrier '${carrierId}' has conflicting target paths '${existing}' and '${path}'.`);
      }
      carrierPaths.set(carrierId, path);
    }
    for (const type of definition.types ?? []) {
      const module = moduleByExportId.get(type.exportId);
      if (module === undefined) {
        throw new Error(`Rust provider package '${definition.id}' type relation '${type.exportId}' has no declaration owner.`);
      }
      types.push(Object.freeze({
        ...type,
        providerPackageId: definition.id,
        providerId,
        providerVersion: definition.version,
        providerModuleId: module.providerModuleId,
        moduleSpecifier: module.moduleSpecifier,
      }));
    }
    const aliases = new Map((definition.aliasImports ?? []).map((entry) => [entry.alias, entry.path]));
    operations.push(...definition.operations.map((row) => {
      const module = moduleByExportId.get(row.exportId);
      if (module === undefined) {
        throw new Error(`Rust provider package '${definition.id}' operation '${row.memberId ?? row.exportId}' has no declaration owner.`);
      }
      return materializeProviderOperationRow(row, aliases, carrierPathRows, {
        providerPackageId: definition.id,
        providerId,
        providerVersion: definition.version,
        providerModuleId: module.providerModuleId,
        moduleSpecifier: module.moduleSpecifier,
      });
    }));
  }
  return {
    exports: Object.freeze(exports),
    operations: Object.freeze(operations),
    carrierPaths,
    types: Object.freeze(types),
  };
}

function materializeProviderOperationRow(
  row: RustProviderOperationDefinition,
  aliases: ReadonlyMap<string, string>,
  carrierPaths: Readonly<Record<string, string>>,
  owner: Pick<RustProviderOperationRow, "providerPackageId" | "providerId" | "providerVersion" | "providerModuleId" | "moduleSpecifier">,
): RustProviderOperationRow {
  return {
    ...row,
    ...owner,
    target: materializeProviderOperationForm(row.target, aliases, carrierPaths),
    resultCarrier: materializeProviderCarrier(row.resultCarrier, carrierPaths),
    ...(row.parameterCarriers === undefined
      ? {}
      : { parameterCarriers: row.parameterCarriers.map((carrier) => materializeProviderCarrier(carrier, carrierPaths)) }),
    ...(row.resultConversion === undefined
      ? {}
      : { resultConversion: row.resultConversion }),
  };
}

function materializeProviderOperationForm(
  form: RustProviderOperationForm,
  aliases: ReadonlyMap<string, string>,
  carrierPaths: Readonly<Record<string, string>>,
): RustProviderOperationForm {
  const argConversions = "argConversions" in form && form.argConversions !== undefined
    ? [...form.argConversions]
    : undefined;
  if (form.form === "call") {
    return {
      ...form,
      path: expandProviderPath(form.path, aliases),
      ...(argConversions === undefined ? {} : { argConversions }),
    };
  }
  if (form.form === "free-call") {
    return {
      ...form,
      path: expandProviderPath(form.path, aliases),
      ...(argConversions === undefined ? {} : { argConversions }),
    };
  }
  if (form.form === "call-value-slice" || form.form === "receiver-value-array") {
    return {
      ...form,
      ...(form.form === "call-value-slice"
        ? { path: expandProviderPath(form.path, aliases) }
        : {}),
      leadingArguments: form.leadingArguments.map((argument) => ({
        ...argument,
        carrier: materializeProviderCarrier(argument.carrier, carrierPaths),
      })),
      elementCarrier: materializeProviderCarrier(form.elementCarrier, carrierPaths),
    };
  }
  if (form.form === "call-str-slice" || form.form === "free-call-str-slice" || form.form === "path") {
    return { ...form, path: expandProviderPath(form.path, aliases) };
  }
  if (form.form === "binary-operator") {
    return { ...form, trait: expandProviderPath(form.trait, aliases) };
  }
  if (form.form === "index" && form.indexConversion !== undefined) {
    return form;
  }
  if (form.form === "receiver-method" && argConversions !== undefined) {
    return { ...form, argConversions };
  }
  return form;
}

function expandProviderPath(path: string, aliases: ReadonlyMap<string, string>): string {
  const separator = path.indexOf("::");
  const root = separator < 0 ? path : path.slice(0, separator);
  const replacement = aliases.get(root);
  return replacement === undefined
    ? path
    : separator < 0 ? replacement : `${replacement}${path.slice(separator)}`;
}

export function materializeProviderCarrier(
  carrier: TargetTypeRef,
  carrierPaths: Readonly<Record<string, string>> | ReadonlyMap<string, string>,
): TargetTypeRef {
  if (carrier.kind === "target-named") {
    const typeArguments = (carrier.typeArguments ?? []).map((argument) =>
      materializeProviderCarrier(argument, carrierPaths));
    const path = carrierPaths instanceof Map
      ? carrierPaths.get(carrier.id)
      : (carrierPaths as Readonly<Record<string, string>>)[carrier.id];
    return path === undefined
      ? { ...carrier, ...(typeArguments.length === 0 ? {} : { typeArguments }) }
      : rustNamedTargetType(carrier.id, path, typeArguments);
  }
  if (carrier.kind === "array") {
    return { ...carrier, element: materializeProviderCarrier(carrier.element, carrierPaths) };
  }
  if (carrier.kind === "tuple") {
    return { ...carrier, elements: carrier.elements.map((element) => materializeProviderCarrier(element, carrierPaths)) };
  }
  if (carrier.kind === "pointer") {
    return { ...carrier, pointee: materializeProviderCarrier(carrier.pointee, carrierPaths) };
  }
  if (carrier.kind === "function-pointer") {
    return {
      ...carrier,
      args: carrier.args.map((argument) => materializeProviderCarrier(argument, carrierPaths)),
      result: materializeProviderCarrier(carrier.result, carrierPaths),
    };
  }
  const fixedArray = rustFixedArrayCarrierValue(carrier);
  return fixedArray === undefined
    ? carrier
    : rustFixedArrayTargetType(materializeProviderCarrier(fixedArray.element, carrierPaths), fixedArray.length);
}

function createRustProviderPackageSourceExtension(definition: RustProviderPackageDefinition): CompilerExtension {
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
  return {
    identity: {
      id: rustProviderBindingProviderId(definition.id),
      version: definition.version,
      extensionContractVersion: TstsSourceProviderContractVersion,
    },
    declarationMaterialization: "complete",
    ownsModule(specifier: string) {
      return modulesBySpecifier.has(specifier) ? { kind: "owned" as const } : { kind: "unowned" as const };
    },
    resolveModule(specifier: string) {
      const module = modulesBySpecifier.get(specifier);
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
        moduleSpecifier: module.moduleSpecifier,
        virtualFileName: `tsts-provider://tsonic-rust/${definition.id}/${encodeURIComponent(module.moduleSpecifier)}.d.ts`,
        providerModuleId: module.providerModuleId,
        packageName: module.moduleSpecifier,
        packageVersion: definition.version,
      };
    },
    getDeclarationModel(resolution: ProviderModuleResolution): ProviderDeclarationModel {
      const module = modulesBySpecifier.get(resolution.moduleSpecifier);
      if (module === undefined) {
        throw new Error(`Provider package '${definition.id}' cannot render unowned module '${resolution.moduleSpecifier}'.`);
      }
      if (resolution.providerModuleId !== module.providerModuleId) {
        throw new Error(`Provider package '${definition.id}' module '${resolution.moduleSpecifier}' was resolved with provider module id '${resolution.providerModuleId}', expected '${module.providerModuleId}'.`);
      }
      return materializeClosedMetadata({
        moduleSpecifier: module.moduleSpecifier,
        providerModuleId: module.providerModuleId,
        ...(module.imports === undefined ? {} : { imports: module.imports }),
        exports: module.exports,
      });
    },
  };
}

function rustProviderBindingProviderId(packageId: string): string {
  return `tsonic.rust.provider-package.${packageId}.binding`;
}
