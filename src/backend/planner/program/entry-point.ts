import type { Node, SourceFile } from "@tsonic/tsts";
import {
  KindFunctionDeclaration,
  Node_Name,
} from "@tsonic/target-api/source";
import { resolve } from "node:path";
import {
  rustAsyncFunctionFactKey,
  rustSourceCallableReturnFactKey,
} from "../../../analysis/facts/keys.js";
import type { RustTargetProgram } from "../../../analysis/program/model.js";
import { isRustUnitCarrier } from "../../../target-model/types/index.js";

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
        isRustUnitCarrier(returnCarrier)
      ? statement
      : undefined;
  }
  return undefined;
}

function normalizeSourcePath(path: string): string {
  return path.split("\\").join("/");
}
