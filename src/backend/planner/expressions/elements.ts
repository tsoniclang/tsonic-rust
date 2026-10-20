import type { Node } from "@tsonic/tsts";
import { Node_Expression, ElementAccessExpression_ArgumentExpression } from "@tsonic/target-api/source";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../../invariants.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planNativeRustArrayAccess } from "./native-arrays.js";
import { planOptionalChainExpression } from "./optional-chains.js";
import { rustOperationFact, expressionCarrier } from "./fundamentals.js";
import { finishProviderOperationExpression, planProviderOperationExpression } from "./conversions.js";
import { planExpression } from "./entry.js";
import { planRustValueRead } from "./typed-locations.js";
import { planRustSourceIndexRead } from "../objects/indexed-records.js";
import { requireProviderArgumentPassingFacts } from "./calls/arguments.js";
import { planRustComputedMemberExpression } from "./computed-members.js";
import { planPropertyAccess } from "./properties.js";
import { planRustIndexedFieldRead } from "./indexed-locations.js";

export function planElementAccess(node: Node, context: RustPlanContext): RustExpr | undefined {
  if (context.input.program.records.selectedOperation.get(node)?.operationKind === "property") return planPropertyAccess(node, context);
  return planOptionalChainExpression(node, context, innerContext => planRustComputedMemberExpression(node, innerContext,
    selectedContext => planElementAccessInner(node, selectedContext)));
}

function planElementAccessInner(node: Node, context: RustPlanContext): RustExpr | undefined {
  if (context.input.program.records.nativeArrayStorage.get(node)?.kind === "element")
    return planNativeRustArrayAccess(node, context, planExpression, "load");
  const fact = rustOperationFact(node, context);
  if (fact?.kind === "source-indexed-field") return planRustIndexedFieldRead(node, fact, context);
  if (fact?.kind === "source-index-signature") return planRustSourceIndexRead(node, fact, context, planExpression);
  if (fact?.kind === "fixed-index" || fact?.kind === "tuple-index") {
    const selected = context.input.program.records.directStorage.get(node);
    if (selected?.kind !== "fixed" && selected?.kind !== "tuple")
      failRustPlannerInvariant("An admitted fixed projection requires its exact native receiver and source index.", node);
    const result = context.input.program.records.valueRead.get(node)?.source;
    const copy = result === undefined ? undefined : context.input.program.records.carrierRead.get(result)?.copy;
    if (fact.kind === "fixed-index" && copy === undefined)
      failRustPlannerInvariant("An admitted fixed-array projection requires its exact native Copy contract.", node);
    return planIndexedProjection(node, selected.receiver, selected.index, selected.evaluateIndex, context, (receiver, borrowed): RustExpr => {
      if (fact.kind === "tuple-index") return { kind: "field", receiver, name: String(fact.index) };
      if (borrowed || copy === true) return { kind: "index", receiver, index: { kind: "int-literal", text: String(fact.index) } };
      return { kind: "method-call", receiver: {
        kind: "method-call", receiver: { kind: "method-call", receiver, method: "into_iter", args: [] },
        method: fact.index === 0n ? "next" : "nth", args: fact.index === 0n ? [] : [{ kind: "int-literal", text: String(fact.index) }],
      }, method: "unwrap", args: [] };
    });
  }
  if (fact?.kind !== "provider-operation" || fact.abi.operationKind !== "indexer")
    failRustPlannerInvariant("Element access requires a finalized provider indexer fact.", node);
  const argument = ElementAccessExpression_ArgumentExpression(context.input.program.source.ast, node);
  if (fact.abi.sourceArguments.length !== 1 || argument === undefined)
    failRustPlannerInvariant("Provider indexer access requires its finalized one-argument ABI.", node);
  if (!requireProviderArgumentPassingFacts(context, fact, [argument]))
    failRustPlannerInvariant("An admitted provider indexer requires its exact native passing records.", node);
  const value = planProviderOperationExpression(context, fact, Node_Expression(context.input.program.source.ast, node), [argument], node, { resultUse: "value" });
  if (value === undefined) failRustPlannerInvariant("An admitted provider indexer requires its complete native operation syntax.", node);
  return finishProviderOperationExpression(context, fact, value, node);
}

function planIndexedProjection(node: Node, receiverNode: Node, indexNode: Node, evaluateIndex: boolean,
  context: RustPlanContext, project: (receiver: RustExpr, borrowed: boolean) => RustExpr): RustExpr {
  const receiver = planExpression(receiverNode, context)
    ?? failRustPlannerInvariant("An admitted fixed projection requires its rendered source receiver.", receiverNode);
  const borrowed = expressionCarrier(receiverNode, context)?.kind === "reference" ||
    context.expressionOverrides?.get(receiverNode)?.valueForm === "shared-reference";
  const read = (owner: RustExpr): RustExpr => borrowed ? planRustValueRead(node, project(owner, true), context) : project(owner, false);
  if (!evaluateIndex) return read(receiver);
  const effect = planExpression(indexNode, context)
    ?? failRustPlannerInvariant("An admitted fixed projection requires its source index effect.", indexNode);
  const receiverEffect = context.input.program.records.storageEffectful.get(receiverNode);
  const indexEffect = context.input.program.records.storageEffectful.get(indexNode);
  if (receiverEffect === undefined || indexEffect === undefined)
    failRustPlannerInvariant("An admitted fixed projection requires its source evaluation-order evidence.", node);
  if (!receiverEffect && !indexEffect) return read({ kind: "evaluate-then", effect, discard: "value", value: receiver });
  const names = context.syntheticNames ?? failRustPlannerInvariant("An admitted effectful projection requires its hygienic receiver scope.", node);
  const name = allocateRustSyntheticName(names, "indexed_receiver");
  return read(rustValueBlock([{ name, value: receiver }], { kind: "evaluate-then", effect, discard: "value", value: { kind: "path", path: name } }));
}
