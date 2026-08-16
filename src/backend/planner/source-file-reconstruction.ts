import type { SourceFile } from "@tsonic/tsts";
import {
  reconstructTargetArtifacts,
  sourceFileIdentity,
} from "@tsonic/target-api";
import type {
  TargetArtifactDependency,
  TargetArtifactReconstruction,
  TargetDiagnostic,
} from "@tsonic/target-api";
import type {
  RustArtifactFacet,
  RustArtifactSnapshot,
} from "../../translate/artifacts/index.js";
import type { RustTranslationContext } from "../../translate/context.js";
import type { RustSourceFileOutputIdentity } from "../../translate/artifacts/source-output-identities.js";
import {
  rustSourceFileContractCandidate,
} from "./source-file-artifact-contract.js";
import {
  planRustSourceFile,
} from "./source-file-planner.js";
import type {
  PlannedRustSourceFile,
} from "./source-file-planner.js";

const minimumRustArtifactReconstructionCount = 64;
const maximumReconstructionsPerSourceFile = 32;

export function reconstructRustSourceFiles(
  input: RustTranslationContext,
  identitiesByFileName: ReadonlyMap<string, RustSourceFileOutputIdentity>,
  programModuleName: string,
  structuralShapesModuleName: string,
  diagnostics: TargetDiagnostic[],
): readonly PlannedRustSourceFile[] | undefined {
  const sourceFilesByOwner = new Map<string, SourceFile>();
  const ownerBySourceFile = new Map<SourceFile, string>();
  for (const sourceFile of input.sourceFiles) {
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
      const fileName = input.ast.getFileName(sourceFile);
      const identity = identitiesByFileName.get(fileName);
      if (identity === undefined) {
        return {
          kind: "rejected",
          code: "RUST_SOURCE_FILE_MODULE_IDENTITY_MISSING",
          reason: `Rust source artifact '${owner}' has no finalized module identity.`,
        };
      }
      const revision = graph.revision;
      const candidateDiagnostics: TargetDiagnostic[] = [];
      const captured = input.artifacts.captureDependencies(owner, () =>
        planRustSourceFile(
          sourceFile,
          identity.moduleName,
          new Map(
            [...identitiesByFileName].map(([candidateFileName, candidate]) =>
              [candidateFileName, candidate.moduleName] as const),
          ),
          programModuleName,
          structuralShapesModuleName,
          identity.childModuleNames,
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
  return Object.freeze(input.sourceFiles.flatMap((sourceFile) => {
    const owner = ownerBySourceFile.get(sourceFile);
    const planned = owner === undefined ? undefined : plannedByOwner.get(owner);
    return planned === undefined ? [] : [planned];
  }));
}

function sourceFilePublicDependencies(
  input: RustTranslationContext,
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
  for (const reference of input.source.navigation.moduleReferences(sourceFile)) {
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
  input: RustTranslationContext,
  sourceFile: SourceFile,
): string | undefined {
  const identity = sourceFileIdentity(input.ast, sourceFile);
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
