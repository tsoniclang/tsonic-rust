import type { Node } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import type { RustExpr } from "../../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import type { RustTargetOperationFact } from "../../../../target-model/records/operations/operations.js";
import type { RustNativeHandler } from "../../../../target-model/records/native/native-handlers.js";
import { rustMemberAccessReceiver } from "../../../../target-model/syntax/expressions.js";
import { rustValueBlock } from "../../../target-ast/syntax/value-block.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import { allocateRustSyntheticName } from "../../names/synthetic.js";
import { planExpression, type RustExpressionResultUse } from "../entry.js";
import { planOptionalChainExpression } from "../optional-chains.js";
import { planRustComputedMemberExpression } from "../computed-members.js";
import { rustOperationFact } from "../fundamentals.js";
import { planRustBorrowedElementRead } from "../borrowed-element-reads.js";
import { planRustClosedTypeTest } from "../type-tests.js";
import { planRustNativeControl } from "../native-controls.js";
import { planRustReferenceOperationCall } from "../reference-operations.js";
import { planRustTypedLocationCall } from "../typed-location-calls.js";
import { planRustCallArguments } from "../input-shaping.js";
import { planRustSourceCallArgumentEvaluation, requireProviderArgumentPassingFacts } from "./arguments.js";
import { planSelectedSourceCall } from "./source.js";
import { planRustValueProjection } from "../flow-read-projections.js";
import { planProviderOperationExpression, finishProviderOperationExpression } from "../conversions.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { requireRustDefaultValueCarrier } from "../../types/generic-requirements.js";
import { planRustSharedReceiver } from "../typed-locations.js";
import { readRustStoredObjectField, writeRustStoredObjectField } from "../../objects/project-storage.js";
import { applyRustValueConversion } from "../value-conversions.js";

type RustNativeCallHandler = Extract<RustNativeHandler, { readonly kind: "js-string-conversion" | "typed-location" }>;

export function planCallExpression(node: Node, context: RustPlanContext, resultUse: RustExpressionResultUse = "value",
  native?: RustNativeCallHandler): RustExpr | undefined {
  const borrowed = context.input.program.records.borrowedElementRead.get(node);
  if (borrowed !== undefined) return planRustBorrowedElementRead(node, borrowed, context,
    (expression, inner) => planCallExpressionInner(expression, inner, resultUse, native));
  return planOptionalChainExpression(node, context, inner => {
    const callee = Node_Expression(inner.input.program.source.ast, node);
    if (callee === undefined) failRustPlannerInvariant("An admitted call requires its exact checked callee.", node);
    return planRustComputedMemberExpression(callee, inner, selected => planCallExpressionInner(node, selected, resultUse, native));
  });
}

function planCallExpressionInner(node: Node, context: RustPlanContext, resultUse: RustExpressionResultUse,
  native: RustNativeCallHandler | undefined): RustExpr | undefined {
  const fact = native?.kind === "typed-location" ? native.selection.operation : native?.selection ?? rustOperationFact(node, context);
  const callee = Node_Expression(context.input.program.source.ast, node);
  switch (fact?.kind) {
    case "closed-type-test": return planRustClosedTypeTest(node, fact, context);
    case "native-range":
    case "native-propagation": return planRustNativeControl(node, fact, context, planExpression);
    case "reference-operation": return planRustReferenceOperationCall(node, fact, context, planExpression);
    case "typed-location": {
      if (native?.kind !== "typed-location") failRustPlannerInvariant("An admitted typed-location call requires its exact native handler.", node);
      return planRustTypedLocationCall(node, native.selection.operation, native.selection.plan, context, planExpression);
    }
    case "flow-marker": {
      const args = planRustCallArguments(node, context);
      if (args?.length !== 1) failRustPlannerInvariant("An admitted flow marker requires its exact source argument.", node);
      return args[0];
    }
    case "object-shape-projection": return planObjectShapeProjectionCall(node, fact, context, resultUse);
    case "default-value": {
      if (!requireRustDefaultValueCarrier(fact.resultCarrier, node, context)) failRustPlannerInvariant("An admitted default initialization requires its native Default guarantee.", node);
      const owner = rustTypeFromCarrierInContext(fact.resultCarrier, context)
        ?? failRustPlannerInvariant("An admitted default initialization requires its native owner type.", node);
      return { kind: "associated-call", owner, trait: { kind: "named", path: "Default" }, method: "default", args: [] };
    }
    case "source-call": {
      const arguments_ = planRustSourceCallArgumentEvaluation(node, context);
      if (arguments_ === undefined) failRustPlannerInvariant("An admitted call requires its exact native argument frame.", node);
      const value = planSelectedSourceCall(node, callee, arguments_, fact, context);
      const result = value === undefined || fact.resultProjection === undefined ? value : planRustValueProjection(node, value, fact.resultProjection, context, "move");
      if (result === undefined) failRustPlannerInvariant("An admitted call requires its native return projection.", node);
      return arguments_.bindings.length === 0 ? result : { kind: "block", body: { statements: [...arguments_.bindings, { kind: "tail", expr: result }] } };
    }
    case "provider-operation": {
      const args = context.input.program.source.ast.arguments(node);
      requireProviderArgumentPassingFacts(context, fact, args);
      const value = planProviderOperationExpression(context, fact, rustMemberAccessReceiver(context.input.program.source.ast, callee), args, node, { resultUse: "value" });
      if (value === undefined) failRustPlannerInvariant("An admitted provider call requires its exact native invocation syntax.", node);
      return finishProviderOperationExpression(context, fact, value, node);
    }
    default: return failRustPlannerInvariant("An admitted call requires its finalized native operation.", node);
  }
}

function planObjectShapeProjectionCall(node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "object-shape-projection" }>, context: RustPlanContext,
  resultUse: RustExpressionResultUse): RustExpr {
  const names = context.syntheticNames ?? failRustPlannerInvariant("An admitted object projection requires its native hygienic scope.", node);
  const source = planExpression(fact.sourceValue, context)
    ?? failRustPlannerInvariant("An admitted object projection requires its native receiver value.", node);
  const receiverName = allocateRustSyntheticName(names, fact.projection === "values" || fact.projection === "entries" || fact.projection === "assign"
    ? "object_projection_value" : "_object_projection_value");
  const bindings: Parameters<typeof rustValueBlock>[0][number][] = [{ name: receiverName, value: planRustSharedReceiver(fact.sourceValue, source, context) }];
  const receiver: RustExpr = { kind: "path", path: receiverName };
  let key: RustExpr | undefined;
  if (fact.keyExpression !== undefined) {
    const value = planExpression(fact.keyExpression, context)
      ?? failRustPlannerInvariant("An admitted object projection requires its native key value.", node);
    const name = allocateRustSyntheticName(names, "object_projection_key");
    bindings.push({ name, value }); key = { kind: "path", path: name };
  }
  let assignment: RustExpr | undefined;
  if (fact.assignmentSource !== undefined) {
    const value = planExpression(fact.assignmentSource, context)
      ?? failRustPlannerInvariant("An admitted object assignment requires its native source value.", node);
    const name = allocateRustSyntheticName(names, "object_assignment_source");
    bindings.push({ name, value: planRustSharedReceiver(fact.assignmentSource, value, context) }); assignment = { kind: "path", path: name };
  }
  let result: RustExpr;
  switch (fact.projection) {
    case "keys": result = objectArray(fact.fields.map(field => ({ kind: "string-literal", value: field.sourceName })), context); break;
    case "values":
    case "entries": {
      const values = fact.fields.map((field): RustExpr => {
        const read = readRustStoredObjectField(fact.storage, fact.sourceValueCarrier, receiver, field.storageIndex, field.valueCarrier, context);
        const value = read === undefined ? undefined : applyRustValueConversion(context,
          { stage: "finalized", expression: read }, field.conversion, undefined);
        if (value === undefined) failRustPlannerInvariant("An admitted object projection requires its native stored-field conversion.", node);
        return fact.projection === "values" ? value : { kind: "tuple-literal", elements: [{ kind: "string-literal", value: field.sourceName }, value] };
      });
      result = objectArray(values, context); break;
    }
    case "has-own": {
      if (key === undefined) failRustPlannerInvariant("An admitted membership projection requires its native key.", node);
      const comparisons = fact.fields.map((field): RustExpr => ({ kind: "binary", operator: "==",
        left: { kind: "method-call", receiver: key!, method: "as_str", args: [] }, right: { kind: "str-literal", value: field.sourceName } }));
      result = comparisons.length === 0 ? { kind: "bool-literal", value: false }
        : comparisons.slice(1).reduce<RustExpr>((left, right) => ({ kind: "binary", operator: "||", left, right }), comparisons[0]!);
      break;
    }
    case "assign": {
      if (assignment === undefined || fact.assignmentSourceCarrier === undefined || fact.assignmentFields === undefined)
        failRustPlannerInvariant("An admitted object assignment requires its exact native source and field correspondence.", node);
      const effects = fact.assignmentFields.map(field => {
        const read = readRustStoredObjectField(fact.storage, fact.assignmentSourceCarrier!, assignment!, field.sourceStorageIndex, field.sourceCarrier, context);
        const value = read === undefined ? undefined : applyRustValueConversion(context,
          { stage: "finalized", expression: read }, field.conversion, undefined);
        const write = value === undefined ? undefined : writeRustStoredObjectField(fact.storage, fact.sourceValueCarrier, receiver, field.targetStorageIndex, "=", value, context);
        return write ?? failRustPlannerInvariant("An admitted object assignment requires its native field write.", node);
      });
      result = effects.reduceRight<RustExpr>((value, effect) => ({ kind: "evaluate-then", effect, discard: "unit", value }),
        resultUse === "discarded" ? { kind: "tuple-literal", elements: [] } : { kind: "method-call", receiver, method: "clone", args: [] });
      break;
    }
  }
  return rustValueBlock(bindings, result);
}

function objectArray(elements: readonly RustExpr[], context: RustPlanContext): RustExpr {
  context.usedAliases?.add("js_abi");
  return { kind: "call", path: "js_abi::JsArray::from_dense", args: [{ kind: "vec-literal", elements }] };
}
