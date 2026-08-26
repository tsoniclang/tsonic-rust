import { allocateRustSyntheticName } from "../names/synthetic.js";
import { diagnosticInput } from "../program/plan-context.js";
import { effectiveMemberResultCarrier, planOptionalChainExpression } from "./special.js";
import { expressionCarrier, requireExpressionCarrier, rustOperationFact, selectedOperationMatches } from "./fundamentals.js";
import { finishProviderOperationExpression, planProviderOperationExpression } from "./conversions.js";
import {
  KindNumericLiteral,
  ElementAccessExpression_ArgumentExpression,
  Node_Expression,
} from "@tsonic/target-api/source";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { planExpression } from "./entry.js";
import { planRustSharedReceiver } from "./typed-locations.js";
import { readRustProjectObjectIndex } from "../objects/project-objects.js";
import { rustProjectObjectRepresentation } from "../objects/project-storage.js";
import { requireProviderArgumentPassingFacts } from "./calls/arguments.js";
import { rustOptionalChainFactKey } from "../../../analysis/facts/keys.js";
import { rustOptionElementCarrier } from "../../../target-model/types/index.js";
import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";

export function planElementAccess(node: Node, context: RustPlanContext): RustExpr | undefined {
  return planOptionalChainExpression(
    node,
    context,
    "indexer",
    (innerContext) => planElementAccessInner(node, innerContext),
  );
}

function planElementAccessInner(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = rustOperationFact(node, context);
  if (fact !== undefined && fact.kind === "source-index-signature") {
    const resultCarrier = effectiveMemberResultCarrier(node, fact.resultCarrier, context);
    if (resultCarrier === undefined || !requireExpressionCarrier(
      node,
      resultCarrier,
      context,
      "rust.backend.project-index-carrier",
    ) || !selectedOperationMatches(
      context.input.program.facts.getSelectedTargetElementAccess(node),
      fact.operationId,
      "indexer",
      resultCarrier,
    )) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.project-index-selected-evidence",
        "Project index access conflicts with the TSTS-selected index-signature fact.",
      ));
      return undefined;
    }
    const receiverNode = Node_Expression(context.input.program.source.ast, node);
    const keyNode = ElementAccessExpression_ArgumentExpression(context.input.program.source.ast, node);
    const plannedReceiver = receiverNode === undefined
      ? undefined
      : planExpression(receiverNode, context);
    const key = keyNode === undefined ? undefined : planExpression(keyNode, context);
    const representation = rustProjectObjectRepresentation(fact.receiverCarrier, context);
    if (receiverNode === undefined || plannedReceiver === undefined || key === undefined ||
      representation === undefined || context.syntheticNames === undefined) {
      return undefined;
    }
    const receiverName = allocateRustSyntheticName(context.syntheticNames, "index_receiver");
    const keyName = allocateRustSyntheticName(context.syntheticNames, "index_key");
    return {
      kind: "block",
      bindings: [{
        name: receiverName,
        value: planRustSharedReceiver(receiverNode, plannedReceiver, context),
      }, {
        name: keyName,
        value: key,
      }],
      value: readRustProjectObjectIndex(
        { kind: "path", path: receiverName },
        fact.storageName,
        { kind: "path", path: keyName },
        resultCarrier,
        representation,
        context,
      ),
    };
  }
  if (fact !== undefined && fact.kind === "fixed-index") {
    const optional = context.input.program.facts.getFact(node, rustOptionalChainFactKey);
    const innerResult = optional?.innerResultCarrier ?? expressionCarrier(node, context);
    const selectedResult = innerResult === undefined
      ? undefined
      : effectiveMemberResultCarrier(node, innerResult, context);
    if (selectedResult === undefined || !requireExpressionCarrier(
      node,
      selectedResult,
      context,
      "rust.backend.fixed-index-carrier",
    ) || !selectedOperationMatches(
      context.input.program.facts.getSelectedTargetElementAccess(node),
      fact.operationId,
      "indexer",
      selectedResult,
    )) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.fixed-index-selected-evidence",
        "Fixed-array index fact conflicts with the TSTS-selected element-access fact.",
      ));
      return undefined;
    }
    const receiverNode = Node_Expression(context.input.program.source.ast, node);
    const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
    const indexNode = ElementAccessExpression_ArgumentExpression(context.input.program.source.ast, node);
    if (receiver === undefined || indexNode === undefined) {
      return undefined;
    }
    const effect = context.input.program.source.ast.kindName(indexNode) === KindNumericLiteral
      ? undefined
      : planExpression(indexNode, context);
    if (context.input.program.source.ast.kindName(indexNode) !== KindNumericLiteral && effect === undefined) {
      return undefined;
    }
    const value: RustExpr = {
      kind: "index",
      receiver,
      index: { kind: "int-literal", text: String(fact.index) },
    };
    return effect === undefined
      ? value
      : { kind: "evaluate-then", effect, discard: "value", value };
  }
  if (fact !== undefined && fact.kind === "tuple-index") {
    const indexNode = ElementAccessExpression_ArgumentExpression(context.input.program.source.ast, node);
    if (indexNode === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.tuple-index-source",
        "Tuple element fact has no concrete source index expression.",
      ));
      return undefined;
    }
    const resultCarrier = effectiveMemberResultCarrier(node, fact.resultCarrier, context);
    if (resultCarrier === undefined ||
      !requireExpressionCarrier(node, resultCarrier, context, "rust.backend.tuple-index-carrier")) {
      return undefined;
    }
    if (!selectedOperationMatches(
      context.input.program.facts.getSelectedTargetElementAccess(node),
      fact.operationId,
      "indexer",
      resultCarrier,
    )) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.tuple-index-selected-evidence",
        "Tuple element fact lacks a matching source index expression and TSTS-selected element-access fact.",
      ));
      return undefined;
    }
    const receiver = Node_Expression(context.input.program.source.ast, node);
    const planned = receiver === undefined ? undefined : planExpression(receiver, context);
    if (planned === undefined) {
      return undefined;
    }
    const value: RustExpr = { kind: "tuple-field", receiver: planned, index: fact.index };
    if (context.input.program.source.ast.kindName(indexNode) === KindNumericLiteral) {
      return value;
    }
    const effect = planExpression(indexNode, context);
    return effect === undefined
      ? undefined
      : { kind: "evaluate-then", effect, discard: "value", value };
  }
  if (fact === undefined || fact.kind !== "provider-operation" || fact.abi.operationKind !== "indexer") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.provider.indexer",
      "Element access requires a finalized provider indexer fact.",
    ));
    return undefined;
  }
  const elementResult = fact.abi.result.kind === "sync" ? fact.abi.result.carrier : fact.abi.result.futureCarrier;
  const selectedResult = effectiveMemberResultCarrier(node, elementResult, context);
  if (selectedResult === undefined ||
    !requireExpressionCarrier(node, selectedResult, context, "rust.backend.provider-indexer-carrier")) {
    return undefined;
  }
  if (!selectedOperationMatches(
    context.input.program.facts.getSelectedTargetElementAccess(node),
    fact.operationId,
    "indexer",
    selectedResult,
  )) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.provider-indexer-selected-evidence",
      "Provider indexer ABI conflicts with the TSTS-selected element-access fact.",
    ));
    return undefined;
  }
  const argumentNode = ElementAccessExpression_ArgumentExpression(context.input.program.source.ast, node);
  if (fact.abi.sourceArguments.length !== 1) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.provider-indexer-abi",
      "Provider indexer access requires a finalized one-argument ABI.",
    ));
    return undefined;
  }
  if (!requireProviderArgumentPassingFacts(context, fact, [argumentNode])) {
    return undefined;
  }
  const diagnosticCount = context.diagnostics.length;
  const planned = planProviderOperationExpression(
    context,
    fact,
    Node_Expression(context.input.program.source.ast, node),
    [argumentNode],
    node,
    { resultUse: "value" },
  );
  if (planned === undefined && context.diagnostics.length === diagnosticCount) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.provider.indexer",
      "Provider indexer operation could not be lowered.",
    ));
  }
  if (planned === undefined) {
    return undefined;
  }
  return finishProviderOperationExpression(context, fact, planned, node);
}

export function planArrayLiteral(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = rustOperationFact(node, context);
  if (fact !== undefined && fact.kind === "tuple-literal") {
    if (!requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.tuple-literal-carrier")) {
      return undefined;
    }
    const elements: RustExpr[] = [];
    for (const element of context.input.program.source.ast.elements(node)) {
      if (element === undefined) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, node),
          "rust.backend.tuple-element",
          "Tuple literal contains an undefined element slot.",
        ));
        return undefined;
      }
      const planned = planExpression(element, context);
      if (planned === undefined) {
        return undefined;
      }
      elements.push(planned);
    }
    const tupleCarrier = fact.resultCarrier.kind === "tuple"
      ? fact.resultCarrier
      : undefined;
    if (
      tupleCarrier === undefined ||
      elements.length + fact.omittedOptionalElementIndexes.length !==
        tupleCarrier.elements.length ||
      fact.omittedOptionalElementIndexes.some((index, omittedIndex) =>
        index !== elements.length + omittedIndex ||
        rustOptionElementCarrier(tupleCarrier.elements[index]) === undefined
      )
    ) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.tuple-optional-elements",
        "Tuple literal omission evidence conflicts with its exact finalized Rust tuple carrier.",
      ));
      return undefined;
    }
    for (const _index of fact.omittedOptionalElementIndexes) {
      elements.push({ kind: "none" });
    }
    return { kind: "tuple-literal", elements };
  }
  if (fact === undefined || fact.kind !== "array-literal") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.array-literal",
      "Array literals require a finalized Rust array lane fact.",
    ));
    return undefined;
  }
  if (!requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.array-literal-carrier")) {
    return undefined;
  }
  const sourceElements = context.input.program.source.ast.elements(node);
  const hasHoles = sourceElements.some((element) =>
    element !== undefined && context.input.program.source.ast.kindName(element) === "KindOmittedExpression");
  const elements: RustExpr[] = [];
  for (const [index, element] of sourceElements.entries()) {
    if (element === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.array-element",
        "Array literal contains an undefined element slot.",
      ));
      return undefined;
    }
    if (context.input.program.source.ast.kindName(element) === "KindOmittedExpression") {
      continue;
    }
    const planned = planExpression(element, context);
    if (planned === undefined) {
      return undefined;
    }
    elements.push(fact.lane === "js" && hasHoles
      ? { kind: "tuple-literal", elements: [{ kind: "int-literal", text: String(index) }, planned] }
      : planned);
  }
  if (fact.lane === "native") {
    return { kind: "vec-literal", elements };
  }
  context.usedAliases?.add("js_abi");
  return {
    kind: "call",
    path: hasHoles ? "js_abi::JsArray::from_sparse" : "js_abi::JsArray::from_dense",
    args: hasHoles
      ? [{ kind: "int-literal", text: String(fact.length) }, { kind: "vec-literal", elements }]
      : [{ kind: "vec-literal", elements }],
  };
}
