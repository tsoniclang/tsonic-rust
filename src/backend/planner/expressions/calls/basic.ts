import { allocateRustSyntheticName } from "../../names/synthetic.js";
import { applyRustValueConversion, finishProviderOperationExpression, planProviderOperationExpression } from "../conversions.js";
import { planRustCallArguments } from "../input-shaping.js";
import { diagnosticInput } from "../../program/plan-context.js";
import { effectiveMemberResultCarrier, planOptionalChainExpression } from "../special.js";
import { isDenseDataArray } from "../../../../policy/model/closed-data.js";
import {
  KindPropertyAccessExpression,
  Node_Expression,
} from "@tsonic/target-api/source";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../../diagnostics.js";
import { planExpression } from "../entry.js";
import { planRustNonConsumingValue, planRustSharedReceiver, planRustTypedLocationCall } from "../typed-locations.js";
import { planRustSourceCallArgumentEvaluation, requireProviderArgumentPassingFacts } from "./arguments.js";
import { planSelectedSourceCall, sourceCallEffectsMatch } from "./source.js";
import { providerSelectedCallMatches, rustOperationFact } from "../fundamentals.js";
import { readRustStoredObjectField } from "../../objects/project-storage.js";
import { requireRustDefaultValueCarrier } from "../../types/generic-requirements.js";
import { rustArgumentPassingKey } from "../../../../policy/model/selections.js";
import { rustSourceCallEffectsFactKey } from "../../../../analysis/facts/keys.js";
import { rustStringTargetType } from "../../../../policy/types/target-types.js";
import { rustTargetTypeRefEquals } from "../../../../policy/types/equality.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../../rust-ast/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import type { RustTargetOperationFact } from "../../../../analysis/facts/keys.js";

export function planCallExpression(node: Node, context: RustPlanContext): RustExpr | undefined {
  return planOptionalChainExpression(
    node,
    context,
    "method",
    (innerContext) => planCallExpressionInner(node, innerContext),
  );
}

function planCallExpressionInner(node: Node, context: RustPlanContext): RustExpr | undefined {
  const { ast } = context.input;
  const fact = rustOperationFact(node, context);
  const callCarrier = context.input.facts.getRuntimeCarrierFact(node)?.carrier;
  const innerResultCarrier = fact?.kind === "source-call" ||
      fact?.kind === "provider-operation" ||
      fact?.kind === "object-shape-projection" ||
      fact?.kind === "default-value" ||
      fact?.kind === "typed-location"
    ? fact.resultCarrier
    : undefined;
  const selectedResultCarrier = innerResultCarrier === undefined
    ? undefined
    : effectiveMemberResultCarrier(node, innerResultCarrier, context);
  if (innerResultCarrier !== undefined && selectedResultCarrier === undefined) {
    return undefined;
  }
  if (selectedResultCarrier !== undefined &&
    (callCarrier === undefined || !rustTargetTypeRefEquals(callCarrier, selectedResultCarrier))) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.call-result-carrier",
      "Call runtime carrier conflicts with its finalized selected operation result carrier.",
    ));
    return undefined;
  }
  const sourceCallEffects = fact?.kind === "source-call"
    ? context.input.facts.getFact(node, rustSourceCallEffectsFactKey)
    : undefined;
  if (fact?.kind === "source-call" && !sourceCallEffectsMatch(fact, sourceCallEffects)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-call-effects",
      "Project-source call requires one structurally consistent finalized invocation/await effect fact.",
    ));
    return undefined;
  }
  const callee = Node_Expression(context.input.ast, node);
  if (fact?.kind === "typed-location") {
    return planRustTypedLocationCall(node, fact, context, planExpression);
  }
  if (fact !== undefined && fact.kind === "flow-marker") {
    const args = planRustCallArguments(node, context);
    if (args === undefined || args.length !== 1) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.flow-marker",
        "Flow marker call requires exactly one finalized argument expression.",
      ));
      return undefined;
    }
    // Flow marker calls erase to their argument; passing shape comes from the
    // consuming position's finalized argument modes.
    const [argument] = args;
    const [argumentNode] = context.input.ast.arguments(node);
    return fact.state === "moved" && argumentNode !== undefined
      ? planRustNonConsumingValue(argumentNode, argument!, context)
      : argument;
  }
  if (fact !== undefined && fact.kind === "object-shape-projection") {
    return planObjectShapeProjectionCall(node, fact, context);
  }
  if (fact !== undefined && fact.kind === "default-value") {
    return planRustDefaultValueCall(node, fact, context);
  }
  if (fact !== undefined && fact.kind === "source-call") {
    const argumentPlan = planRustSourceCallArgumentEvaluation(
      node,
      fact,
      context,
    );
    if (argumentPlan === undefined) {
      return undefined;
    }
    const planned = planSelectedSourceCall(
      node,
      callee,
      argumentPlan.arguments,
      fact,
      context,
    );
    return planned === undefined || argumentPlan.bindings.length === 0
      ? planned
      : {
          kind: "block",
          bindings: argumentPlan.bindings,
          value: planned,
        };
  }
  if (fact !== undefined && fact.kind === "provider-operation") {
    const superConstruction = fact.abi.operationKind === "constructor" &&
      callee !== undefined && ast.kindName(callee) === "KindSuperKeyword";
    if (fact.abi.operationKind !== "method" && !superConstruction) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.provider.call-kind",
        `Call expression requires a finalized provider method fact, received '${fact.abi.operationKind}'.`,
      ));
      return undefined;
    }
    if (!providerSelectedCallMatches(node, fact, context)) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.provider-call-selected-signature",
        "Provider call ABI conflicts with the TSTS-selected target member ABI.",
      ));
      return undefined;
    }
    const receiverNode = callee !== undefined && ast.kindName(callee) === KindPropertyAccessExpression
      ? Node_Expression(context.input.ast, callee)
      : undefined;
    const providerArgumentNodes = [...context.input.ast.arguments(node)];
    if (providerArgumentNodes.length !== fact.abi.sourceArguments.length) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.provider-call-arity",
        `Provider call has ${providerArgumentNodes.length} source arguments but its finalized ABI requires ${fact.abi.sourceArguments.length}.`,
      ));
      return undefined;
    }
    if (!requireProviderArgumentPassingFacts(context, fact, providerArgumentNodes)) {
      return undefined;
    }
    const diagnosticCount = context.diagnostics.length;
    const planned = planProviderOperationExpression(
      context,
      fact,
      receiverNode,
      providerArgumentNodes,
      node,
      { resultUse: "value" },
    );
    if (planned === undefined && context.diagnostics.length === diagnosticCount) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "rust.provider.call",
        "Provider call operation could not be lowered.",
      ));
    }
    if (planned === undefined) {
      return undefined;
    }
    return finishProviderOperationExpression(context, fact, planned, node);
  }
  context.diagnostics.push(missingFactDiagnostic(
    diagnosticInput(context, node),
    "rust.backend.call",
    "Call expression has no finalized Rust operation fact.",
  ));
  return undefined;
}

function planRustDefaultValueCall(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "default-value" }>,
  context: RustPlanContext,
): RustExpr | undefined {
  const sourceArguments = context.input.ast.arguments(node);
  const selected = context.input.facts.getSelectedTargetCall(node);
  const operation = context.input.facts.getSelectedTargetOperation(node);
  if (!isDenseDataArray(sourceArguments) || sourceArguments.length !== 0 ||
    selected === undefined || selected.member.id !== fact.operationId ||
    selected.member.kind !== "method" || selected.member.static !== true ||
    selected.member.parameters.length !== 0 || selected.member.returnType === undefined ||
    !rustTargetTypeRefEquals(selected.member.returnType, fact.resultCarrier) ||
    selected.member.typeParameters?.length !== 1 ||
    selected.targetTypeArguments?.length !== 1 ||
    !rustTargetTypeRefEquals(selected.targetTypeArguments[0], fact.resultCarrier) ||
    operation === undefined || operation.operationId !== fact.operationId ||
    operation.operationKind !== "method" || operation.targetOperation !== "Default::default" ||
    operation.resultType === undefined ||
    !rustTargetTypeRefEquals(operation.resultType, fact.resultCarrier)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.default-value-selected-signature",
      "defaultValue<T>() conflicts with its finalized zero-argument Rust Default contract.",
    ));
    return undefined;
  }
  if (!requireRustDefaultValueCarrier(fact.resultCarrier, node, context)) {
    return undefined;
  }
  const owner = rustTypeFromCarrierInContext(fact.resultCarrier, context);
  if (owner === undefined) {
    return undefined;
  }
  return {
    kind: "associated-call",
    owner,
    trait: { kind: "named", path: "Default" },
    method: "default",
    args: [],
  };
}
function planObjectShapeProjectionCall(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "object-shape-projection" }>,
  context: RustPlanContext,
): RustExpr | undefined {
  const sourceArguments = context.input.ast.arguments(node);
  const staticCall = fact.sourceValueOrigin.kind === "argument";
  if (
    staticCall &&
    sourceArguments[fact.sourceValueOrigin.index] !== fact.sourceValue
  ) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.object-shape-projection-source",
      "Closed Object projection source argument conflicts with its finalized origin.",
    ));
    return undefined;
  }
  const expectedParameterCarriers = staticCall
    ? fact.projection === "has-own"
      ? [fact.sourceValueCarrier, rustStringTargetType()]
      : [fact.sourceValueCarrier]
    : fact.projection === "has-own"
      ? [rustStringTargetType()]
      : [];
  const selected = context.input.facts.getSelectedTargetCall(node);
  if (selected === undefined || selected.member.id !== fact.operationId ||
    selected.member.kind !== "method" ||
    (selected.member.static === true) !== staticCall ||
    selected.member.returnType === undefined ||
    !rustTargetTypeRefEquals(selected.member.returnType, fact.resultCarrier) ||
    selected.member.parameters.length !== expectedParameterCarriers.length ||
    !selected.member.parameters.every((parameter, index) =>
      rustTargetTypeRefEquals(parameter.type, expectedParameterCarriers[index]) &&
      parameter.passingMode === (staticCall && index === 0 ? "borrow-shared" : "by-value")) ||
    (!staticCall && !rustTargetTypeRefEquals(
      selected.sourceSelectedReceiverCarrier,
      fact.sourceValueCarrier,
    ))) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.object-shape-projection-selected-signature",
      "Closed Object projection conflicts with its TSTS-selected target member contract.",
    ));
    return undefined;
  }
  if (!isDenseDataArray(sourceArguments) || sourceArguments.some((argument) => argument === undefined) ||
    sourceArguments.length !== expectedParameterCarriers.length ||
    sourceArguments.some((argument, index) => {
      const passing = context.input.facts.getFact(argument!, rustArgumentPassingKey);
      return passing?.mode !== (staticCall && index === 0 ? "borrow-shared" : "by-value");
    })) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.object-shape-projection-arguments",
      "Closed Object projection source arguments conflict with their finalized passing contracts.",
    ));
    return undefined;
  }
  if (context.syntheticNames === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.object-shape-projection-name-state",
      "Closed Object projection requires the compilation-owned synthetic-name state.",
    ));
    return undefined;
  }
  const plannedSourceValue = planExpression(fact.sourceValue, context);
  if (plannedSourceValue === undefined) {
    return undefined;
  }
  const receiverName = allocateRustSyntheticName(
    context.syntheticNames,
    fact.projection === "values" || fact.projection === "entries"
      ? "object_projection_value"
      : "_object_projection_value",
  );
  const bindings: Extract<RustExpr, { readonly kind: "block" }>["bindings"][number][] = [{
    name: receiverName,
    value: planRustSharedReceiver(fact.sourceValue, plannedSourceValue, context),
  }];
  let keyName: string | undefined;
  if (fact.keyExpression !== undefined) {
    const plannedKey = planExpression(fact.keyExpression, context);
    if (plannedKey === undefined) {
      return undefined;
    }
    keyName = allocateRustSyntheticName(
      context.syntheticNames,
      "object_projection_key",
    );
    bindings.push({ name: keyName, value: plannedKey });
  }
  const receiver: RustExpr = { kind: "path", path: receiverName };
  let value: RustExpr | undefined;
  switch (fact.projection) {
    case "keys":
      value = rustObjectProjectionArray(
        fact.fields.map((field) => ({
          kind: "string-literal" as const,
          value: field.sourceName,
        })),
        context,
      );
      break;
    case "values":
    case "entries": {
      const projected: RustExpr[] = [];
      for (const field of fact.fields) {
        const stored = readRustStoredObjectField(
          fact.storage,
          fact.sourceValueCarrier,
          receiver,
          field.storageIndex,
          field.valueCarrier,
          context,
        );
        const converted = stored === undefined
          ? undefined
          : applyRustValueConversion(
              context,
              stored,
              field.conversion,
              undefined,
              false,
            );
        if (converted === undefined) {
          context.diagnostics.push(missingFactDiagnostic(
            diagnosticInput(context, node),
            "rust.backend.object-shape-projection-field",
            `Closed Object projection member '${field.sourceName}' has no exact stored-field read and conversion.`,
          ));
          return undefined;
        }
        projected.push(fact.projection === "values"
          ? converted
          : {
              kind: "tuple-literal",
              elements: [
                { kind: "string-literal", value: field.sourceName },
                converted,
              ],
            });
      }
      value = rustObjectProjectionArray(projected, context);
      break;
    }
    case "has-own":
      if (keyName === undefined) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, node),
          "rust.backend.object-shape-projection-key",
          "Closed Object.hasOwn projection has no finalized key expression.",
        ));
        return undefined;
      }
      const comparisons = fact.fields.map<RustExpr>((field) => ({
        kind: "binary",
        operator: "==",
        left: {
          kind: "method-call",
          receiver: { kind: "path", path: keyName! },
          method: "as_str",
          args: [],
        },
        right: { kind: "str-literal", value: field.sourceName },
      }));
      value = comparisons.length === 0
        ? { kind: "bool-literal", value: false }
        : comparisons.slice(1).reduce<RustExpr>(
        (left, right) => ({
          kind: "binary",
          operator: "||",
          left,
          right,
        }),
        comparisons[0]!,
      );
      break;
  }
  return value === undefined
    ? undefined
    : { kind: "block", bindings, value };
}

function rustObjectProjectionArray(
  elements: readonly RustExpr[],
  context: RustPlanContext,
): RustExpr {
  context.usedAliases?.add("js_abi");
  return {
    kind: "call",
    path: "js_abi::JsArray::from_dense",
    args: [{ kind: "vec-literal", elements }],
  };
}
