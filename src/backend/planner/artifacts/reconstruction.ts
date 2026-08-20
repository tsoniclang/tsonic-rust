import type { SourceFile } from "@tsonic/tsts";
import { sourceFileIdentity } from "@tsonic/target-api/source";
import { reconstructTargetArtifacts } from "@tsonic/target-api/artifacts";
import type {
  TargetArtifactDependency,
  TargetArtifactReconstruction,
  TargetDiagnostic,
} from "@tsonic/target-api/artifacts";
import type {
  RustArtifactFacet,
  RustArtifactSnapshot,
} from "./index.js";
import type { RustPlanningContext } from "../context.js";
import type { RustSourceFileOutputIdentity } from "../names/source-output-identities.js";
import {
  rustSourceFileContractCandidate,
} from "./source-file-contract.js";
import {
  planRustSourceFile,
} from "../program/source-file.js";
import type {
  PlannedRustSourceFile,
} from "../program/source-file.js";
import type { RustSourcePackageComponentPlan } from "../program/source-package-components.js";
import type { RustSourcePackageErrorPlan } from "../program/source-package-errors.js";
import { rustSourceItemIdentity } from "../program/source-package-facades.js";
import type { RustSourceFileModel } from "../../target-ast/nodes.js";

const minimumRustArtifactReconstructionCount = 64;
const maximumReconstructionsPerSourceFile = 32;

export interface RustSourceFileReconstructionPlan {
  readonly sourcesByComponentId: ReadonlyMap<
    string,
    readonly PlannedRustSourceFile[]
  >;
  readonly externalItemPathByIdentity: ReadonlyMap<string, string>;
}

export function reconstructRustSourceFiles(
  input: RustPlanningContext,
  identitiesByFileName: ReadonlyMap<string, RustSourceFileOutputIdentity>,
  facadeExternalItemPathByIdentity: ReadonlyMap<string, string>,
  externalStructuralShapeModuleByFileName: ReadonlyMap<string, string>,
  components: readonly RustSourcePackageComponentPlan[],
  sourcePackageErrors: RustSourcePackageErrorPlan,
  diagnostics: TargetDiagnostic[],
): RustSourceFileReconstructionPlan | undefined {
  const sourceFilesByOwner = new Map<string, SourceFile>();
  const ownerBySourceFile = new Map<SourceFile, string>();
  const ownersByComponent = new Map<string, string[]>();
  const componentById = new Map(components.map((component) =>
    [component.componentId, component] as const));
  const moduleNameByFileName = new Map(
    [...identitiesByFileName].map(([fileName, identity]) =>
      [fileName, identity.moduleName] as const),
  );
  const externalCrateNameByFileName = new Map(
    [...identitiesByFileName]
      .filter(([, identity]) => identity.externalCrateName !== undefined)
      .map(([fileName, identity]) =>
        [fileName, identity.externalCrateName!] as const),
  );
  for (const sourceFile of input.program.sourceFiles) {
    const owner = sourceFileArtifactOwner(input, sourceFile);
    if (owner === undefined) {
      diagnostics.push(reconstructionDiagnostic(
        "RUST_SOURCE_FILE_ARTIFACT_IDENTITY_MISSING",
        "One project source file has no stable compiler-owned identity for Rust artifact reconstruction.",
      ));
      return undefined;
    }
    if (sourceFilesByOwner.has(owner)) {
      diagnostics.push(reconstructionDiagnostic(
        "RUST_SOURCE_FILE_ARTIFACT_IDENTITY_CONFLICT",
        `Multiple project source files resolve to Rust artifact owner '${owner}'.`,
      ));
      return undefined;
    }
    sourceFilesByOwner.set(owner, sourceFile);
    ownerBySourceFile.set(sourceFile, owner);
    const fileName = input.program.source.ast.getFileName(sourceFile);
    const identity = identitiesByFileName.get(fileName);
    const component = identity === undefined
      ? undefined
      : componentById.get(identity.componentId);
    if (identity === undefined || component === undefined) {
      diagnostics.push(reconstructionDiagnostic(
        "RUST_SOURCE_PACKAGE_COMPONENT_IDENTITY_MISSING",
        `Rust source file '${fileName}' has no exact source-package component plan.`,
      ));
      return undefined;
    }
    const owners = ownersByComponent.get(component.componentId) ?? [];
    owners.push(owner);
    ownersByComponent.set(component.componentId, owners);
  }
  for (const owners of ownersByComponent.values()) {
    owners.sort((left, right) => left.localeCompare(right, "en"));
  }

  const maximumReconstructionCount = rustArtifactReconstructionBudget(
    sourceFilesByOwner.size,
  );
  if (maximumReconstructionCount === undefined) {
    diagnostics.push(reconstructionDiagnostic(
      "RUST_TARGET_ARTIFACT_RECONSTRUCTION_BUDGET_INVALID",
      "The project source-file count cannot produce a finite Rust artifact reconstruction budget.",
    ));
    return undefined;
  }

  const plannedByOwner = new Map<string, PlannedRustSourceFile>();
  const diagnosticsByOwner = new Map<string, readonly TargetDiagnostic[]>();
  const externalItemPathByIdentity = new Map(facadeExternalItemPathByIdentity);
  const plannedExternalItemIdentitiesByOwner = new Map<string, ReadonlySet<string>>();
  const reconstruction = reconstructTargetArtifacts(
    input.artifacts.contractGraph,
    [...sourceFilesByOwner.keys()].sort((left, right) =>
      left.localeCompare(right, "en")),
    (owner, graph): TargetArtifactReconstruction<
      RustArtifactFacet,
      RustArtifactSnapshot
    > => {
      const sourceFile = sourceFilesByOwner.get(owner);
      if (sourceFile === undefined) {
        return input.artifacts.reconstructArtifact(owner);
      }
      const fileName = input.program.source.ast.getFileName(sourceFile);
      const identity = identitiesByFileName.get(fileName);
      if (identity === undefined) {
        return {
          kind: "rejected",
          code: "RUST_SOURCE_FILE_MODULE_IDENTITY_MISSING",
          reason: `Rust source artifact '${owner}' has no finalized module identity.`,
        };
      }
      const component = componentById.get(identity.componentId);
      if (component === undefined) {
        return {
          kind: "rejected",
          code: "RUST_SOURCE_PACKAGE_COMPONENT_IDENTITY_MISSING",
          reason: `Rust source artifact '${owner}' has no exact source-package component plan.`,
        };
      }
      const componentDependencies = component.dependencyComponentIds.flatMap(
        (dependencyComponentId) =>
          (ownersByComponent.get(dependencyComponentId) ?? []).map((dependencyOwner) => ({
            owner: dependencyOwner,
            facet: "source-file-public-surface" as const,
          })),
      );
      if (componentDependencies.some((dependency) =>
        !graph.hasPublishedFacet(dependency))) {
        return {
          kind: "blocked",
          reason:
            `Rust source artifact '${owner}' requires complete target linkage from its source-package dependencies.`,
          dependencies: Object.freeze(componentDependencies),
        };
      }
      const revision = graph.revision;
      const candidateDiagnostics: TargetDiagnostic[] = [];
      const captured = input.artifacts.captureDependencies(owner, () =>
        planRustSourceFile(
          sourceFile,
          identity.moduleName,
          identity.componentId,
          component.crateName,
          moduleNameByFileName,
          externalCrateNameByFileName,
          externalItemPathByIdentity,
          externalStructuralShapeModuleByFileName,
          component.programModuleName,
          component.structuralShapesModuleName,
          identity.childModuleNames,
          component.publicModuleNames,
          component.publicImplementationModuleNames,
          component.publicImplementationItemIdentities,
          component.publishesImplementationAbi,
          component.errorDomain,
          sourcePackageErrors,
          input,
          candidateDiagnostics,
        )
      );
      if (graph.revision !== revision) {
        return {
          kind: "retry",
          reason:
            "Rust planning discovered or strengthened an exact prerequisite target artifact contract.",
        };
      }
      if (candidateDiagnostics.length > 0) {
        diagnosticsByOwner.set(
          owner,
          Object.freeze([...candidateDiagnostics]),
        );
        return {
          kind: "rejected",
          code: "RUST_SOURCE_FILE_RECONSTRUCTION_REJECTED",
          reason:
            `Rust source artifact '${owner}' produced target diagnostics during reconstruction.`,
        };
      }
      const moduleDependencies = sourceFilePublicDependencies(
        input,
        sourceFile,
        owner,
        ownerBySourceFile,
      );
      if (moduleDependencies.kind === "rejected") {
        return moduleDependencies;
      }
      if (component.crateName !== undefined) {
        const itemNames = rustSourceFileItemNames(captured.value.model);
        plannedExternalItemIdentitiesByOwner.set(owner, new Set(
          itemNames.map((itemName) => rustSourceItemIdentity(fileName, itemName)),
        ));
        for (const itemName of itemNames) {
          const itemIdentity = rustSourceItemIdentity(fileName, itemName);
          if (!externalItemPathByIdentity.has(itemIdentity)) {
            externalItemPathByIdentity.set(
              itemIdentity,
              `${component.crateName}::${identity.moduleName}::${itemName}`,
            );
          }
        }
      }
      const candidate = rustSourceFileContractCandidate(
        owner,
        captured.value.model,
        [...moduleDependencies.dependencies, ...captured.dependencies],
      );
      plannedByOwner.set(owner, captured.value);
      return {
        kind: "resolved",
        contract: candidate.contract,
        dependencies: candidate.dependencies,
        artifact: candidate.artifact,
      };
    },
    { maximumReconstructionCount },
  );
  if (reconstruction.kind === "rejected") {
    diagnostics.push(reconstructionDiagnostic(
      reconstruction.code,
      reconstruction.reason,
    ));
    return undefined;
  }
  if (reconstruction.kind === "failed") {
    for (const failure of reconstruction.failures) {
      diagnostics.push(...(
        diagnosticsByOwner.get(failure.owner) ?? [reconstructionDiagnostic(
          failure.code,
          failure.reason,
        )]
      ));
    }
    return undefined;
  }
  const closure = input.artifacts.verifyContractClosure();
  if (closure.kind === "rejected") {
    diagnostics.push(reconstructionDiagnostic(
      "RUST_TARGET_ARTIFACT_CONTRACT_OPEN",
      closure.reason,
    ));
    return undefined;
  }
  const plannedExternalItemIdentities = new Set(
    [...plannedExternalItemIdentitiesByOwner.values()].flatMap((identities) =>
      [...identities]),
  );
  for (const itemIdentity of facadeExternalItemPathByIdentity.keys()) {
    if (!plannedExternalItemIdentities.has(itemIdentity)) {
      diagnostics.push(reconstructionDiagnostic(
        "RUST_SOURCE_PACKAGE_LINKAGE_ITEM_MISSING",
        "An external source-package facade names an item absent from its exact planned Rust implementation.",
      ));
    }
  }
  if (diagnostics.length > 0) {
    return undefined;
  }
  const rootComponent = components.find((component) => component.root);
  if (rootComponent === undefined) {
    diagnostics.push(reconstructionDiagnostic(
      "RUST_SOURCE_PACKAGE_COMPONENT_ROOT_MISSING",
      "Rust source reconstruction has no exact root source-package component.",
    ));
    return undefined;
  }
  const sourcesByComponentId = new Map(components.map((component) => [
    component.componentId,
    Object.freeze(input.program.sourceFiles.flatMap((sourceFile) => {
      const identity = identitiesByFileName.get(input.program.source.ast.getFileName(sourceFile));
      if (identity?.componentId !== component.componentId) {
        return [];
      }
      const owner = ownerBySourceFile.get(sourceFile);
      const planned = owner === undefined ? undefined : plannedByOwner.get(owner);
      return planned === undefined ? [] : [planned];
    })),
  ] as const));
  return Object.freeze({
    sourcesByComponentId: new Map(sourcesByComponentId),
    externalItemPathByIdentity: new Map(externalItemPathByIdentity),
  });
}

function rustSourceFileItemNames(model: RustSourceFileModel): readonly string[] {
  return Object.freeze(model.items.flatMap((item) => {
    switch (item.kind) {
      case "function":
      case "const":
      case "thread-local":
      case "struct":
      case "trait":
      case "enum":
      case "type-alias":
        return [item.name];
      case "mod-decl":
      case "impl":
      case "use":
        return [];
    }
  }));
}

function sourceFilePublicDependencies(
  input: RustPlanningContext,
  sourceFile: SourceFile,
  owner: string,
  ownerBySourceFile: ReadonlyMap<SourceFile, string>,
):
  | {
      readonly kind: "resolved";
      readonly dependencies: readonly TargetArtifactDependency<RustArtifactFacet>[];
    }
  | {
      readonly kind: "rejected";
      readonly code: string;
      readonly reason: string;
    } {
  const dependencies: TargetArtifactDependency<RustArtifactFacet>[] = [];
  for (const reference of input.program.source.navigation.moduleReferences(sourceFile)) {
    const dependencyOwner = ownerBySourceFile.get(reference.sourceFile) ??
      sourceFileArtifactOwner(input, reference.sourceFile);
    if (dependencyOwner === undefined) {
      return {
        kind: "rejected",
        code: "RUST_SOURCE_FILE_DEPENDENCY_IDENTITY_MISSING",
        reason:
          `A project module referenced by '${owner}' has no stable Rust artifact identity.`,
      };
    }
    if (dependencyOwner !== owner) {
      dependencies.push({
        owner: dependencyOwner,
        facet: "source-file-public-surface",
      });
    }
  }
  return {
    kind: "resolved",
    dependencies: Object.freeze(dependencies),
  };
}

function sourceFileArtifactOwner(
  input: RustPlanningContext,
  sourceFile: SourceFile,
): string | undefined {
  const identity = sourceFileIdentity(input.program.source.ast, sourceFile);
  return identity === undefined ? undefined : `source-file:${identity}`;
}

function rustArtifactReconstructionBudget(
  sourceFileCount: number,
): number | undefined {
  const proportional = sourceFileCount * maximumReconstructionsPerSourceFile;
  return Number.isSafeInteger(proportional) && proportional >= 0
    ? Math.max(minimumRustArtifactReconstructionCount, proportional)
    : undefined;
}

function reconstructionDiagnostic(
  code: string,
  message: string,
): TargetDiagnostic {
  return {
    code,
    category: "error",
    source: "tsonic-rust",
    message,
  };
}
