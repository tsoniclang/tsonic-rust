import type { AstReader, Node } from "@tsonic/tsts";
import { Node_Expression, Node_Initializer } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../target-model/records/program.js";

import { rustMemberAccessReceiver } from "../../target-model/syntax/expressions.js";
import { rustTargetGenericReferences } from "../../target-model/types/carriers/generic-references.js";
import type { RustOwnershipRecords } from "../../target-model/records/storage/ownership.js";
import type { RustBorrowedInitializerProducer } from "../program/records/storage/borrowed-initializers.js";
import { rustProviderInputBorrowMode } from "../../policy/operations/members/input-borrows.js";

export function analyzeRustBorrowedInitializers(
  ast: AstReader, nativeNodes: readonly Node[], records: RustProgramRecords,
  reads: RustOwnershipRecords["reads"], producer: RustBorrowedInitializerProducer,
): void {
  const select = (expression: Node): void => {
    let source = expression;
    while (ast.is.IsParenthesizedExpression(source) || ast.is.IsAsExpression(source) ||
      ast.is.IsSatisfiesExpression(source) || ast.is.IsNonNullExpression(source) || ast.is.IsTypeAssertion(source)) {
      const inner = Node_Expression(ast, source);
      if (inner === undefined) return;
      source = inner;
    }
    const operation = records.targetOperation.get(source);
    const abi = operation?.kind === "provider-operation" ? operation.abi : undefined;
    const input = abi?.targetReceiver.kind === "input" ? abi.targetReceiver.input : undefined;
    const receiver = ast.is.IsCallExpression(source)
      ? rustMemberAccessReceiver(ast, Node_Expression(ast, source))
      : ast.is.IsElementAccessExpression(source) || ast.is.IsPropertyAccessExpression(source)
        ? Node_Expression(ast, source) : undefined;
    const result = abi?.result.kind === "sync" ? abi.result.rawCarrier : undefined;
    const selected = abi?.sourceReceiver.kind === "receiver" && abi.sourceReceiver.disposition === "runtime" &&
      (abi.target.form === "receiver-method" || abi.target.form === "arg-method") &&
      input?.source.kind === "receiver" && rustProviderInputBorrowMode(input) === "ref" && input.conversion.kind === "identity" &&
      receiver !== undefined && result !== undefined &&
      abi.result.kind === "sync" &&
      rustTargetGenericReferences(abi.result.carrier).elisionInputs.some(lifetime => lifetime.kind === "placeholder") &&
      rustTargetGenericReferences(result).elisionInputs.some(lifetime => lifetime.kind === "placeholder")
      ? Object.freeze({ receiver, carrier: input.sourceCarrier }) : undefined;
    if (selected !== undefined && reads.get(selected.receiver)?.readsStorage !== true) producer.retain(expression, selected);
  };
  const visit = (node: Node): void => {
    if (ast.is.IsVariableDeclaration(node)) {
      const initializer = Node_Initializer(ast, node);
      if (initializer !== undefined) select(initializer);
    }
  };
  nativeNodes.forEach(visit);
}
