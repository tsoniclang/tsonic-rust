import {
  materializeProviderBinaryEpilogueRow,
  materializeProviderOperationRow,
} from "./materialization.js";
import { rustProviderBindingProviderId } from "./identity.js";
import { validateProviderPackageDefinition } from "./validation.js";
import {
  closedMetadataEquals,
  snapshotClosedMetadata,
} from "../../target-model/metadata/closed-data.js";
import {
  rustSemanticIdentityKey,
} from "../../target-model/semantics/index.js";
import { rustBuiltInSourceTypeSemantics } from "../builtins/source-types.js";
import type {
  RustNamedTypeTraitContractEntry,
} from "../../target-model/types/model.js";
import { rustProviderPolicyContributionKind } from "./model.js";
import type { RustProviderBinaryEpilogueRow, RustProviderExportRow, RustProviderOperationRow, RustProviderPackageDefinition, RustProviderPolicyContribution, RustProviderSemantics, RustProviderTypeRow } from "./model.js";
import type { SelectedTargetCapabilityContributions } from "@tsonic/target-api/provider";

export function rustProviderPolicyContributionsOf(
  capabilities: readonly SelectedTargetCapabilityContributions[],
): readonly RustProviderPolicyContribution[] {
  const contributions: RustProviderPolicyContribution[] = [];
  for (const capability of capabilities) {
    for (const contribution of capability.contributions) {
      if (contribution.kind !== rustProviderPolicyContributionKind) {
        throw new Error(
          `Rust capability '${capability.capabilityId}' supplied unsupported target contribution kind '${contribution.kind}'.`,
        );
      }
      const candidate = contribution as RustProviderPolicyContribution;
      if (candidate.contractVersion !== 1 || candidate.definition === undefined) {
        throw new Error(`Rust capability '${capability.capabilityId}' contributed an invalid '${rustProviderPolicyContributionKind}' contract.`);
      }
      if (candidate.definition.id !== capability.capabilityId) {
        throw new Error(`Rust capability '${capability.capabilityId}' contributed provider metadata owned by '${candidate.definition.id}'.`);
      }
      validateProviderPackageDefinition(candidate.definition);
      contributions.push(snapshotClosedMetadata(candidate));
    }
  }
  return Object.freeze(contributions);
}

export function mergeExactRows<T>(
  rows: readonly T[],
  identityOf: (row: T) => string,
  kind: string,
): readonly T[] {
  const byIdentity = new Map<string, T>();
  for (const row of rows) {
    const identity = identityOf(row);
    const existing = byIdentity.get(identity);
    if (existing !== undefined && !closedMetadataEquals(existing, row)) {
      throw new Error(`Rust provider ${kind} '${identity}' has conflicting definitions.`);
    }
    byIdentity.set(identity, snapshotClosedMetadata(row));
  }
  return Object.freeze([...byIdentity.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([, row]) => row));
}

export function providerExportRowIdentity(row: Pick<RustProviderExportRow, "providerId" | "providerVersion" | "providerModuleId" | "moduleSpecifier" | "exportId">): string {
  return `${row.providerId}\0${row.providerVersion}\0${row.providerModuleId}\0${row.moduleSpecifier}\0${row.exportId}`;
}

export function providerOperationRowIdentity(row: RustProviderOperationRow): string {
  return `${providerExportRowIdentity(row)}\0${row.memberId ?? ""}\0${row.signatureId ?? ""}\0${row.operationKind}`;
}

export function providerTypeRowIdentity(row: RustProviderTypeRow): string {
  return providerExportRowIdentity(row);
}

export function providerBinaryEpilogueIdentity(row: RustProviderBinaryEpilogueRow): string {
  return `${row.providerPackageId}\0${row.id}`;
}

export function collectRustProviderSemantics(
  capabilities: readonly SelectedTargetCapabilityContributions[],
): RustProviderSemantics {
  return collectRustProviderSemanticsFromDefinitions(
    rustProviderPolicyContributionsOf(capabilities).map((contribution) => contribution.definition),
  );
}

export function composeRustProviderSemantics(
  capabilities: readonly SelectedTargetCapabilityContributions[],
  compilerProviderSemantics?: RustProviderSemantics,
): RustProviderSemantics {
  return mergeRustProviderSemantics(
    rustBuiltInSourceTypeSemantics(),
    collectRustProviderSemantics(capabilities),
    ...(compilerProviderSemantics === undefined ? [] : [compilerProviderSemantics]),
  );
}

export function collectRustProviderSemanticsFromDefinitions(
  definitions: readonly RustProviderPackageDefinition[],
): RustProviderSemantics {
  const exports: RustProviderExportRow[] = [];
  const operations: RustProviderOperationRow[] = [];
  const traitContracts: RustNamedTypeTraitContractEntry[] = [];
  const types: RustProviderTypeRow[] = [];
  const binaryEpilogues: RustProviderBinaryEpilogueRow[] = [];
  for (const definition of definitions) {
    validateProviderPackageDefinition(definition);
    const providerId = rustProviderBindingProviderId(definition.id);
    const moduleByExportId = new Map(definition.modules.flatMap((module) =>
      module.exports.map((exported) => [exported.id, { module, exported }] as const)));
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
    traitContracts.push(...(definition.traitContracts ?? []).map((entry) =>
      snapshotClosedMetadata(entry)));
    for (const type of definition.types ?? []) {
      const owner = moduleByExportId.get(type.exportId);
      if (owner === undefined) {
        throw new Error(`Rust provider package '${definition.id}' type relation '${type.exportId}' has no declaration owner.`);
      }
      types.push(Object.freeze({
        ...type,
        providerPackageId: definition.id,
        providerId,
        providerVersion: definition.version,
        providerModuleId: owner.module.providerModuleId,
        moduleSpecifier: owner.module.moduleSpecifier,
      }));
    }
    const aliases = new Map((definition.aliasImports ?? []).map((entry) => [entry.alias, entry.path]));
    binaryEpilogues.push(...(definition.binaryEpilogues ?? []).map((epilogue) =>
      snapshotClosedMetadata(materializeProviderBinaryEpilogueRow(
        epilogue,
        aliases,
        {
          providerPackageId: definition.id,
          providerVersion: definition.version,
        },
      ))));
    operations.push(...definition.operations.map((row) => {
      const owner = moduleByExportId.get(row.exportId);
      if (owner === undefined) {
        throw new Error(`Rust provider package '${definition.id}' operation '${row.memberId ?? row.exportId}' has no declaration owner.`);
      }
      return materializeProviderOperationRow(row, aliases, {
        providerPackageId: definition.id,
        providerId,
        providerVersion: definition.version,
        providerModuleId: owner.module.providerModuleId,
        moduleSpecifier: owner.module.moduleSpecifier,
      });
    }));
  }
  return Object.freeze({
    exports: Object.freeze(exports),
    operations: Object.freeze(operations.map((row) => snapshotClosedMetadata(row))),
    traitContracts: mergeExactRows(
      traitContracts,
      (entry) => rustSemanticIdentityKey(entry.typeIdentity),
      "named-type trait contract",
    ),
    types: Object.freeze(types.map((row) => snapshotClosedMetadata(row))),
    binaryEpilogues: Object.freeze(binaryEpilogues),
  });
}

export function mergeRustProviderSemantics(
  ...inputs: readonly RustProviderSemantics[]
): RustProviderSemantics {
  const exports = mergeExactRows(inputs.flatMap((input) => input.exports), providerExportRowIdentity, "export");
  const operations = mergeExactRows(
    inputs.flatMap((input) => input.operations),
    providerOperationRowIdentity,
    "operation",
  );
  const types = mergeExactRows(
    inputs.flatMap((input) => input.types),
    providerTypeRowIdentity,
    "type",
  );
  const binaryEpilogues = mergeExactRows(
    inputs.flatMap((input) => input.binaryEpilogues),
    providerBinaryEpilogueIdentity,
    "binary epilogue",
  );
  const traitContracts = mergeExactRows(
    inputs.flatMap((input) => input.traitContracts),
    (entry) => rustSemanticIdentityKey(entry.typeIdentity),
    "named-type trait contract",
  );
  return Object.freeze({
    exports,
    operations,
    types,
    traitContracts,
    binaryEpilogues,
  });
}
