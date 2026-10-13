import type { SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustPlanningContext } from "../context.js";
import { resolve } from "node:path";

import type { RustTargetProgram } from "../../../analysis/program/model.js";

export function resolveProjectEntrySourceFile(
  input: RustPlanningContext,
  diagnostics: TargetDiagnostic[],
): SourceFile | undefined {
  const entryPoint = normalizeSourcePath(
    resolve(input.host.paths.projectRoot, input.host.entryPoint),
  );
  const sourceFile = rustProjectEntrySourceFile(input.program);
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

export function rustProjectEntrySourceFile(
  program: RustTargetProgram,
): SourceFile | undefined {
  const entryPoint = normalizeSourcePath(
    resolve(program.host.paths.projectRoot, program.host.entryPoint),
  );
  return program.sourceFiles.find((candidate) =>
    normalizeSourcePath(resolve(program.source.ast.getFileName(candidate))) === entryPoint
  );
}

function normalizeSourcePath(path: string): string {
  return path.split("\\").join("/");
}
