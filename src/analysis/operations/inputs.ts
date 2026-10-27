import { rustProviderOperationSourceReceiverMode } from "../../policy/operations/members/abi/source-modes.js";
import { requireRustRecord } from "../program/records/objects/required-records.js";
import { ElementAccessExpression_ArgumentExpression, BinaryExpression_Left, BinaryExpression_Right, ForInOrOfStatement_Initializer, ForInOrOfStatement_Statement, Node_Operand, KindBinaryExpression, KindCallExpression, KindDeleteExpression, KindElementAccessExpression, KindIdentifier, KindArrayBindingPattern, KindNewExpression, KindObjectBindingPattern, KindPostfixUnaryExpression, KindPrefixUnaryExpression, KindPropertyAccessExpression, KindVoidExpression, KindAwaitExpression, KindVariableDeclaration, Node_Expression, Node_Name } from "@tsonic/target-api/source";

import { appendRustDiagnostic, recordPolicySelection, rustOperationContext } from "../program/walk.js";
import { recordBindingPatternFacts } from "../control-flow/binding-patterns.js";
import { recordBindingWrite } from "../ownership/source-writes.js";
import { validateFlowMarkerAgainstMode } from "./flow-markers.js";
import { recordProjectSourceBinding } from "../storage/source-bindings.js";
import { recordStatementFacts } from "../control-flow/statements.js";
import { resolveExpressionCarrier } from "../source-evidence/types/resolution/expression-carriers.js";

import { rustSelectedAssignmentValueCarrier } from "../../policy/operations/operators/assignment-values.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { selectRustCheckedIteration } from "./iteration/selection.js";
import { setCarrierFact } from "./project-calls.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { RustTargetOperationFact } from "../../target-model/records/operations/operations.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

import { rustMemberAccessReceiver } from "../../target-model/syntax/expressions.js";
import type { RustCheckedCallSelectionInput } from "../../policy/model/contracts.js";
import type { RustPreparedDeferredCheckedCall } from "../../target-model/records/callables/deferred-callbacks.js";
import { selectedCallArgumentNodes } from "./members/operators.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";

export function recordPreparedOperationInputs(
  walk: RustFactWalk,
  request: RustCheckedCallSelectionInput,
  sourceFile: SourceFile,
  prepared: RustPreparedDeferredCheckedCall,
): boolean {
  let complete = true;
  for (const [index, argument] of selectedCallArgumentNodes(request).entries()) {
    const expected = prepared.parameterCarriers[index];
    if (expected === undefined) failTargetAnalysisInvariant("tsonic-rust",
      "A prepared callback requires its finalized source parameter correspondence.", request.source.call);
    if (resolveExpressionCarrier(walk, argument, sourceFile, expected) === undefined) {
      appendRustDiagnostic(walk, "RUST_SELECTED_CALLBACK_CARRIER_MISSING",
        "The selected callback argument has no closed carrier for its finalized source contract.", argument,
        ["target.capability=rust.callback.exact-source"]);
      complete = false;
    }
  }
  return complete;
}

function recordProviderArgumentEffects(walk: RustFactWalk, argument: Node, mode: "value" | "ref" | "mut-ref" | undefined): void {
  if (mode === undefined) return;
  validateFlowMarkerAgainstMode(walk, argument, mode);
  if (mode === "mut-ref") recordBindingWrite(walk, argument, "referent");
}

export function recordFinalizedOperationInputEffects(
  walk: RustFactWalk,
  expression: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }>,
): void {
  const ast = walk.context.ast;
  const callee = Node_Expression(ast, expression);
  const receiver = callee === undefined ? undefined : rustMemberAccessReceiver(ast, callee);
  if (receiver !== undefined && rustProviderOperationSourceReceiverMode(fact) === "mut-ref")
    recordBindingWrite(walk, receiver, "referent");
  for (const [index, argument] of ast.arguments(expression).entries()) {
    if (argument === undefined) continue;
    recordProviderArgumentEffects(walk, argument, fact.abi.sourceArguments.find(candidate => candidate.sourceIndex === index)?.mode);
  }
}

export function recordSelectedOperationInputs(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  fact: RustTargetOperationFact | undefined,
): void {
  if (walk.context.records.memoryLayoutObservation.get(expression) !== undefined) return;
  const memoryBinding = walk.context.records.memoryBindingPlan.get(expression);
  if (memoryBinding !== undefined) {
    if (memoryBinding.kind === "field") resolveExpressionCarrier(walk, memoryBinding.expression, sourceFile, memoryBinding.carrier);
    else for (const field of memoryBinding.fields) resolveExpressionCarrier(walk, field.expression, sourceFile, field.carrier);
    return;
  }
  const rawLocation = walk.context.records.rawLocationPlan.get(expression);
  if (rawLocation !== undefined) {
    resolveExpressionCarrier(walk, rawLocation.expression, sourceFile, rawLocation.inputCarrier);
    return;
  }
  const rawAddress = walk.context.records.rawAddressPlan.get(expression);
  if (rawAddress !== undefined) {
    for (const input of rawAddress.arguments) resolveExpressionCarrier(walk, input.expression, sourceFile, input.carrier);
    return;
  }
  const { ast } = walk.context;
  const kind = ast.kindName(expression);
  if (kind === KindBinaryExpression) {
    const left = BinaryExpression_Left(walk.context.ast, expression);
    const right = BinaryExpression_Right(walk.context.ast, expression);
    if (left !== undefined) {
      resolveExpressionCarrier(walk, left, sourceFile, undefined);
    }
    if (right !== undefined) {
      resolveExpressionCarrier(
        walk,
        right,
        sourceFile,
        rustSelectedAssignmentValueCarrier(fact),
      );
    }
    return;
  }
  if (kind === KindPrefixUnaryExpression || kind === KindPostfixUnaryExpression) {
    const operand = Node_Operand(walk.context.ast, expression);
    if (operand !== undefined) {
      resolveExpressionCarrier(walk, operand, sourceFile, undefined);
    }
    return;
  }
  if (kind === KindVoidExpression || kind === KindAwaitExpression) {
    const operand = Node_Expression(ast, expression);
    if (operand !== undefined) {
      resolveExpressionCarrier(walk, operand, sourceFile, undefined);
    }
    return;
  }
  if (kind === KindDeleteExpression) {
    const operand = Node_Expression(ast, expression);
    const receiver = operand === undefined ? undefined : Node_Expression(ast, operand);
    const index = operand === undefined
      ? undefined
      : ElementAccessExpression_ArgumentExpression(ast, operand);
    if (receiver !== undefined) {
      resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
      if (rustProviderOperationSourceReceiverMode(fact) === "mut-ref") {
        recordBindingWrite(walk, receiver, "referent");
      }
    }
    if (index !== undefined) {
      resolveExpressionCarrier(
        walk,
        index,
        sourceFile,
        fact?.kind === "provider-operation"
          ? fact.abi.sourceArguments[0]?.carrier
          : undefined,
      );
    }
    return;
  }
  if (kind === "KindAsExpression" || kind === "KindTypeAssertionExpression") {
    const operand = Node_Expression(walk.context.ast, expression);
    if (operand !== undefined) {
      resolveExpressionCarrier(walk, operand, sourceFile, undefined);
    }
    return;
  }
  if (kind === KindPropertyAccessExpression) {
    const receiver = Node_Expression(walk.context.ast, expression);
    if (receiver !== undefined) {
      resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
    }
    return;
  }
  if (kind === KindElementAccessExpression) {
    const receiver = Node_Expression(walk.context.ast, expression);
    const argument = ElementAccessExpression_ArgumentExpression(walk.context.ast, expression);
    if (receiver !== undefined) {
      resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
    }
    if (argument !== undefined) {
      resolveExpressionCarrier(
        walk,
        argument,
        sourceFile,
        fact?.kind === "provider-operation" ? fact.abi.sourceArguments[0]?.carrier : undefined,
      );
    }
    return;
  }
  if (kind === KindCallExpression || kind === KindNewExpression) {
    const callee = Node_Expression(walk.context.ast, expression);
    if (callee !== undefined) {
      const receiver = rustMemberAccessReceiver(ast, callee);
      if (receiver !== undefined) {
        resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
        if (rustProviderOperationSourceReceiverMode(fact) === "mut-ref") {
          recordBindingWrite(walk, receiver, "referent");
        }
      }
    }
    const callArguments = ast.arguments(expression);
    const selectedCall = walk.context.records.selectedCall.get(expression);
    for (const [index, argument] of callArguments.entries()) {
      if (argument === undefined) {
        continue;
      }
      const finalizedProviderArgument = fact?.kind === "provider-operation"
        ? fact.abi.sourceArguments.find((candidate) => candidate.sourceIndex === index)
        : undefined;
      const sourceCallCarriers = fact?.kind === "source-call"
        ? fact.parameters.flatMap((parameter) =>
            parameter.inputs.filter((input) => input.sourceArgumentIndex === index).map((input) => input.carrier))
        : [];
      const finalizedArgumentCarrier = fact?.kind === "source-call"
        ? sourceCallCarriers.length > 0 && sourceCallCarriers.every((carrier) =>
            rustTargetTypeRefEquals(carrier, sourceCallCarriers[0]))
          ? sourceCallCarriers[0]
          : undefined
        : fact?.kind === "provider-operation"
          ? finalizedProviderArgument?.carrier
          : selectedCall?.member.parameters[index]?.type;
      resolveExpressionCarrier(
        walk,
        argument,
        sourceFile,
        finalizedArgumentCarrier,
      );
      if (fact?.kind !== "provider-operation") {
        continue;
      }
      recordProviderArgumentEffects(walk, argument, finalizedProviderArgument?.mode);
    }
  }
}

export function collectDescendantsOfKind(walk: RustFactWalk, root: Node, kindName: string): readonly Node[] {
  const { ast } = walk.context;
  const results: Node[] = [];
  const visit = (node: Node): void => {
    if (ast.kindName(node) === kindName) {
      results.push(node);
    }
    ast.forEachChild(node, (child) => {
      if (child !== undefined) {
        visit(child);
      }
    });
  };
  visit(root);
  return results;
}

export function recordForOfFacts(
  walk: RustFactWalk,
  statement: Node,
  sourceFile: SourceFile,
  returnCarrier: TargetTypeRef | undefined,
): void {
  const expression = Node_Expression(walk.context.ast, statement);
  if (expression !== undefined) {
    resolveExpressionCarrier(walk, expression, sourceFile, undefined);
  }
  const source = walk.context.semantics(sourceFile).operations.iteration(statement);
  if (expression === undefined || source === undefined) {
    appendRustDiagnostic(walk, "RUST_ITERATION_NOT_PROVEN",
      "Iteration requires its exact checked receiver, element and control-flow evidence.", statement,
      ["target.capability=rust.iteration"]);
    return;
  }
  {
    recordPolicySelection(walk, statement, selectRustCheckedIteration({
      target: "rust",
      statement,
      expression,
      initializer: ForInOrOfStatement_Initializer(walk.context.ast, statement),
      source,
    }, rustOperationContext(walk, statement), walk.operationOptions));
  }
  const selected = walk.context.records.targetOperation.get(statement);
  if (selected?.kind === "iteration") {
    const initializer = ForInOrOfStatement_Initializer(walk.context.ast, statement);
    if (initializer !== undefined) {
      if (walk.context.ast.kindName(initializer) === KindIdentifier) {
        const declaration = recordProjectSourceBinding(walk, initializer)?.sourceDeclaration;
        if (declaration !== undefined) {
          requireRustRecord(walk.context.requiredRecords, "mutatedBinding", declaration, "iteration-assignment", "analysis/operations/inputs.ts");
          walk.context.records.mutatedBindings.written(declaration);
        }
      }
      for (const declaration of collectDescendantsOfKind(walk, initializer, KindVariableDeclaration)) {
        setCarrierFact(walk, declaration, selected.elementCarrier);
        const name = Node_Name(walk.context.ast, declaration);
        const nameKind = name === undefined ? "" : walk.context.ast.kindName(name);
        if (name !== undefined && (nameKind === KindArrayBindingPattern || nameKind === KindObjectBindingPattern) &&
          !recordBindingPatternFacts(walk, name, selected.elementCarrier)) {
          appendRustDiagnostic(
            walk,
            "RUST_BINDING_PATTERN_NOT_CLOSED",
            "Iteration binding pattern has no total Rust projection from its exact finalized element carrier.",
            name,
            ["target.capability=rust.binding-pattern.iteration"],
          );
        }
      }
    }
    const body = ForInOrOfStatement_Statement(walk.context.ast, statement);
    if (body !== undefined) {
      recordStatementFacts(walk, body, sourceFile, returnCarrier);
    }
    return;
  }
}

export function sourceTypeCarrierForDeclaration(walk: RustFactWalk, declaration: Node): TargetTypeRef | undefined {
  const definition = walk.context.projectTypes.definitionForDeclaration(declaration);
  return definition === undefined
    ? walk.sourceTypes.carrierForDeclaration(declaration)
    : walk.context.projectTypes.openCarrier(definition);
}
