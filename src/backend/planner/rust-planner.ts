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
  Node_Type,
} from "../../common/source-ast.js";
import { readRustCrateName, readRustOutputType } from "../../options/rust-target-options.js";
import { isRustUnitCarrier } from "../../source/rust-target-types.js";
import { createRustSourceFile } from "../rust-ast/nodes.js";
import type { RustItem } from "../rust-ast/nodes.js";
import { printRustSourceFile } from "../../print/rust-printer.js";
import { printCargoManifest } from "../../print/cargo-manifest-printer.js";
import { planCargoManifest } from "./cargo-project.js";
import { rustReservedIdentifiers } from "./plan-context.js";
import { rustFallibleFactKey } from "../../source/rust-facts/keys.js";
import type { RustTranslationContext } from "../../translate/context.js";
import { reconstructRustSourceFiles } from "./source-file-reconstruction.js";

export function planRustArtifacts(input: RustTranslationContext): TargetCompileResult {
  const diagnostics: TargetDiagnostic[] = [...input.diagnostics];
  const moduleNameByFileName = planModuleNames(input, diagnostics);
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
  const manifestPlan = planCargoManifest(input.target, input.runtimeReferences);
  if (manifestPlan.manifest === undefined) {
    return { artifacts: [], diagnostics: [...diagnostics, ...manifestPlan.diagnostics] };
  }

  const outputType = readRustOutputType(input.target);
  const entryFunction = outputType === "bin"
    ? resolveBinaryEntry(input, moduleNameByFileName, diagnostics)
    : undefined;

  if (diagnostics.length > 0) {
    return { artifacts: [], diagnostics };
  }

  const sortedSources = [...plannedSources].sort((left, right) =>
    left.moduleName.localeCompare(right.moduleName, "en"));
  const sortedModuleNames = sortedSources.map((source) => source.moduleName);
  const artifacts: TargetArtifact[] = [
    {
      kind: "project",
      path: "Cargo.toml",
      text: printCargoManifest(manifestPlan.manifest),
    },
  ];
  const libraryModel = createRustSourceFile(
    sortedModuleNames.map((name): RustItem => ({ kind: "mod-decl", name, pub: true })),
  );
  artifacts.push(rustSourceArtifact("src/lib.rs", printRustSourceFile(libraryModel)));
  for (const source of sortedSources) {
    artifacts.push(rustSourceArtifact(
      `src/${source.moduleName}.rs`,
      printRustSourceFile(source.model),
    ));
  }
  if (outputType === "bin" && entryFunction !== undefined) {
    const crateName = readRustCrateName(input.target);
    const entryCall = {
      kind: "call" as const,
      path: `${crateName}::${entryFunction.moduleName}::${entryFunction.functionName}`,
      args: [],
    };
    const mainItem: RustItem = {
      kind: "function",
      name: "main",
      pub: false,
      params: [],
      ...(entryFunction.fallible
        ? {
            returnType: {
              kind: "named" as const,
              path: "tsonic_rust_runtime::TsonicResult",
              typeArguments: [{ kind: "unit" as const }],
            },
            body: { statements: [{ kind: "tail" as const, expr: entryCall }] },
          }
        : { body: { statements: [{ kind: "expr" as const, expr: entryCall }] } }),
    };
    artifacts.push(rustSourceArtifact("src/main.rs", printRustSourceFile(createRustSourceFile([mainItem]))));
  }
  return { artifacts, diagnostics: [] };
}

function rustSourceArtifact(path: string, text: string): TargetSourceFile {
  return { kind: "source", path, language: "rust", text };
}

function planModuleNames(
  input: RustTranslationContext,
  diagnostics: TargetDiagnostic[],
): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  const seen = new Map<string, string>();
  for (const sourceFile of input.sourceFiles) {
    const fileName = input.ast.getFileName(sourceFile);
    const moduleName = rustModuleNameForFile(fileName);
    if (moduleName === undefined) {
      diagnostics.push(moduleNameDiagnostic(input, sourceFile, `Source file '${fileName}' does not map to a valid Rust module name.`));
      continue;
    }
    const existing = seen.get(moduleName);
    if (existing !== undefined) {
      diagnostics.push(moduleNameDiagnostic(input, sourceFile, `Source files '${existing}' and '${fileName}' both map to Rust module '${moduleName}'.`));
      continue;
    }
    seen.set(moduleName, fileName);
    names.set(fileName, moduleName);
  }
  return names;
}

// Module-path policy (distinct from identifier naming): generated Rust
// module names derive from source FILE names, which are filesystem paths,
// not user identifiers. File stems normalize to snake_case module names so
// module paths stay valid and predictable across platforms; user-authored
// identifiers inside modules are never recased.
export function rustModuleNameForFile(fileName: string): string | undefined {
  const base = fileName.split("/").pop() ?? "";
  const stem = base.replace(/\.(ts|mts|cts|tsx)$/u, "");
  if (stem.length === 0) {
    return undefined;
  }
  const sanitized = stem
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9_]/gu, "_");
  if (!/^[a-z_][a-z0-9_]*$/u.test(sanitized)) {
    return undefined;
  }
  if (sanitized === "main" || sanitized === "lib" || rustReservedIdentifiers.has(sanitized)) {
    return undefined;
  }
  return sanitized;
}

function moduleNameDiagnostic(input: RustTranslationContext, sourceFile: SourceFile, message: string): TargetDiagnostic {
  return {
    code: "RUST_MODULE_NAME",
    category: "error",
    source: "tsonic-rust",
    message,
    evidence: [
      "target.capability=rust.backend.module-name",
      `source.file=${input.ast.getFileName(sourceFile)}`,
    ],
  };
}

interface RustBinaryEntry {
  readonly moduleName: string;
  readonly functionName: string;
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
    const returnTypeNode = Node_Type(input.ast, statement);
    const returnCarrier = returnTypeNode === undefined
      ? undefined
      : input.facts.getRuntimeCarrierFact(returnTypeNode)?.carrier;
    if (!input.ast.hasModifierKind(statement, "export") || !isRustUnitCarrier(returnCarrier) || input.ast.hasModifierKind(statement, "async")) {
      // Async entry points would require an implicit executor selection.
      break;
    }
    return {
      moduleName,
      functionName: "main",
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
