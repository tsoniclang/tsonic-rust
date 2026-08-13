import type { SourceFile } from "@tsonic/tsts";
import type {
  TargetArtifact,
  TargetCompileResult,
  TargetDiagnostic,
  TargetSourceFile,
} from "@tsonic/target-api";
import {
  KindFunctionDeclaration,
  Node_Name,
} from "../../common/source-ast.js";
import { readRustCrateName, readRustOutputType } from "../../options/rust-target-options.js";
import { cargoCrateAttributeName } from "./cargo-project.js";
import { isRustUnitCarrier } from "../../source/rust-target-types.js";
import { createRustSourceFile } from "../rust-ast/nodes.js";
import type { RustItem } from "../rust-ast/nodes.js";
import { printRustSourceFile } from "../../print/rust-printer.js";
import { printCargoManifest } from "../../print/cargo-manifest-printer.js";
import { planRustCargoProject } from "./cargo-project.js";
import { rustAsyncFunctionFactKey, rustFallibleFactKey, rustSourceCallableReturnFactKey } from "../../source/rust-facts/keys.js";
import type { RustTranslationContext } from "../../translate/context.js";
import { reconstructRustSourceFiles } from "./source-file-reconstruction.js";
import {
  diagnoseRustLibraryModuleInitialization,
  planRustBinaryModuleInitializers,
} from "./module-initialization.js";
import { planRustSourceOutputIdentities } from "../../translate/artifacts/source-output-identities.js";
import { planRustProgramErrorModule } from "./program-errors.js";

export function planRustArtifacts(input: RustTranslationContext): TargetCompileResult {
  const diagnostics: TargetDiagnostic[] = [...input.diagnostics];
  const identityPlan = planRustSourceOutputIdentities(input);
  if (identityPlan.kind === "rejected") {
    return { artifacts: [], diagnostics: [...diagnostics, ...identityPlan.diagnostics] };
  }
  const moduleNameByFileName = new Map(
    [...identityPlan.identities].map(([fileName, identity]) => [fileName, identity.moduleName] as const),
  );
  if (diagnostics.length > 0) {
    return { artifacts: [], diagnostics };
  }

  const plannedSources = reconstructRustSourceFiles(
    input,
    moduleNameByFileName,
    diagnostics,
  );
  if (plannedSources === undefined) {
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
  if (outputType === "lib") {
    diagnoseRustLibraryModuleInitialization(input, plannedSources, diagnostics);
  }
  const moduleInitializers = outputType === "bin" && entryFunction !== undefined
    ? planRustBinaryModuleInitializers(
        input,
        plannedSources,
        entryFunction.sourceFile,
        diagnostics,
      )
    : [];

  if (diagnostics.length > 0) {
    return { artifacts: [], diagnostics };
  }

  const sortedSources = [...plannedSources].sort((left, right) =>
    left.moduleName.localeCompare(right.moduleName, "en"));
  const sortedModuleNames = sortedSources.map((source) => source.moduleName);
  const programErrorModel = planRustProgramErrorModule(
    input,
    moduleNameByFileName,
    diagnostics,
  );
  if (diagnostics.length > 0) {
    return { artifacts: [], diagnostics };
  }
  const artifacts: TargetArtifact[] = cargoProject.project.kind === "generated"
    ? [{
        kind: "project",
        path: "Cargo.toml",
        text: printCargoManifest(cargoProject.project.manifest),
      }]
    : [];
  const libraryModel = createRustSourceFile(
    [
      ...(programErrorModel === undefined
        ? []
        : [{
            kind: "mod-decl" as const,
            name: "__tsonic_program",
            visibility: "public" as const,
            attrs: ["#[doc(hidden)]"],
          }]),
      ...sortedModuleNames.map((name): RustItem => ({ kind: "mod-decl", name, visibility: "public" })),
    ],
  );
  artifacts.push(rustSourceArtifact("src/lib.rs", printRustSourceFile(libraryModel)));
  if (programErrorModel !== undefined) {
    artifacts.push(rustSourceArtifact(
      "src/__tsonic_program.rs",
      printRustSourceFile(programErrorModel),
    ));
  }
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
    artifacts.push(rustSourceArtifact(
      identity.artifactPath,
      printRustSourceFile(source.model),
    ));
  }
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
    const initializationStatements = (moduleInitializers ?? []).map((initializer) => {
      const call = {
        kind: "call" as const,
        path: `${crateName}::${initializer.moduleName}::${initializer.functionName}`,
        args: [],
      };
      const execution = initializer.asynchronous
        ? {
            kind: "call" as const,
            path: "tsonic_rust_runtime::block_on",
            args: [call],
          }
        : call;
      return {
        kind: "expr" as const,
        expr: initializer.fallible
          ? { kind: "try" as const, expr: execution }
          : execution,
      };
    });
    const activeCrates = new Set(input.runtimeReferences.flatMap((reference) => {
      const crate = reference.attributes?.[cargoCrateAttributeName];
      return typeof crate === "string" ? [crate] : [];
    }));
    const activeEpilogues = input.providerSemantics.binaryEpilogues.filter((epilogue) =>
      activeCrates.has(epilogue.requiredCrate));
    const epilogueStatements = activeEpilogues.map((epilogue) => ({
      kind: "expr" as const,
      expr: epilogue.isFallible === true
        ? {
            kind: "try" as const,
            expr: { kind: "call" as const, path: epilogue.path, args: [] },
          }
        : { kind: "call" as const, path: epilogue.path, args: [] },
    }));
    const mainFallible = entryFunction.fallible ||
      (moduleInitializers ?? []).some((initializer) => initializer.fallible) ||
      activeEpilogues.some((epilogue) => epilogue.isFallible === true);
    const entryStatement = {
      kind: "expr" as const,
      expr: entryFunction.fallible
        ? { kind: "try" as const, expr: entryExecution }
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
                : `${crateName}::__tsonic_program::TsonicResult`,
              typeArguments: [{ kind: "unit" as const }],
            },
            body: { statements: [...initializationStatements, entryStatement, ...epilogueStatements, ...completionStatements] },
          }
        : { body: { statements: [...initializationStatements, entryStatement, ...epilogueStatements] } }),
    };
    artifacts.push(rustSourceArtifact("src/main.rs", printRustSourceFile(createRustSourceFile([mainItem]))));
  }
  return { artifacts, diagnostics: [] };
}

function rustSourceArtifact(path: string, text: string): TargetSourceFile {
  return { kind: "source", path, language: "rust", text };
}

interface RustBinaryEntry {
  readonly sourceFile: SourceFile;
  readonly moduleName: string;
  readonly functionName: string;
  readonly async: boolean;
  readonly fallible: boolean;
}

function resolveBinaryEntry(
  input: RustTranslationContext,
  moduleNameByFileName: ReadonlyMap<string, string>,
  diagnostics: TargetDiagnostic[],
): RustBinaryEntry | undefined {
  const entryPoint = input.project.entryPoint;
  const entrySourceFile = input.sourceFiles.find((sourceFile) => {
    const fileName = input.ast.getFileName(sourceFile);
    return fileName === entryPoint || fileName.endsWith(`/${entryPoint}`);
  });
  const entryFileName = entrySourceFile === undefined ? undefined : input.ast.getFileName(entrySourceFile);
  const moduleName = entryFileName === undefined ? undefined : moduleNameByFileName.get(entryFileName);
  if (entrySourceFile === undefined || moduleName === undefined) {
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
