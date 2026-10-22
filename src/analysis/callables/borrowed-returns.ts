import type { Node } from "@tsonic/tsts";
import { forEachSourceImmediateEvaluationChild, sourceBindingHasMutableExposure, type TargetSourceProgram } from "@tsonic/target-api/source";
import type { SourceStorageQueries } from "@tsonic/target-api/analysis";
import { createRustSourceLexicalCallableQueries } from "./lexical-bindings.js";
import { rustSourceValueWrapperContains } from "../../policy/ownership/source-value-wrappers.js";

import type { RustSourceCallableQueries, RustSourceLexicalCallableQueries } from "../../target-model/records/source-callables.js";

export function createRustSourceCallableQueries(sourceStorage: SourceStorageQueries,
  explicitUnsafe: ReadonlySet<Node>): RustSourceCallableQueries {
  const source = sourceStorage.source;
  const lexical = createRustSourceLexicalCallableQueries(source, sourceStorage.nodes, explicitUnsafe);
  const returns = new WeakMap<Node, Node | null>();
  const stableBindings = new WeakMap<Node, boolean>();
  for (const declaration of sourceStorage.nodes) {
    if (!source.ast.is.IsArrowFunction(declaration) && !source.ast.is.IsFunctionDeclaration(declaration)) continue;
    const selected = selectSourceBorrowedReturnParameter(declaration, sourceStorage, lexical, stableBindings);
    returns.set(declaration, selected ?? null);
  }
  return Object.freeze({
    directLexicalBinding: lexical.bindingFor,
    borrowedReturnParameter: (declaration: Node) => returns.get(declaration) ?? undefined,
  });
}

function selectSourceBorrowedReturnParameter(
  declaration: Node,
  sourceStorage: SourceStorageQueries,
  lexical: RustSourceLexicalCallableQueries,
  stableBindings: WeakMap<Node, boolean>,
): Node | undefined {
  const source = sourceStorage.source;
  const { ast } = source;
  const binding = ast.is.IsFunctionDeclaration(declaration) ? declaration
    : lexical.bindingFor(declaration);
  if (binding === undefined) return undefined;
  if (ast.body(declaration) === undefined || ast.hasModifierKind(declaration, "async") ||
    source.semantics.forNode(declaration).operations.generator(declaration) !== undefined ||
    source.semantics.forNode(declaration).operations.callableCompletion(declaration)?.canFallThrough !== false) return undefined;
  const result = sourceStorage.subject(declaration, "return");
  const bindings = sourceStorage.bindingsForLexicalOwner(declaration);
  if (result.kind !== "resolved" || bindings.kind !== "resolved") return undefined;
  const origins = sourceStorage.boundOriginsFor(result.subject, bindings.bindings);
  if (origins.kind !== "resolved" || origins.subjects.length !== 1) return undefined;
  const origin = origins.subjects[0]!;
  if (origin.kind !== "input" || origin.projection.length !== 0 ||
    !ast.parameters(declaration).includes(origin.node)) return undefined;
  const parameter = origin.node;
  const summary = source.navigation.parameterUseSummary(parameter);
  if (summary === undefined || summary.bindingWritten || summary.memberWritten || summary.captured ||
    summary.yielded || summary.passedAsArgument || summary.aliasedOrStored || summary.exported ||
    summary.hasUnclassifiedValueUse || !summary.returned || summary.uses.some(use => use.throughMember ||
      !["return", "comparison", "condition", "type-only"].includes(use.role))) return undefined;
  const calls = lexical.callsFor(binding, declaration);
  if (calls === undefined) return undefined;
  for (const call of calls) {
    const selected = source.semantics.forNode(call).operations.call(call);
    const inputs = selected?.sourceArgumentBindings.filter(input =>
      input.sourceParameterIndex === ast.parameters(declaration).indexOf(parameter));
    if (inputs?.length !== 1 || inputs[0]!.sourceForm !== "value" || inputs[0]!.sourceParameterForm !== "parameter") return undefined;
    const inputIndex = inputs[0]!.sourceArgumentIndex;
    const actual = selected!.sourceArguments[inputIndex]?.expression;
    if (actual === undefined || !borrowedInputIsStable(actual, source, stableBindings) || selected!.sourceArguments.some((argument, index) =>
      index !== inputIndex && mayInterfere(argument.expression, source))) return undefined;
    const resultFlow = source.navigation.expressionValueFlow(call);
    if (resultFlow.escapes || resultFlow.bindingAliased || resultFlow.aliasDeclarations.length !== 0 ||
      resultFlow.hasUnclassifiedUse || resultFlow.uses.length !== 1 || resultFlow.uses.some(resultUse => resultUse.throughMember ||
        resultUse.role !== "comparison" && resultUse.role !== "condition")) return undefined;
    let value = call;
    let consumer = ast.parent(value);
    while (consumer !== undefined && rustSourceValueWrapperContains(consumer, value, ast)) {
      value = consumer;
      consumer = ast.parent(value);
    }
    if (consumer === undefined) return undefined;
    if (resultFlow.uses[0]!.role === "comparison") {
      const binary = ast.is.IsBinaryExpression(consumer) ? ast.as.AsBinaryExpression(consumer) : undefined;
      if (binary === undefined || ["KindCommaToken", "KindQuestionQuestionToken", "KindAmpersandAmpersandToken",
        "KindBarBarToken"].includes(ast.operatorKindName(consumer) ?? "")) return undefined;
      const other = binary.Left === value ? binary.Right : binary.Right === value ? binary.Left : undefined;
      if (other === undefined || mayInterfere(other, source)) return undefined;
    } else if (ast.is.IsBinaryExpression(consumer) || ast.is.IsConditionalExpression(consumer) &&
      ast.as.AsConditionalExpression(consumer)?.Condition !== value) return undefined;
  }
  return parameter;
}

function borrowedInputIsStable(
  expression: Node, source: TargetSourceProgram, stableBindings: WeakMap<Node, boolean>,
): boolean {
  const { ast, navigation } = source;
  const pending = [expression];
  const visited = new Set<Node>();
  let steps = 0;
  const enter = (): boolean => ++steps <= 131_072;
  while (pending.length > 0) {
    if (!enter()) return false;
    const node = pending.pop()!;
    if (visited.has(node)) continue;
    visited.add(node);
    if (ast.is.IsIdentifier(node)) {
      const selected = navigation.sourceReferenceFor(node);
      if (selected === undefined) return false;
      const declaration = selected.declaration;
      if (ast.is.IsVariableDeclaration(declaration) || ast.is.IsParameterDeclaration(declaration) ||
        ast.is.IsBindingElement(declaration)) {
        let stable = stableBindings.get(declaration);
        if (stable === undefined) {
          const summary = navigation.declarationUseSummary(declaration);
          stable = selected.project && !summary.bindingWritten && !summary.memberWritten && !summary.captured &&
            !summary.aliasedOrStored && !summary.exported && !summary.receiverUsed &&
            !sourceBindingHasMutableExposure(source, summary, enter);
          stableBindings.set(declaration, stable);
        }
        if (!stable) return false;
      }
    }
    forEachSourceImmediateEvaluationChild(ast, node, child => pending.push(child));
  }
  return true;
}

function mayInterfere(expression: Node, source: TargetSourceProgram): boolean {
  const effects = source.navigation.expressionEffects(expression);
  return effects.invokes || effects.mutates || effects.suspends;
}
