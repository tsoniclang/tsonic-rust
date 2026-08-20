import {
  canonicalizeProviderOperationRow,
  materializeProviderBinaryEpilogueRow,
  materializeProviderCarrier,
  materializeProviderOperationRow,
} from "./materialization.js";
import { rustProviderBindingProviderId } from "./source-provider.js";
import { validateProviderPackageDefinition } from "./validation.js";
import { snapshotClosedMetadata } from "../../policy/model/closed-data.js";
import { rustBuiltInSourceTypeSemantics } from "../builtins/source-types.js";
import type { RustNamedTypeTraitContract } from "../../policy/types/model.js";
import { rustProviderPolicyContributionKind } from "./model.js";
import type { RustProviderBinaryEpilogueRow, RustProviderExportRow, RustProviderOperationRow, RustProviderPackageDefinition, RustProviderPolicyContribution, RustProviderSemantics, RustProviderTypeRow } from "./model.js";
import type { TargetCapabilityContext, TargetProviderContext } from "@tsonic/target-api/provider";

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
      if (contribution.kind !== rustProviderPolicyContributionKind) {
        continue;
      }
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
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(row)) {
      throw new Error(`Rust provider ${kind} '${identity}' has conflicting definitions.`);
    }
    byIdentity.set(identity, row);
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
  return `${providerExportRowIdentity(row)}\0${row.sourceTypeParameters.join("\0")}\0${JSON.stringify(row.targetCarrier)}`;
}

export function providerBinaryEpilogueIdentity(row: RustProviderBinaryEpilogueRow): string {
  return `${row.providerPackageId}\0${row.id}`;
}

export function collectRustProviderSemantics(
  context: TargetProviderContext,
): RustProviderSemantics {
  return collectRustProviderSemanticsFromDefinitions(
    rustProviderPolicyContributionsOf(context).map((contribution) => contribution.definition),
  );
}

export function composeRustProviderSemantics(
  context: TargetProviderContext,
  compilerProviderSemantics?: RustProviderSemantics,
): RustProviderSemantics {
  return mergeRustProviderSemantics(
    rustBuiltInSourceTypeSemantics(),
    collectRustProviderSemantics(context),
    ...(compilerProviderSemantics === undefined ? [] : [compilerProviderSemantics]),
  );
}

export function collectRustProviderSemanticsFromDefinitions(
  definitions: readonly RustProviderPackageDefinition[],
): RustProviderSemantics {
  const exports: RustProviderExportRow[] = [];
  const operations: RustProviderOperationRow[] = [];
  const carrierPaths = new Map<string, string>();
  const carrierTraits = new Map<string, RustNamedTypeTraitContract>();
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
    const carrierPathRows = definition.carrierPaths ?? {};
    const carrierTraitRows = definition.carrierTraits ?? {};
    for (const [carrierId, path] of Object.entries(carrierPathRows)) {
      const existing = carrierPaths.get(carrierId);
      if (existing !== undefined && existing !== path) {
        throw new Error(`Rust provider carrier '${carrierId}' has conflicting target paths '${existing}' and '${path}'.`);
      }
      carrierPaths.set(carrierId, path);
    }
    for (const [carrierId, traits] of Object.entries(carrierTraitRows)) {
      const existing = carrierTraits.get(carrierId);
      if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(traits)) {
        throw new Error(`Rust provider carrier '${carrierId}' has conflicting native trait contracts.`);
      }
      carrierTraits.set(carrierId, traits);
    }
    for (const type of definition.types ?? []) {
      const owner = moduleByExportId.get(type.exportId);
      if (owner === undefined) {
        throw new Error(`Rust provider package '${definition.id}' type relation '${type.exportId}' has no declaration owner.`);
      }
      types.push(Object.freeze({
        ...type,
        targetCarrier: materializeProviderCarrier(type.targetCarrier, carrierPathRows, carrierTraitRows),
        providerPackageId: definition.id,
        providerId,
        providerVersion: definition.version,
        providerModuleId: owner.module.providerModuleId,
        moduleSpecifier: owner.module.moduleSpecifier,
        sourceTypeParameters: Object.freeze(
          (owner.exported.typeParameters ?? []).map((parameter) => parameter.name),
        ),
      }));
    }
    const aliases = new Map((definition.aliasImports ?? []).map((entry) => [entry.alias, entry.path]));
    binaryEpilogues.push(...(definition.binaryEpilogues ?? []).map((epilogue) =>
      Object.freeze(materializeProviderBinaryEpilogueRow(
        epilogue,
        aliases,
        carrierPathRows,
        carrierTraitRows,
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
      return materializeProviderOperationRow(row, aliases, carrierPathRows, carrierTraitRows, {
        providerPackageId: definition.id,
        providerId,
        providerVersion: definition.version,
        providerModuleId: owner.module.providerModuleId,
        moduleSpecifier: owner.module.moduleSpecifier,
      });
    }));
  }
  return {
    exports: Object.freeze(exports),
    operations: Object.freeze(operations.map((row) =>
      canonicalizeProviderOperationRow(row, carrierPaths, carrierTraits))),
    carrierPaths,
    carrierTraits,
    types: Object.freeze(types.map((row) => Object.freeze({
      ...row,
      targetCarrier: materializeProviderCarrier(row.targetCarrier, carrierPaths, carrierTraits),
    }))),
    binaryEpilogues: Object.freeze(binaryEpilogues),
  };
}

export function mergeRustProviderSemantics(
  ...inputs: readonly RustProviderSemantics[]
): RustProviderSemantics {
  const carrierPaths = new Map<string, string>();
  const carrierTraits = new Map<string, RustNamedTypeTraitContract>();
  for (const input of inputs) {
    for (const [id, path] of input.carrierPaths) {
      const existing = carrierPaths.get(id);
      if (existing !== undefined && existing !== path) {
        throw new Error(`Rust provider carrier '${id}' has conflicting target paths '${existing}' and '${path}'.`);
      }
      carrierPaths.set(id, path);
    }
    for (const [id, traits] of input.carrierTraits) {
      const existing = carrierTraits.get(id);
      if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(traits)) {
        throw new Error(`Rust provider carrier '${id}' has conflicting native trait contracts.`);
      }
      carrierTraits.set(id, traits);
    }
  }
  const exports = mergeExactRows(inputs.flatMap((input) => input.exports), providerExportRowIdentity, "export");
  const operations = mergeExactRows(
    inputs.flatMap((input) => input.operations).map((row) =>
      canonicalizeProviderOperationRow(row, carrierPaths, carrierTraits)),
    providerOperationRowIdentity,
    "operation",
  );
  const types = mergeExactRows(
    inputs.flatMap((input) => input.types).map((row) => Object.freeze({
      ...row,
      targetCarrier: materializeProviderCarrier(row.targetCarrier, carrierPaths, carrierTraits),
    })),
    providerTypeRowIdentity,
    "type",
  );
  const binaryEpilogues = mergeExactRows(
    inputs.flatMap((input) => input.binaryEpilogues),
    providerBinaryEpilogueIdentity,
    "binary epilogue",
  );
  return Object.freeze({
    exports,
    operations,
    types,
    binaryEpilogues,
    carrierPaths: new Map([...carrierPaths.entries()].sort(([left], [right]) => left.localeCompare(right, "en"))),
    carrierTraits: new Map([...carrierTraits.entries()].sort(([left], [right]) => left.localeCompare(right, "en"))),
  });
}
