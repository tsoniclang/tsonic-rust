import {
  rustFlowReadProjectionFactKey,
  rustOptionalChainFactKey,
  rustSourceAccessorEffectsFactKey,
  rustSourceCallEffectsFactKey,
} from "../../../analysis/facts/keys.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { applyRustFallibleResultExpression } from "../types/fallible-shape.js";
import { diagnosticInput, registerAliasFromPath, rustActiveErrorType } from "../program/plan-context.js";
import { expressionCarrier, providerSelectedCallMatches, requireExpressionCarrier, rustOperationFact } from "./fundamentals.js";
import { finishProviderOperationExpression, planProviderOperationExpression } from "./conversions.js";
import { applyRustArgumentMode, planRustCallArguments } from "./input-shaping.js";
import {
  KindCallExpression,
  KindPropertyAccessExpression,
  Node_Expression,
} from "@tsonic/target-api/source";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { planExpression, planRawExpression } from "./entry.js";
import { planRustNonConsumingValue } from "./typed-locations.js";
import { planSelectedSourceCall } from "./calls/source.js";
import { readRustStructuralObjectMethodStorage } from "../objects/project-storage.js";
import { requireProviderArgumentPassingFacts } from "./calls/arguments.js";
import { rustOptionElementCarrier, rustOptionTargetType, rustStructuralMethodStorageCarrier } from "../../../target-model/types/index.js";
import { rustJsStringTargetType } from "../../../target-model/types/index.js";
import { rustTargetOperationIsFallible } from "../../../analysis/facts/target-operation.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustOptionalChainFact } from "../../../analysis/facts/keys.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export function planRegExpCreate(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = rustOperationFact(node, context);
  if (fact === undefined || fact.kind !== "regexp-create") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.js.regexp",
      "RegExp expressions require a finalized construction operation fact.",
    ));
    return undefined;
  }
  if (!requireExpressionCarrier(
    node,
    fact.resultCarrier,
    context,
    "rust.backend.regexp-result-carrier",
  )) {
    return undefined;
  }
  const arguments_ = planRegExpCreateArguments(node, fact, context);
  if (arguments_ === undefined) {
    return undefined;
  }
  const activeErrorType = rustActiveErrorType(context);
  if (activeErrorType === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.error.call",
      "Fallible calls require a fallible lowering context (a throwing function or a try block).",
    ));
    return undefined;
  }
  registerAliasFromPath(context, fact.targetOperation);
  return {
    kind: "try",
    resultErrorType: activeErrorType,
    operandErrorType: { kind: "named", path: "js_abi::JsError" },
    expr: {
      kind: "call",
      path: fact.targetOperation,
      args: arguments_,
    },
  };
}

function planRegExpCreateArguments(
  node: Node,
  fact: Extract<NonNullable<ReturnType<typeof rustOperationFact>>, { readonly kind: "regexp-create" }>,
  context: RustPlanContext,
): readonly RustExpr[] | undefined {
  if (fact.input.kind === "literal") {
    return [
      { kind: "str-literal", value: fact.input.pattern },
      { kind: "str-literal", value: fact.input.flags },
    ];
  }
  if (!selectedRegExpCallMatches(node, fact, context)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.regexp-selected-signature",
      "RegExp construction conflicts with its finalized selected call and target operation facts.",
    ));
    return undefined;
  }
  const sourceArguments = context.input.program.source.ast.arguments(node);
  const expectedArgumentCount = fact.input.sourceArgumentCount;
  if (sourceArguments.length !== expectedArgumentCount) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.regexp-source-arguments",
      `RegExp construction has ${sourceArguments.length} source arguments but its finalized fact requires ${expectedArgumentCount}.`,
    ));
    return undefined;
  }
  const planned = expectedArgumentCount === 0 ? [] : planRustCallArguments(node, context);
  const patternNode = sourceArguments[0];
  if (planned === undefined) {
    return undefined;
  }
  if (fact.input.patternKind === "omitted") {
    return planned.length === 0 ? [] : undefined;
  }
  if (patternNode === undefined || planned[0] === undefined ||
    fact.input.patternCarrier === undefined ||
    !requireExpressionCarrier(
      patternNode,
      fact.input.patternCarrier,
      context,
      "rust.backend.regexp-pattern-carrier",
    )) {
    return undefined;
  }
  const pattern = fact.input.patternKind === "string"
    ? applyRustArgumentMode(context, planned[0], "ref", patternNode)
    : fact.input.patternKind === "regexp"
      ? applyRustArgumentMode(context, planned[0], "ref", patternNode)
      : planned[0];
  const flagsNode = sourceArguments[1];
  const flags = fact.input.flagsKind === "omitted"
    ? undefined
    : fact.input.flagsCarrier === undefined || flagsNode === undefined || planned[1] === undefined ||
        !requireExpressionCarrier(
          flagsNode,
          fact.input.flagsCarrier,
          context,
          "rust.backend.regexp-flags-carrier",
        )
      ? undefined
      : fact.input.flagsKind === "string"
        ? applyRustArgumentMode(context, planned[1], "ref", flagsNode)
        : planned[1];
  if (fact.input.flagsKind !== "omitted" && flags === undefined) {
    return undefined;
  }
  return flags === undefined ? [pattern] : [pattern, flags];
}

function selectedRegExpCallMatches(
  node: Node,
  fact: Extract<NonNullable<ReturnType<typeof rustOperationFact>>, { readonly kind: "regexp-create" }>,
  context: RustPlanContext,
): boolean {
  if (fact.input.kind !== "selected-call") {
    return false;
  }
  const selected = context.input.program.facts.getSelectedTargetCall(node);
  const operation = context.input.program.facts.getSelectedTargetOperation(node);
  const [patternParameter, flagsParameter] = selected?.member.parameters ?? [];
  const selectedPatternCarrier = fact.input.patternCarrier ?? rustJsStringTargetType();
  const selectedFlagsCarrier = fact.input.flagsCarrier ?? rustJsStringTargetType();
  return selected !== undefined &&
    selected.member.id === fact.operationId &&
    selected.member.kind === (fact.input.invocation === "construct" ? "constructor" : "method") &&
    selected.member.parameters.length === 2 &&
    patternParameter !== undefined &&
    patternParameter.optional === true &&
    rustTargetTypeRefEquals(patternParameter.type, selectedPatternCarrier) &&
    flagsParameter !== undefined &&
    flagsParameter.optional === true &&
    rustTargetTypeRefEquals(flagsParameter.type, selectedFlagsCarrier) &&
    selected.member.returnType !== undefined &&
    rustTargetTypeRefEquals(selected.member.returnType, fact.resultCarrier) &&
    operation !== undefined &&
    operation.operationId === fact.operationId &&
    operation.operationKind === (fact.input.invocation === "construct" ? "constructor" : "method") &&
    operation.targetOperation === fact.targetOperation &&
    operation.resultType !== undefined &&
    rustTargetTypeRefEquals(operation.resultType, fact.resultCarrier);
}

export function planNewExpression(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = rustOperationFact(node, context);
  if (fact !== undefined && fact.kind === "regexp-create") {
    return planRegExpCreate(node, context);
  }
  if (fact !== undefined && fact.kind === "source-call" && fact.target.form === "constructor") {
    if (!requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.source-constructor-carrier")) {
      return undefined;
    }
    const args = planRustCallArguments(node, context);
    return args === undefined
      ? undefined
      : planSelectedSourceCall(node, Node_Expression(context.input.program.source.ast, node), args, fact, context);
  }
  if (fact === undefined || fact.kind !== "provider-operation" || fact.abi.operationKind !== "constructor") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.provider.constructor",
      "Constructor expression requires a finalized provider constructor fact.",
    ));
    return undefined;
  }
  if (!providerSelectedCallMatches(node, fact, context)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.provider-constructor-selected-signature",
      "Provider constructor ABI conflicts with the TSTS-selected target member ABI.",
    ));
    return undefined;
  }
  if (!requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.provider-constructor-carrier")) {
    return undefined;
  }
  const argumentNodes = [...context.input.program.source.ast.arguments(node)];
  if (argumentNodes.length !== fact.abi.sourceArguments.length) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.provider-constructor-arity",
      `Provider constructor has ${argumentNodes.length} source arguments but its finalized ABI requires ${fact.abi.sourceArguments.length}.`,
    ));
    return undefined;
  }
  if (!requireProviderArgumentPassingFacts(context, fact, argumentNodes)) {
    return undefined;
  }
  const diagnosticCount = context.diagnostics.length;
  const planned = planProviderOperationExpression(
    context,
    fact,
    undefined,
    argumentNodes,
    node,
    { resultUse: "value" },
  );
  if (planned === undefined && context.diagnostics.length === diagnosticCount) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.provider.constructor",
      "Provider constructor operation could not be lowered.",
    ));
  }
  if (planned === undefined) {
    return undefined;
  }
  return finishProviderOperationExpression(context, fact, planned, node);
}

export function effectiveMemberResultCarrier(
  node: Node,
  innerResultCarrier: TargetTypeRef,
  context: RustPlanContext,
): TargetTypeRef | undefined {
  const optional = context.input.program.facts.getFact(node, rustOptionalChainFactKey);
  if (optional === undefined) {
    return innerResultCarrier;
  }
  if (!rustTargetTypeRefEquals(optional.innerResultCarrier, innerResultCarrier)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.optional-chain-inner-result",
      "Optional-chain plan conflicts with the finalized selected member operation result.",
    ));
    return undefined;
  }
  return optional.resultCarrier;
}

export function planOptionalChainExpression(
  node: Node,
  context: RustPlanContext,
  expectedKind: RustOptionalChainFact["operationKind"],
  planInner: (context: RustPlanContext) => RustExpr | undefined,
): RustExpr | undefined {
  const fact = context.input.program.facts.getFact(node, rustOptionalChainFactKey);
  if (fact === undefined) {
    return planInner(context);
  }
  const actualResultCarrier = expressionCarrier(node, context);
  const actualGuardCarrier = expressionCarrier(fact.guard, context);
  const structuralMethodGuard = exactOptionalStructuralMethodGuard(
    node,
    fact,
    context,
  );
  const sourceElement = rustOptionElementCarrier(fact.sourceGuardCarrier);
  const finalRelationshipValid = fact.lowering === "map"
    ? rustTargetTypeRefEquals(fact.resultCarrier, rustOptionTargetType(fact.innerResultCarrier))
    : rustOptionElementCarrier(fact.innerResultCarrier) !== undefined &&
      rustTargetTypeRefEquals(fact.resultCarrier, fact.innerResultCarrier);
  if (fact.expression !== node || fact.operationKind !== expectedKind ||
    actualResultCarrier === undefined || !rustTargetTypeRefEquals(actualResultCarrier, fact.resultCarrier) ||
    actualGuardCarrier === undefined || !rustTargetTypeRefEquals(actualGuardCarrier, fact.sourceGuardCarrier) ||
    sourceElement === undefined || !rustTargetTypeRefEquals(sourceElement, fact.selectedGuardCarrier) ||
    !finalRelationshipValid) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.optional-chain-contract",
      "Optional-chain lowering conflicts with its exact guard, selected receiver, operation, or result carriers.",
    ));
    return undefined;
  }
  if (context.syntheticNames === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.optional-chain-name-state",
      "Optional-chain lowering requires the compilation-owned synthetic-name state.",
    ));
    return undefined;
  }
  const guardFlowRead = context.input.program.facts.getFact(
    fact.guard,
    rustFlowReadProjectionFactKey,
  );
  if (structuralMethodGuard === undefined && guardFlowRead !== undefined &&
    (guardFlowRead.kind !== "option-value" ||
      !rustTargetTypeRefEquals(guardFlowRead.sourceCarrier, fact.sourceGuardCarrier) ||
      !rustTargetTypeRefEquals(guardFlowRead.selectedCarrier, fact.selectedGuardCarrier))) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, fact.guard),
      "rust.backend.optional-chain-flow-read",
      "Optional-chain lowering conflicts with the separately finalized receiver projection.",
    ));
    return undefined;
  }
  const plannedGuard = structuralMethodGuard === undefined
    ? planRawExpression(fact.guard, context, "value")
    : planOptionalStructuralMethodStorageGuard(structuralMethodGuard, context);
  if (plannedGuard === undefined) {
    return undefined;
  }
  const guard = planRustNonConsumingValue(fact.guard, plannedGuard, context);
  const receiverName = allocateRustSyntheticName(context.syntheticNames, "optional_receiver");
  const overrides = new Map(context.expressionOverrides ?? []);
  overrides.set(fact.guard, {
    expression: { kind: "path", path: receiverName },
    carrier: fact.selectedGuardCarrier,
    valueForm: "shared-reference",
  });
  const body = planInner({ ...context, expressionOverrides: overrides });
  if (body === undefined) {
    return undefined;
  }
  const sourceCallEffects = context.input.program.facts.getFact(node, rustSourceCallEffectsFactKey);
  const sourceAccessorEffects = context.input.program.facts.getFact(
    node,
    rustSourceAccessorEffectsFactKey,
  );
  const innerFallible = rustTargetOperationIsFallible(
    rustOperationFact(node, context),
    context.input.program.structuralShapes,
    context.input.program.projectFieldDispatch,
  ) ||
    sourceCallEffects?.invocation === "fallible" ||
    sourceAccessorEffects?.read === "fallible";
  if (innerFallible) {
    context.usedAliases?.add("rt");
  }
  const activeErrorType = rustActiveErrorType(context);
  if (innerFallible && activeErrorType === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.error.optional-chain",
      "Fallible optional-chain operations require a finalized fallible lowering context.",
    ));
    return undefined;
  }
  const fallibleBody = applyRustFallibleResultExpression(body, {
    errorType: activeErrorType!,
  });
  const mapped: RustExpr = {
    kind: "method-call",
    receiver: { kind: "method-call", receiver: guard, method: "as_ref", args: [] },
    method: innerFallible || fact.lowering === "map" ? "map" : "and_then",
    args: [{
      kind: "closure",
      params: [{ name: receiverName, byRefCopy: false }],
      body: innerFallible ? fallibleBody : body,
    }],
  };
  if (!innerFallible) {
    return mapped;
  }
  const transposed: RustExpr = {
    kind: "try",
    resultErrorType: activeErrorType!,
    operandErrorType: activeErrorType!,
    expr: { kind: "method-call", receiver: mapped, method: "transpose", args: [] },
  };
  return fact.lowering === "and-then"
    ? { kind: "method-call", receiver: transposed, method: "flatten", args: [] }
    : transposed;
}

interface RustOptionalStructuralMethodGuard {
  readonly receiverNode: Node;
  readonly receiverCarrier: TargetTypeRef;
  readonly storageIndex: number;
}

function exactOptionalStructuralMethodGuard(
  node: Node,
  fact: RustOptionalChainFact,
  context: RustPlanContext,
): RustOptionalStructuralMethodGuard | undefined {
  const operation = rustOperationFact(node, context);
  if (operation?.kind !== "source-call" || operation.target.form !== "structural-method") {
    return undefined;
  }
  const callee = context.input.program.source.ast.kindName(node) === KindCallExpression
    ? Node_Expression(context.input.program.source.ast, node)
    : undefined;
  const receiverNode = callee !== undefined &&
      context.input.program.source.ast.kindName(callee) === KindPropertyAccessExpression
    ? Node_Expression(context.input.program.source.ast, callee)
    : undefined;
  const field = context.input.program.structuralShapes.field(
    operation.target.receiverCarrier,
    operation.target.storageIndex,
  );
  if (callee !== fact.guard || field?.method !== true || field.presence !== "optional") {
    return undefined;
  }
  const storageCarrier = rustStructuralMethodStorageCarrier(
    operation.target.receiverCarrier,
    field.carrier,
    field.presence,
  );
  const selectedStorageCarrier = rustOptionElementCarrier(storageCarrier);
  if (receiverNode === undefined || storageCarrier === undefined ||
    selectedStorageCarrier === undefined ||
    !rustTargetTypeRefEquals(fact.sourceGuardCarrier, storageCarrier) ||
    !rustTargetTypeRefEquals(fact.selectedGuardCarrier, selectedStorageCarrier)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.optional-structural-method-guard",
      "Optional structural-method lowering conflicts with its exact receiver-bound callable storage contract.",
    ));
    return undefined;
  }
  return {
    receiverNode,
    receiverCarrier: operation.target.receiverCarrier,
    storageIndex: operation.target.storageIndex,
  };
}

function planOptionalStructuralMethodStorageGuard(
  guard: RustOptionalStructuralMethodGuard,
  context: RustPlanContext,
): RustExpr | undefined {
  const receiver = planExpression(guard.receiverNode, context);
  return receiver === undefined
    ? undefined
    : readRustStructuralObjectMethodStorage(
        guard.receiverCarrier,
        planRustNonConsumingValue(guard.receiverNode, receiver, context),
        guard.storageIndex,
        context,
      );
}
