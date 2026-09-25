import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustPlanningContext } from "../context.js";
import {
  KindFunctionDeclaration,
  Node_Name,
} from "@tsonic/target-api/source";
import { resolve } from "node:path";
import {
  rustAsyncFunctionFactKey,
  rustFallibleFactKey,
  rustSourceCallableReturnFactKey,
} from "../../../analysis/facts/keys.js";
import type { RustTargetProgram } from "../../../analysis/program/model.js";
import { isRustUnitCarrier } from "../../../target-model/types/index.js";

export interface RustBinaryEntry {
  readonly sourceFile: SourceFile;
  readonly moduleName: string;
  readonly functionName: string;
  readonly async?: "native-future" | "js-promise";
  readonly fallible: boolean;
  readonly nativeTermination: boolean;
}

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

export function resolveBinaryEntry(
  input: RustPlanningContext,
  moduleNameByFileName: ReadonlyMap<string, string>,
  diagnostics: TargetDiagnostic[],
): RustBinaryEntry | undefined {
  const entryPoint = input.host.entryPoint;
  const entrySourceFile = resolveProjectEntrySourceFile(input, diagnostics);
  if (entrySourceFile === undefined) return undefined;
  const moduleName = moduleNameByFileName.get(input.program.source.ast.getFileName(entrySourceFile));
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
  const declaration = rustBinaryEntryDeclaration(input.program);
  if (declaration !== undefined) {
    const asyncFact = input.program.facts.getFact(declaration, rustAsyncFunctionFactKey);
    return {
      sourceFile: entrySourceFile,
      moduleName,
      functionName: "main",
      async: asyncFact?.kind,
      fallible: input.program.facts.getFact(declaration, rustFallibleFactKey) !== undefined,
      nativeTermination: !isRustUnitCarrier(asyncFact?.outputCarrier ??
        input.program.facts.getFact(declaration, rustSourceCallableReturnFactKey)?.returnCarrier),
    };
  }
  diagnostics.push({
    code: "RUST_MISSING_ENTRYPOINT",
    category: "error",
    source: "tsonic-rust",
    message: "Binary output requires an exported, nongeneric, zero-parameter 'main' with a closed return carrier; Rust validates its native Termination contract.",
    evidence: ["target.capability=rust.backend.entrypoint"],
  });
  return undefined;
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

export function rustBinaryEntryDeclaration(
  program: RustTargetProgram,
): Node | undefined {
  const sourceFile = rustProjectEntrySourceFile(program);
  if (sourceFile === undefined) return undefined;
  for (const statement of program.source.ast.statements(sourceFile)) {
    if (statement === undefined ||
      program.source.ast.kindName(statement) !== KindFunctionDeclaration) {
      continue;
    }
    const name = Node_Name(program.source.ast, statement);
    if (name === undefined || program.source.ast.text(name) !== "main") continue;
    const asyncFact = program.facts.getFact(statement, rustAsyncFunctionFactKey);
    const returnCarrier = asyncFact?.outputCarrier ??
      program.facts.getFact(statement, rustSourceCallableReturnFactKey)?.returnCarrier;
    return program.source.ast.hasModifierKind(statement, "export") &&
        returnCarrier !== undefined &&
        program.source.ast.parameters(statement).length === 0 &&
        program.source.ast.typeParameters(statement).length === 0
      ? statement
      : undefined;
  }
  return undefined;
}

function normalizeSourcePath(path: string): string {
  return path.split("\\").join("/");
}
