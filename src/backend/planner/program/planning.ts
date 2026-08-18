import type { SourceFile } from "@tsonic/tsts";
import { resolve } from "node:path";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import {
  KindFunctionDeclaration,
  Node_Name,
} from "@tsonic/target-api/source";
import { readRustCrateName, readRustOutputType } from "../../../options/rust-target-options.js";
import { cargoCrateAttributeName } from "../../../providers/model/cargo-reference.js";
import { isRustUnitCarrier } from "../../../policy/types/target-types.js";
import { createRustSourceFile } from "../../rust-ast/nodes.js";
import type { RustItem } from "../../rust-ast/nodes.js";
import { planRustCargoProject } from "../project/cargo.js";
import { rustAsyncFunctionFactKey, rustFallibleFactKey, rustSourceCallableReturnFactKey } from "../../../analysis/facts/keys.js";
import type { RustPlanningContext } from "../context.js";
import { reconstructRustSourceFiles } from "../artifacts/reconstruction.js";
import {
  planRustCrateInitializer,
  planRustModuleInitializers,
} from "./module-initialization.js";
import {
  allocateRustSupportModuleName,
  planRustSourceOutputIdentities,
} from "../../../analysis/program/source-output-identities.js";
import { planRustProgramErrorModule } from "./errors.js";
import { applyRustErrorBoundary } from "../types/error-boundary.js";
import { planRustStructuralShapeModule } from "../objects/structural-shapes.js";
import { rustPublicSignatureTypeNames } from "../../rust-ast/source-style.js";
import type {
  RustArtifactPlanResult,
  RustPlannedArtifact,
} from "../../artifacts/model.js";

export function planRustArtifacts(input: RustPlanningContext): RustArtifactPlanResult {
  const diagnostics: TargetDiagnostic[] = [];
  const identityPlan = planRustSourceOutputIdentities(input);
  if (identityPlan.kind === "rejected") {
    return { artifacts: [], diagnostics: [...diagnostics, ...identityPlan.diagnostics] };
  }
  const moduleNameByFileName = new Map(
    [...identityPlan.identities].map(([fileName, identity]) => [fileName, identity.moduleName] as const),
  );
  const structuralShapesModuleName = allocateRustSupportModuleName(
    identityPlan.identities,
    "shapes",
  );
  const programModuleName = allocateRustSupportModuleName(
    identityPlan.identities,
    "program",
    [structuralShapesModuleName],
  );
  const crateInitializerFunctionName = allocateRustSupportModuleName(
    identityPlan.identities,
    "initialize",
    [structuralShapesModuleName, programModuleName],
  );
  if (diagnostics.length > 0) {
    return { artifacts: [], diagnostics };
  }
  const plannedSources = reconstructRustSourceFiles(
    input,
    identityPlan.identities,
    programModuleName,
    structuralShapesModuleName,
    diagnostics,
  );
  if (plannedSources === undefined) {
    return { artifacts: [], diagnostics };
  }
  const structuralShapePathPrefix = `crate::${structuralShapesModuleName}::`;
  const publicStructuralShapeNames = new Set(plannedSources.flatMap((source) =>
    rustPublicSignatureTypeNames(source.model)
      .filter((name) => name.startsWith(structuralShapePathPrefix))
      .map((name) => name.slice(structuralShapePathPrefix.length))));
  const structuralShapeModel = planRustStructuralShapeModule(
    input,
    moduleNameByFileName,
    structuralShapesModuleName,
    publicStructuralShapeNames,
    diagnostics,
  );
  if (diagnostics.length > 0) {
    return { artifacts: [], diagnostics };
  }

  // Activation: a runtime crate is a dependency only when planned code
  // references it (directly or through a declared alias). Surface-selected
  // crates without carrier/operation use stay out of the manifest.
  const cargoProject = planRustCargoProject(input.target, input.paths, input.runtimeReferences);
  if (cargoProject.project === undefined) {
    return { artifacts: [], diagnostics: [...diagnostics, ...cargoProject.diagnostics] };
  }

  const outputType = readRustOutputType(input.target);
  const entryFunction = outputType === "bin"
    ? resolveBinaryEntry(input, moduleNameByFileName, diagnostics)
    : undefined;
  const hasModuleInitialization = plannedSources.some((source) =>
    source.moduleInitialization !== undefined);
  const entrySourceFile = outputType === "bin"
    ? entryFunction?.sourceFile
    : hasModuleInitialization
      ? resolveProjectEntrySourceFile(input, diagnostics)
      : undefined;
  const moduleInitializers = entrySourceFile === undefined
    ? []
    : planRustModuleInitializers(
        input,
        plannedSources,
        entrySourceFile,
        diagnostics,
      );

  if (diagnostics.length > 0) {
    return { artifacts: [], diagnostics };
  }

  const sortedSources = [...plannedSources].sort((left, right) =>
    left.moduleName.localeCompare(right.moduleName, "en"));
  const sortedTopLevelModuleNames = [...new Set(
    [...identityPlan.identities.values()].map((identity) => identity.moduleSegments[0]!),
  )].sort(compareRustArtifactNames);
  const programErrorModel = planRustProgramErrorModule(
    input,
    moduleNameByFileName,
    diagnostics,
  );
  if (diagnostics.length > 0) {
    return { artifacts: [], diagnostics };
  }
  const errorDomain = programErrorModel === undefined ? "runtime" as const : "project" as const;
  const crateInitializer = planRustCrateInitializer(
    moduleInitializers ?? [],
    crateInitializerFunctionName,
    programErrorModel === undefined
      ? "tsonic_rust_runtime::TsonicResult"
      : `crate::${programModuleName}::TsonicResult`,
    errorDomain,
  );
  const artifacts: RustPlannedArtifact[] = cargoProject.project.kind === "generated"
    ? [{
        kind: "project",
        path: "Cargo.toml",
        manifest: cargoProject.project.manifest,
      }]
    : [];
  const libraryModel = createRustSourceFile(
    [
      ...(programErrorModel === undefined
        ? []
        : [{
            kind: "mod-decl" as const,
            name: programModuleName,
            visibility: "public" as const,
            attrs: ["#[doc(hidden)]"],
          }]),
      ...(structuralShapeModel === undefined
        ? []
        : [{
            kind: "mod-decl" as const,
            name: structuralShapesModuleName,
            visibility: "public" as const,
            attrs: ["#[doc(hidden)]"],
          }]),
      ...sortedTopLevelModuleNames.map((name): RustItem => ({ kind: "mod-decl", name, visibility: "public" })),
      ...(crateInitializer === undefined ? [] : [crateInitializer.item]),
    ],
  );
  artifacts.push(rustSourceArtifact("src/lib.rs", libraryModel));
  if (programErrorModel !== undefined) {
    artifacts.push(rustSourceArtifact(
      `src/${programModuleName}.rs`,
      programErrorModel,
    ));
  }
  if (structuralShapeModel !== undefined) {
    artifacts.push(rustSourceArtifact(
      `src/${structuralShapesModuleName}.rs`,
      structuralShapeModel,
    ));
  }
  const sourceArtifacts: RustPlannedArtifact[] = planSyntheticModuleArtifacts(
    identityPlan.identities,
  );
  for (const source of sortedSources) {
    const identity = identityPlan.identities.get(input.ast.getFileName(source.sourceFile));
    if (identity === undefined) {
      diagnostics.push({
        code: "RUST_SOURCE_OUTPUT_IDENTITY_MISSING",
        category: "error",
        source: "tsonic-rust",
        message: `Planned Rust source module '${source.moduleName}' has no prepared output identity.`,
        evidence: ["target.capability=rust.backend.source-output-identity"],
      });
      continue;
    }
    sourceArtifacts.push(rustSourceArtifact(
      identity.artifactPath,
      source.model,
    ));
  }
  sourceArtifacts.sort((left, right) => compareRustArtifactNames(left.path, right.path));
  artifacts.push(...sourceArtifacts);
  if (diagnostics.length > 0) {
    return { artifacts: [], diagnostics };
  }
  if (outputType === "bin" && entryFunction !== undefined) {
    const crateName = readRustCrateName(input.target);
    const entryCall = {
      kind: "call" as const,
      path: `${crateName}::${entryFunction.moduleName}::${entryFunction.functionName}`,
      args: [],
    };
    const entryExecution = entryFunction.async
      ? {
          kind: "call" as const,
          path: "tsonic_rust_runtime::block_on",
          args: [entryCall],
        }
      : entryCall;
    const initializationStatements = crateInitializer === undefined
      ? []
      : [{
          kind: "expr" as const,
          expr: crateInitializer.fallible
            ? {
              kind: "try" as const,
              errorDomain,
              expr: crateInitializer.asynchronous
                  ? {
                      kind: "call" as const,
                      path: "tsonic_rust_runtime::block_on",
                      args: [{
                        kind: "call" as const,
                        path: `${crateName}::${crateInitializer.functionName}`,
                        args: [],
                      }],
                    }
                  : {
                      kind: "call" as const,
                      path: `${crateName}::${crateInitializer.functionName}`,
                      args: [],
                    },
              }
            : crateInitializer.asynchronous
              ? {
                  kind: "call" as const,
                  path: "tsonic_rust_runtime::block_on",
                  args: [{
                    kind: "call" as const,
                    path: `${crateName}::${crateInitializer.functionName}`,
                    args: [],
                  }],
                }
              : {
                  kind: "call" as const,
                  path: `${crateName}::${crateInitializer.functionName}`,
                  args: [],
                },
        }];
    const activeCrates = new Set(input.runtimeReferences.flatMap((reference) => {
      const crate = reference.attributes?.[cargoCrateAttributeName];
      return typeof crate === "string" ? [crate] : [];
    }));
    const activeEpilogues = input.providerSemantics.binaryEpilogues.filter((epilogue) =>
      activeCrates.has(epilogue.requiredCrate));
    const epilogueStatements = activeEpilogues.map((epilogue) => {
      const call = { kind: "call" as const, path: epilogue.path, args: [] };
      if (epilogue.isFallible !== true) {
        return { kind: "expr" as const, expr: call };
      }
      return {
        kind: "expr" as const,
        expr: applyRustErrorBoundary(call, epilogue.errorBoundary, errorDomain),
      };
    });
    const mainFallible = entryFunction.fallible ||
      crateInitializer?.fallible === true ||
      activeEpilogues.some((epilogue) => epilogue.isFallible === true);
    const entryStatement = {
      kind: "expr" as const,
      expr: entryFunction.fallible
        ? { kind: "try" as const, expr: entryExecution, errorDomain }
        : entryExecution,
    };
    const completionStatements = mainFallible
      ? [{ kind: "tail" as const, expr: { kind: "path" as const, path: "Ok(())" } }]
      : [];
    const mainItem: RustItem = {
      kind: "function",
      name: "main",
      visibility: "private",
      params: [],
      ...(mainFallible
        ? {
            returnType: {
              kind: "named" as const,
              path: programErrorModel === undefined
                ? "tsonic_rust_runtime::TsonicResult"
                : `${crateName}::${programModuleName}::TsonicResult`,
              typeArguments: [{ kind: "unit" as const }],
            },
            body: { statements: [...initializationStatements, entryStatement, ...epilogueStatements, ...completionStatements] },
          }
        : { body: { statements: [...initializationStatements, entryStatement, ...epilogueStatements] } }),
    };
    artifacts.push(rustSourceArtifact("src/main.rs", createRustSourceFile([mainItem])));
  }
  return { artifacts, diagnostics: [] };
}

function planSyntheticModuleArtifacts(
  identities: ReadonlyMap<string, import("../../../analysis/program/source-output-identities.js").RustSourceFileOutputIdentity>,
): RustPlannedArtifact[] {
  const authoredModules = new Set(
    [...identities.values()].map((identity) => identity.moduleName),
  );
  const childNamesByParent = new Map<string, Set<string>>();
  for (const identity of identities.values()) {
    for (let depth = 1; depth < identity.moduleSegments.length; depth += 1) {
      const parent = identity.moduleSegments.slice(0, depth).join("::");
      const children = childNamesByParent.get(parent) ?? new Set<string>();
      children.add(identity.moduleSegments[depth]!);
      childNamesByParent.set(parent, children);
    }
  }
  return [...childNamesByParent]
    .filter(([moduleName]) => !authoredModules.has(moduleName))
    .sort(([left], [right]) => compareRustArtifactNames(left, right))
    .map(([moduleName, children]) => rustSourceArtifact(
      `src/${moduleName.split("::").join("/")}.rs`,
      createRustSourceFile(
        [...children]
          .sort(compareRustArtifactNames)
          .map((name): RustItem => ({
            kind: "mod-decl",
            name,
            visibility: "public",
          })),
      ),
    ));
}

function compareRustArtifactNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function rustSourceArtifact(
  path: string,
  model: import("../../rust-ast/nodes.js").RustSourceFileModel,
): RustPlannedArtifact {
  return { kind: "source", path, model };
}

interface RustBinaryEntry {
  readonly sourceFile: SourceFile;
  readonly moduleName: string;
  readonly functionName: string;
  readonly async: boolean;
  readonly fallible: boolean;
}

function resolveProjectEntrySourceFile(
  input: RustPlanningContext,
  diagnostics: TargetDiagnostic[],
): SourceFile | undefined {
  const entryPoint = normalizeSourcePath(resolve(input.paths.projectRoot, input.project.entryPoint));
  const sourceFile = input.sourceFiles.find((candidate) =>
    normalizeSourcePath(resolve(input.ast.getFileName(candidate))) === entryPoint
  );
  if (sourceFile === undefined) {
    diagnostics.push({
      code: "RUST_MISSING_ENTRYPOINT",
      category: "error",
      source: "tsonic-rust",
      message: `Rust output requires entry point '${entryPoint}' to be part of the compiled sources.`,
      evidence: ["target.capability=rust.backend.entrypoint"],
    });
    return undefined;
  }
  return sourceFile;
}

function normalizeSourcePath(path: string): string {
  return path.split("\\").join("/");
}

function resolveBinaryEntry(
  input: RustPlanningContext,
  moduleNameByFileName: ReadonlyMap<string, string>,
  diagnostics: TargetDiagnostic[],
): RustBinaryEntry | undefined {
  const entryPoint = input.project.entryPoint;
  const entrySourceFile = resolveProjectEntrySourceFile(input, diagnostics);
  if (entrySourceFile === undefined) {
    return undefined;
  }
  const entryFileName = entrySourceFile === undefined ? undefined : input.ast.getFileName(entrySourceFile);
  const moduleName = entryFileName === undefined ? undefined : moduleNameByFileName.get(entryFileName);
  if (moduleName === undefined) {
    diagnostics.push({
      code: "RUST_MISSING_ENTRYPOINT",
      category: "error",
      source: "tsonic-rust",
      message: `Binary output requires entry point '${entryPoint}' to be part of the compiled sources.`,
      evidence: ["target.capability=rust.backend.entrypoint"],
    });
    return undefined;
  }
  for (const statement of input.ast.statements(entrySourceFile)) {
    if (statement === undefined || input.ast.kindName(statement) !== KindFunctionDeclaration) {
      continue;
    }
    const nameNode = Node_Name(input.ast, statement);
    if (nameNode === undefined || input.ast.text(nameNode) !== "main") {
      continue;
    }
    const asyncFact = input.facts.getFact(statement, rustAsyncFunctionFactKey);
    const returnCarrier = asyncFact?.outputCarrier ??
      input.facts.getFact(statement, rustSourceCallableReturnFactKey)?.returnCarrier;
    if (!input.ast.hasModifierKind(statement, "export") || !isRustUnitCarrier(returnCarrier)) {
      break;
    }
    return {
      sourceFile: entrySourceFile,
      moduleName,
      functionName: "main",
      async: asyncFact !== undefined,
      fallible: input.facts.getFact(statement, rustFallibleFactKey) !== undefined,
    };
  }
  diagnostics.push({
    code: "RUST_MISSING_ENTRYPOINT",
    category: "error",
    source: "tsonic-rust",
    message: "Binary output requires the entry module to export a 'main' function returning void.",
    evidence: ["target.capability=rust.backend.entrypoint"],
  });
  return undefined;
}
