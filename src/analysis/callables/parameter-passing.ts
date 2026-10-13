import type { ArgumentPassingMode, AstReader, Node } from "@tsonic/tsts";
import type { RustArgumentMode } from "../../target-model/operations/model.js";

import type { RustProgramRecords } from "../../target-model/records/program.js";
import { rustFinalizedSourceInputs } from "../operations/finalized-operation/conversions.js";
import { rustProviderInputBorrowMode } from "../storage/provider-borrows.js";

export function rustArgumentPassingMode(mode: RustArgumentMode): ArgumentPassingMode {
  switch (mode) {
    case "ref":
      return "borrow-shared";
    case "mut-ref":
      return "borrow-mut";
    case "value":
      return "by-value";
  }
}

export function rustCallArgumentMode(argument: Node, ast: AstReader, records: RustProgramRecords): RustArgumentMode | undefined {
  const call = ast.parent(argument);
  if (call === undefined || !(ast.is.IsCallExpression(call) || ast.is.IsNewExpression(call))) return undefined;
  const sourceIndex = ast.arguments(call).indexOf(argument);
  if (sourceIndex < 0) return undefined;
  const operation = records.targetOperation.get(call);
  if (operation?.kind === "provider-operation") {
    if (operation.abi.target.form === "expression-macro") return undefined;
    const inputs = rustFinalizedSourceInputs(operation.abi).filter(input =>
      input.source.kind === "argument" && input.source.sourceIndex === sourceIndex);
    const modes = inputs.map(input => rustProviderInputBorrowMode(input) ?? "value");
    const first = modes[0];
    return modes.every(mode => mode === first) ? first : undefined;
  }
  if (operation?.kind !== "source-call") return undefined;
  const mode = records.argumentPassing.get(argument)?.mode;
  return mode === "by-value" ? "value" : mode === "borrow-shared" ? "ref" : mode === "borrow-mut" ? "mut-ref" : undefined;
}

export function rustCallArgumentIsOwned(argument: Node, ast: AstReader, records: RustProgramRecords): boolean {
  return rustCallArgumentMode(argument, ast, records) === "value";
}
