import {
  CatchClause_Block,
  TryStatement_CatchClause,
  TryStatement_FinallyBlock,
  TryStatement_TryBlock,
  Node_Expression,
} from "@tsonic/target-api/source";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { collectRustCompletionDispatch, createRustCompletionBoundary, tailCompletionExits, rustCompletionDispatchResultWrapped } from "./resource-management.js";
import { registerAliasFromPath, rustActiveErrorType } from "../program/plan-context.js";
import { rustLocalErrorOwner, rustInjectLocalError } from "../program/fallible-boundaries.js";
import { planRustErrorRegion } from "../program/error-regions.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { planBlockLike } from "./planning.js";
import { planExpression } from "../expressions/index.js";

import type { Node } from "@tsonic/tsts";
import type { RustCompletionBoundary, RustPlanContext } from "../program/plan-context.js";
import type { RustExpr, RustStmt } from "../../target-ast/syntax/nodes.js";
import { planRustProgramErrorConstruction } from "../expressions/program-errors.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";

export function planThrowStatement(node: Node, context: RustPlanContext): readonly RustStmt[] {
  const completion = context.input.program.records.throwCompletion.get(node);
  if (completion === undefined) failRustPlannerInvariant("An admitted throw requires its sealed native error-channel completion.", node);
  const fact = completion.operation;
  const activeBoundary = context.fallibleBoundary;
  if (activeBoundary === undefined) {
    failRustPlannerInvariant("An admitted throw requires its native fallible rendering frame.", node);
  }
  const localOwner = rustLocalErrorOwner(activeBoundary);
  if (localOwner === undefined) {
    failRustPlannerInvariant("An admitted throw requires its exact native source-package error channel.", node);
  }
  const expression = Node_Expression(context.input.program.source.ast, node);
  if (expression === undefined) {
    failRustPlannerInvariant(
      "Finalized throw fact has no exact source expression.",
      node,
    );
  }
  const value = planExpression(expression, context);
  if (value === undefined) {
    failRustPlannerInvariant("An admitted throw requires its native operand value plan.", expression);
  }
  context.usedAliases?.add("rt");
  registerAliasFromPath(context, localOwner.errorTypePath);
  let error: RustExpr;
  if (fact.error.kind === "program") {
    error = value;
  } else {
    const constructed = planRustProgramErrorConstruction(fact.error.conversion, value, expression, context, localOwner);
    if (constructed === undefined) failRustPlannerInvariant("An admitted throw requires its native error construction plan.", expression);
    error = constructed;
  }
  const injected = rustInjectLocalError(activeBoundary, error);
  if (injected === undefined) {
    failRustPlannerInvariant("An admitted throw requires its selected native error-channel injection.", node);
  }
  return [{ kind: "throw", error: injected }];
}

export function planTryStatement(node: Node, context: RustPlanContext): readonly RustStmt[] {
  const tryBlock = TryStatement_TryBlock(context.input.program.source.ast, node);
  const catchClause = TryStatement_CatchClause(context.input.program.source.ast, node);
  const catchBlock = CatchClause_Block(context.input.program.source.ast, catchClause);
  const finallyBlock = TryStatement_FinallyBlock(context.input.program.source.ast, node);
  if (tryBlock === undefined || (catchBlock === undefined && finallyBlock === undefined)) {
    failRustPlannerInvariant(
      "try statements require a finalized body and either catch or finally clause.",
      node,
    );
  }
  if (context.syntheticNames === undefined) {
    failRustPlannerInvariant(
      "Try statement lowering requires a finalized hygienic-name scope.",
      node,
    );
  }

  const outwardFallible = context.fallibleBoundary !== undefined;
  const completionBindings = context.input.program.records.completionBindings.get(node) ?? [];
  const normalBindings = completionBindings.map((selected): Extract<RustStmt, { readonly kind: "let" }> => {
    const binding = context.input.program.records.localBinding.get(selected.declaration);
    if (binding?.kind !== "value") failRustPlannerInvariant("An admitted completion binding requires its exact native local storage.", selected.declaration);
    const type = rustTypeFromCarrierInContext(binding.nativeCarrier, context)
      ?? failRustPlannerInvariant("An admitted completion binding requires its native type.", selected.declaration);
    return { kind: "let", name: binding.name, mutable: binding.mutable, type };
  });
  const errorType = rustActiveErrorType(context);
  const protectedRegion = catchBlock === undefined ? undefined : planRustErrorRegion(tryBlock, context);
  if (catchBlock !== undefined && protectedRegion === undefined)
    failRustPlannerInvariant("An admitted protected try body requires its exact sealed native error region.", tryBlock);
  const bodyErrorBoundary = catchBlock === undefined ? context.fallibleBoundary : protectedRegion?.boundary;
  const bodyFallible = bodyErrorBoundary !== undefined;
  const bodyBoundary = createRustCompletionBoundary(context, bodyFallible);
  const body = planBlockLike(tryBlock, {
    ...context,
    completionBoundary: bodyBoundary,
    fallibleBoundary: bodyErrorBoundary,
  });

  let plannedCatch: Extract<RustStmt, { readonly kind: "try-scope" }>["catchClause"];
  let catchBoundary: RustCompletionBoundary | undefined;
  if (catchBlock !== undefined && bodyErrorBoundary !== undefined) {
    catchBoundary = createRustCompletionBoundary(context, outwardFallible);
    let catchBody = planBlockLike(catchBlock, {
      ...context,
      completionBoundary: catchBoundary,
      ...(context.fallibleBoundary === undefined
        ? {}
        : { fallibleBoundary: context.fallibleBoundary }),
    });
    const binding = context.input.program.records.catchBinding.get(catchClause);
    if (binding === undefined) failRustPlannerInvariant("An admitted catch requires its exact native binding plan.", catchClause);
    if (binding.conversionTarget !== undefined) {
      const type = rustTypeFromCarrierInContext(binding.conversionTarget, context)
        ?? failRustPlannerInvariant("An admitted caught conversion requires its native destination.", catchClause);
      catchBody = { ...catchBody, statements: [{ kind: "let", name: binding.name, mutable: false, type,
        init: { kind: "method-call", receiver: { kind: "path", path: binding.name }, method: "into", args: [] } },
        ...catchBody.statements] };
    }
    const terminates = statementExits(catchBlock, context);
    plannedCatch = {
      bindings: normalBindings.filter((_binding, index) => completionBindings[index]!.catch === "entry"),
      binding: binding.name,
      bindingUsed: binding.used,
      body: terminates ? tailCompletionExits(catchBody) : catchBody,
      errorType,
      terminates,
    };
  }

  let plannedFinally: Extract<RustStmt, { readonly kind: "try-scope" }>["finallyClause"];
  let finallyBoundary: RustCompletionBoundary | undefined;
  if (finallyBlock !== undefined) {
    finallyBoundary = createRustCompletionBoundary(context, outwardFallible);
    const finallyBody = planBlockLike(finallyBlock, {
      ...context,
      completionBoundary: finallyBoundary,
      ...(context.fallibleBoundary === undefined
        ? {}
        : { fallibleBoundary: context.fallibleBoundary }),
    });
    const terminates = statementExits(finallyBlock, context);
    plannedFinally = {
      body: terminates ? tailCompletionExits(finallyBody) : finallyBody,
      errorType,
      terminates,
    };
  }

  const bodyTerminates = statementExits(tryBlock, context);
  const terminates = statementExits(node, context);
  const boundaries = [bodyBoundary, catchBoundary, finallyBoundary]
    .filter((boundary): boundary is RustCompletionBoundary => boundary !== undefined);
  const dispatch = collectRustCompletionDispatch(boundaries);
  context.usedAliases?.add("rt");
  const flowName = allocateRustSyntheticName(context.syntheticNames, "try_flow");
  const scope: Extract<RustStmt, { readonly kind: "try-scope" }> = {
    kind: "try-scope",
    dispatchResultWrapped: rustCompletionDispatchResultWrapped(context),
    bodyName: allocateRustSyntheticName(context.syntheticNames, "try_body"),
    flowName,
    normalBindings,
    bodyBindings: normalBindings.filter((_binding, index) => completionBindings[index]!.body === "entry"),
    ...(plannedFinally === undefined
      ? {}
      : { finallyName: allocateRustSyntheticName(context.syntheticNames, "finally_flow") }),
    returnType: bodyBoundary.returnType,
    errorType,
    asynchronous: bodyBoundary.asynchronous,
    body: bodyTerminates ? tailCompletionExits(body) : body,
    bodyErrorType: bodyErrorBoundary?.errorType,
    bodyTerminates,
    ...(plannedCatch === undefined ? {} : { catchClause: plannedCatch }),
    ...(plannedFinally === undefined ? {} : { finallyClause: plannedFinally }),
    propagate: context.completionBoundary !== undefined,
    dispatchReturn: dispatch.dispatchReturn,
    dispatchTargets: dispatch.dispatchTargets.map((target) => ({
      kind: target.kind,
      id: target.id,
      label: target.label,
      ...(target.kind === "loop" ? { continuePrelude: target.continuePrelude } : {}),
    })),
    terminates,
  };
  return [scope, ...normalBindings.map((binding, index): RustStmt => {
    const owner = context.input.program.records.completionBindingOwner.get(completionBindings[index]!.declaration);
    if (owner === undefined) failRustPlannerInvariant("An admitted completion output requires its lexical binding owner.", node);
    const value: RustExpr = { kind: "field", receiver: { kind: "path", path: flowName }, name: String(index) };
    return completionBindings[index]!.output === "declare" ? { ...binding, init: value }
      : { kind: "assign", target: { kind: "path", path: binding.name }, operator: "=", value };
  })];
}

function statementExits(node: Node, context: RustPlanContext): boolean {
  const selected = context.input.program.records.statementExit.get(node);
  if (selected === undefined) failRustPlannerInvariant("An admitted error region requires its sealed source completion.", node);
  return selected;
}
