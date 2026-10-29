import type { AstReader, Node } from "@tsonic/tsts";
import { Node_Expression, Node_Initializer, sourceEnclosingCallable } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../target-model/records/program.js";

import { rustMemberAccessReceiver } from "../../target-model/syntax/expressions.js";
import { rustTargetGenericReferences } from "../../target-model/types/carriers/generic-references.js";
import type { RustOwnershipRecords } from "../../target-model/records/storage/ownership.js";
import type { RustBorrowedInitializerProducer } from "../program/records/storage/borrowed-initializers.js";
import { rustProviderInputBorrowMode } from "../../policy/operations/members/input-borrows.js";
import { rustSourceCallBorrowedReturn } from "../callables/ownership/source-input-lifetimes.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustLifetimesEqual } from "../../target-model/lifetimes/index.js";
import type { RustBorrowedInitializer } from "../../target-model/records/storage/borrowed-initializers.js";

export function analyzeRustBorrowedInitializers(
  ast: AstReader, nativeNodes: readonly Node[], records: RustProgramRecords,
  reads: RustOwnershipRecords["reads"], producer: RustBorrowedInitializerProducer,
): void {
  const select = (declaration: Node, expression: Node): void => {
    let source = expression;
    while (ast.is.IsParenthesizedExpression(source) || ast.is.IsAsExpression(source) ||
      ast.is.IsSatisfiesExpression(source) || ast.is.IsNonNullExpression(source) || ast.is.IsTypeAssertion(source)) {
      const inner = Node_Expression(ast, source);
      if (inner === undefined) return;
      source = inner;
    }
    const operation = records.targetOperation.get(source);
    const owner = sourceEnclosingCallable(declaration, ast);
    const declared = owner === undefined ? undefined : records.sourceCallableReturn.get(owner)?.borrowedReturn;
    const binding = records.sourceBinding.get(source)?.sourceDeclaration;
    const input = binding === undefined ? undefined : records.sourceParameterAbi.get(binding);
    if (declared !== undefined && declared.parameter === binding && input?.mode === "ref" &&
      input.parameterCarrier.kind === "reference" && !input.parameterCarrier.mutable && input.inputLifetime !== undefined &&
      rustLifetimesEqual(input.parameterCarrier.lifetime, input.inputLifetime) && reads.get(expression)?.value.kind === "borrow") {
      producer.retain(expression, { receiver: source, carrier: input.valueCarrier, retained: Object.freeze([]),
        loan: Object.freeze({ declaration, initializer: expression, guard: source, parameter: declared.parameter,
          returnCarrier: input.parameterCarrier,
          resultCarrier: Object.freeze({ ...input.parameterCarrier, lifetime: Object.freeze({ kind: "placeholder" as const }) }) }) });
      return;
    }
    const optional = records.optionalChain.get(source);
    const guard = optional?.guard ?? source;
    const returned = rustSourceCallBorrowedReturn(guard, ast, records);
    const parameter = returned === undefined ? undefined : records.sourceParameterAbi.get(returned.parameter);
    if (returned?.carrier.kind === "reference" && !returned.carrier.mutable && returned.carrier.lifetime !== undefined &&
      parameter?.mode === "ref" && parameter.parameterCarrier.kind === "reference" && !parameter.parameterCarrier.mutable &&
      parameter.inputLifetime !== undefined && rustLifetimesEqual(returned.carrier.lifetime, parameter.inputLifetime) &&
      reads.get(expression)?.value.kind === "borrow" &&
      (optional === undefined || optional.guardDepth === 1 && operation?.kind === "provider-operation" && operation.abi.target.form === "index" &&
        rustTargetTypeRefEquals(optional.sourceGuardCarrier, optional.resultCarrier) &&
        rustTargetTypeRefEquals(returned.carrier.referent, optional.sourceGuardCarrier))) {
      const logical = records.runtimeCarrier.get(source)?.carrier;
      const call = records.targetOperation.get(guard);
      const arguments_ = ast.arguments(guard);
      const argumentIndex = arguments_.indexOf(returned.argument);
      if (logical !== undefined && rustTargetTypeRefEquals(logical, returned.carrier.referent) && call?.kind === "source-call" &&
        argumentIndex >= 0 && ast.is.IsFunctionDeclaration(returned.declaration)) {
        const retain = reads.get(returned.argument)?.readsStorage !== true;
        const retained: RustBorrowedInitializer["retained"][number][] = [];
        for (const argument of retain ? arguments_.slice(0, argumentIndex + 1) : []) {
          const carrier = argument === returned.argument ? parameter.valueCarrier
            : argument === undefined ? undefined : records.runtimeCarrier.get(argument)?.carrier;
          if (argument === undefined || carrier === undefined) return;
          retained.push(Object.freeze({ expression: argument, carrier }));
        }
        producer.retain(expression, { receiver: returned.argument, carrier: parameter.valueCarrier,
          retained: Object.freeze(retained), loan: Object.freeze({ declaration, initializer: expression, guard,
            parameter: returned.parameter, returnCarrier: returned.carrier,
            resultCarrier: Object.freeze({ ...returned.carrier, lifetime: Object.freeze({ kind: "placeholder" as const }) }) }) });
        return;
      }
    }
    const abi = operation?.kind === "provider-operation" ? operation.abi : undefined;
    const receiverInput = abi?.targetReceiver.kind === "input" ? abi.targetReceiver.input : undefined;
    const receiver = ast.is.IsCallExpression(source)
      ? rustMemberAccessReceiver(ast, Node_Expression(ast, source))
      : ast.is.IsElementAccessExpression(source) || ast.is.IsPropertyAccessExpression(source)
        ? Node_Expression(ast, source) : undefined;
    const result = abi?.result.kind === "sync" ? abi.result.rawCarrier : undefined;
    const selected = abi?.sourceReceiver.kind === "receiver" && abi.sourceReceiver.disposition === "runtime" &&
      (abi.target.form === "receiver-method" || abi.target.form === "arg-method") &&
      receiverInput?.source.kind === "receiver" && rustProviderInputBorrowMode(receiverInput) === "ref" && receiverInput.conversion.kind === "identity" &&
      receiver !== undefined && result !== undefined &&
      abi.result.kind === "sync" &&
      rustTargetGenericReferences(abi.result.carrier).elisionInputs.some(lifetime => lifetime.kind === "placeholder") &&
      rustTargetGenericReferences(result).elisionInputs.some(lifetime => lifetime.kind === "placeholder")
      ? Object.freeze({ receiver, carrier: receiverInput.sourceCarrier, loan: undefined,
        retained: Object.freeze([Object.freeze({ expression: receiver, carrier: receiverInput.sourceCarrier })]) }) : undefined;
    if (selected !== undefined && reads.get(selected.receiver)?.readsStorage !== true) producer.retain(expression, selected);
  };
  const visit = (node: Node): void => {
    if (ast.is.IsVariableDeclaration(node)) {
      const initializer = Node_Initializer(ast, node);
      if (initializer !== undefined) select(node, initializer);
    }
  };
  nativeNodes.forEach(visit);
}
