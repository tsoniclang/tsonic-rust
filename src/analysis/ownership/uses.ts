import type { AstReader, Node } from "@tsonic/tsts";
import { Node_Expression, sourceTransparentExpressionOperand } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import { rustFinalizedSourceInputs } from "../operations/finalized-operation/conversions.js";
import { rustBorrowedOperationArguments, rustProviderInputBorrowMode } from "../storage/provider-borrows.js";
import { selectRustOperationReadUses, type RustReadUse } from "../../policy/ownership/read-use.js";
import { rustCallableProtocol } from "../../target-model/types/index.js";
import { rustCallArgumentMode } from "../callables/parameter-passing.js";

export function rustNativeArgumentBorrowsRead(argument: Node, reference: Node,
  ast: AstReader, records: RustProgramRecords): boolean {
  const mode = rustCallArgumentMode(argument, ast, records);
  const carrier = records.runtimeCarrier.get(argument)?.carrier;
  if (mode !== "ref" && mode !== "mut-ref" && carrier?.kind !== "reference") return false;
  let source = argument;
  while (source !== reference) {
    const operand = sourceTransparentExpressionOperand(ast, source);
    const operation = records.targetOperation.get(source);
    const next = operand ?? (operation?.kind === "reference-operation" &&
      (operation.operation === "shared-reference" || operation.operation === "mutable-reference")
      ? operation.operandExpression : operation?.kind === "source-field" &&
        operation.valueSemantics.kind === "stored" ? Node_Expression(ast, source) : undefined);
    if (next === undefined) return false;
    source = next;
  }
  return true;
}

export function analyzeRustReadUses(ast: AstReader, nodes: readonly Node[], records: RustProgramRecords): ReadonlyMap<Node, RustReadUse> {
  const uses = new Map<Node, RustReadUse>();
  for (const node of nodes) {
    const operation = records.targetOperation.get(node);
    const address = records.rawAddressPlan.get(node);
    const location = records.typedLocationPlan.get(node);
    const guard = records.optionalChain.get(node)?.guard;
    if (operation === undefined && address === undefined && location === undefined && guard === undefined) continue;
    const callable = operation?.kind === "source-call" && operation.target.form === "callable" ? operation.target.carrier : undefined;
    const callTrait = callable?.kind === "closure" ? callable.callTrait ?? "Fn" : undefined;
    const callableMode = callTrait === "FnOnce" ? "move" : callTrait === "FnMut" ? "mutable"
      : callTrait === "Fn" || rustCallableProtocol(callable) !== undefined ? "shared" : undefined;
    const argumentsList = rustBorrowedOperationArguments(node, ast);
    const selected = selectRustOperationReadUses(ast, node, { operation, address, location, guard, callableMode, arguments: argumentsList,
      nativeInputs: operation?.kind === "provider-operation" ? rustFinalizedSourceInputs(operation.abi).map(input =>
        ({ source: input.source, mode: rustProviderInputBorrowMode(input) })) : [],
      argumentModes: (argumentsList ?? []).map(argument => records.argumentPassing.get(argument)?.mode) });
    for (const [subject, use] of selected) uses.set(subject, use);
  }
  for (const node of nodes) {
    const use = uses.get(node);
    if (use === undefined) continue;
    const operand = sourceTransparentExpressionOperand(ast, node);
    if (operand !== undefined) uses.set(operand, use);
  }
  return uses;
}
