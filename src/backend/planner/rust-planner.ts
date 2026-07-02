import type {
  TargetArtifact,
  TargetCompileInput,
  TargetCompileResult,
  TargetDiagnostic,
  TargetSourceFile,
} from "@tsonic/target-api";
import { createEmptyRustBinaryFile, createEmptyRustLibraryFile } from "../rust-ast/file.js";
import { printCargoManifest } from "../../print/cargo-manifest-printer.js";
import { printRustSourceFile } from "../../print/rust-printer.js";
import { planCargoManifest } from "./cargo-project.js";
import { unsupportedStatementDiagnostic } from "./diagnostics.js";

// Slice R1 backend: fail closed. Every source construct is unsupported until a
// finalized fact lane proves its Rust lowering. A program only compiles when it
// contains nothing to lower, and then produces a deterministic Cargo project.
export function planRustArtifacts(input: TargetCompileInput): TargetCompileResult {
  const diagnostics: TargetDiagnostic[] = [];
  for (const sourceFile of input.sourceFiles) {
    for (const statement of input.ast.statements(sourceFile)) {
      if (statement === undefined) {
        continue;
      }
      diagnostics.push(unsupportedStatementDiagnostic(
        { ast: input.ast, sourceFile, node: statement },
        "rust.backend.statement",
      ));
    }
  }
  if (diagnostics.length > 0) {
    return { artifacts: [], diagnostics };
  }

  const manifestPlan = planCargoManifest(input.target, input.runtimeReferences);
  if (manifestPlan.manifest === undefined) {
    return { artifacts: [], diagnostics: manifestPlan.diagnostics };
  }

  const crateRoot = manifestPlan.manifest.outputType === "bin"
    ? { path: "src/main.rs", model: createEmptyRustBinaryFile() }
    : { path: "src/lib.rs", model: createEmptyRustLibraryFile() };
  const crateRootArtifact: TargetSourceFile = {
    kind: "source",
    path: crateRoot.path,
    language: "rust",
    text: printRustSourceFile(crateRoot.model),
  };
  const artifacts: TargetArtifact[] = [
    {
      kind: "project",
      path: "Cargo.toml",
      text: printCargoManifest(manifestPlan.manifest),
    },
    crateRootArtifact,
  ];
  return { artifacts, diagnostics: [] };
}
