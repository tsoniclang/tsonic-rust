import type { AstReader, Node } from "@tsonic/tsts";
import type { RustArgumentMode } from "../../target-model/operations/model.js";
import { Node_Expression } from "@tsonic/target-api/source";

import type { RustProgramRecords } from "../../target-model/records/program.js";
import { rustFinalizedSourceInputs } from "../../target-model/operations/finalized-inputs.js";
import { rustProviderInputBorrowMode } from "../../policy/operations/members/input-borrows.js";

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

/** The provider input mode of a value read as the receiver of a provider method call (`receiver.method(..)`). */
export function rustCallReceiverMode(receiver: Node, ast: AstReader, records: RustProgramRecords): RustArgumentMode | undefined {
  const access = ast.parent(receiver);
  const call = access === undefined ? undefined : ast.parent(access);
  if (access === undefined || call === undefined || !ast.is.IsPropertyAccessExpression(access) ||
    ast.as.AsPropertyAccessExpression(access)?.Expression !== receiver || !ast.is.IsCallExpression(call) ||
    Node_Expression(ast, call) !== access) return undefined;
  const operation = records.targetOperation.get(call);
  if (operation?.kind !== "provider-operation" || operation.abi.target.form === "expression-macro") return undefined;
  const modes = rustFinalizedSourceInputs(operation.abi).filter(input => input.source.kind === "receiver")
    .map(input => rustProviderInputBorrowMode(input) ?? "value");
  const first = modes[0];
  return first !== undefined && modes.every(mode => mode === first) ? first : undefined;
}

export function rustCallArgumentIsOwned(argument: Node, ast: AstReader, records: RustProgramRecords): boolean {
  return rustCallArgumentMode(argument, ast, records) === "value";
}
