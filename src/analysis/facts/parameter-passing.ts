import type { ArgumentPassingMode, AstReader, Node } from "@tsonic/tsts";
import type {
  RustArgumentMode,
} from "./keys.js";
import { rustTargetOperationFactKey } from "./operations/keys.js";
import { rustArgumentPassingKey } from "../../target-model/facts/selections.js";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import { rustFinalizedSourceInputs } from "./finalized-operation-abi.js";
import { rustProviderInputBorrowMode } from "./provider-borrows.js";

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

export function rustCallArgumentMode(argument: Node, ast: AstReader, facts: RustPlanQueries): RustArgumentMode | undefined {
  const call = ast.parent(argument);
  if (call === undefined || !(ast.is.IsCallExpression(call) || ast.is.IsNewExpression(call))) return undefined;
  const sourceIndex = ast.arguments(call).indexOf(argument);
  if (sourceIndex < 0) return undefined;
  const operation = facts.get(call, rustTargetOperationFactKey);
  if (operation?.kind === "provider-operation") {
    if (operation.abi.target.form === "expression-macro") return undefined;
    const inputs = rustFinalizedSourceInputs(operation.abi).filter(input =>
      input.source.kind === "argument" && input.source.sourceIndex === sourceIndex);
    const modes = inputs.map(input => rustProviderInputBorrowMode(input) ?? "value");
    const first = modes[0];
    return modes.every(mode => mode === first) ? first : undefined;
  }
  if (operation?.kind !== "source-call") return undefined;
  const mode = facts.get(argument, rustArgumentPassingKey)?.mode;
  return mode === "by-value" ? "value" : mode === "borrow-shared" ? "ref" : mode === "borrow-mut" ? "mut-ref" : undefined;
}

export function rustCallArgumentIsOwned(argument: Node, ast: AstReader, facts: RustPlanQueries): boolean {
  return rustCallArgumentMode(argument, ast, facts) === "value";
}
