import {
  CatchClause_Block,
  CatchClause_VariableDeclaration,
  TryStatement_CatchClause,
  TryStatement_FinallyBlock,
  TryStatement_TryBlock,
  KindIdentifier,
  Node_Expression,
  Node_Name,
} from "@tsonic/target-api/source";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { collectRustCompletionDispatch, createRustCompletionBoundary, rustBlockDefinitelyExits, tailCompletionExits } from "./resources.js";
import { diagnosticInput } from "../program/plan-context.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { planBlockLike } from "./core.js";
import { planExpression, providerSelectedCallMatches } from "../expressions/index.js";
import { rustTargetOperationFactKey } from "../../../analysis/facts/keys.js";
import type { Node } from "@tsonic/tsts";
import type { RustCompletionBoundary, RustPlanContext } from "../program/plan-context.js";
import type { RustExpr, RustStmt } from "../../rust-ast/nodes.js";

export function planThrowStatement(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const fact = context.input.facts.getFact(node, rustTargetOperationFactKey);
  if (fact === undefined || fact.kind !== "throw-op") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.error.throw",
      "throw requires one finalized runtime, project-error, or exact rethrow fact.",
    ));
    return undefined;
  }
  if (context.fallibleContext !== true) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.error.throw",
      "throw requires a fallible lowering context.",
    ));
    return undefined;
  }
  const expression = Node_Expression(context.input.ast, node);
  if (expression === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.throw-shape",
      "Finalized throw fact has no exact source expression.",
    ));
    return undefined;
  }
  if (fact.error.kind === "runtime") {
    const constructor = context.input.facts.getFact(expression, rustTargetOperationFactKey);
    if (constructor === undefined || constructor.kind !== "provider-operation" ||
      constructor.operationId !== fact.error.constructorOperationId ||
      constructor.abi.operationKind !== "constructor" ||
      !providerSelectedCallMatches(expression, constructor, context)) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, expression),
        "rust.backend.throw-constructor",
        "Finalized runtime throw fact conflicts with the selected provider Error constructor ABI.",
      ));
      return undefined;
    }
  }
  const value = planExpression(expression, context);
  if (value === undefined) {
    return undefined;
  }
  context.usedAliases?.add("rt");
  const error: RustExpr = fact.error.kind === "program"
    ? value
    : {
        kind: "call",
        path: "rt::TsonicError::from",
        args: [value],
      };
  return [{ kind: "throw", error }];
}

export function planTryStatement(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const { ast } = context.input;
  const tryBlock = TryStatement_TryBlock(context.input.ast, node);
  const catchClause = TryStatement_CatchClause(context.input.ast, node);
  const catchBlock = CatchClause_Block(context.input.ast, catchClause);
  const finallyBlock = TryStatement_FinallyBlock(context.input.ast, node);
  if (tryBlock === undefined || (catchBlock === undefined && finallyBlock === undefined)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.error.try",
      "try statements require a finalized body and either catch or finally clause.",
    ));
    return undefined;
  }
  if (context.syntheticNames === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.try-names",
      "Try statement lowering requires a finalized hygienic-name scope.",
    ));
    return undefined;
  }

  const outwardFallible = context.fallibleContext === true;
  const bodyFallible = catchBlock !== undefined || outwardFallible;
  const bodyBoundary = createRustCompletionBoundary(context, bodyFallible);
  const body = planBlockLike(tryBlock, {
    ...context,
    completionBoundary: bodyBoundary,
    ...(bodyFallible ? { fallibleContext: true } : {}),
  });
  if (body === undefined) {
    return undefined;
  }

  let plannedCatch: Extract<RustStmt, { readonly kind: "try-scope" }>["catchClause"];
  let catchBoundary: RustCompletionBoundary | undefined;
  if (catchBlock !== undefined) {
    catchBoundary = createRustCompletionBoundary(context, outwardFallible);
    const catchBody = planBlockLike(catchBlock, {
      ...context,
      completionBoundary: catchBoundary,
      ...(outwardFallible ? { fallibleContext: true } : {}),
    });
    if (catchBody === undefined) {
      return undefined;
    }
    const catchDeclaration = CatchClause_VariableDeclaration(context.input.ast, catchClause);
    const bindingNode = Node_Name(context.input.ast, catchDeclaration);
    const bindingSource = bindingNode === undefined ? "" : ast.text(bindingNode);
    let binding = bindingSource.length === 0
      ? "_"
      : context.input.names.nameForDeclaration(catchDeclaration) ?? "";
    if (binding !== "_") {
      let used = false;
      const findUse = (candidate: Node): void => {
        if (used) {
          return;
        }
        if (ast.kindName(candidate) === KindIdentifier && ast.text(candidate) === bindingSource) {
          used = true;
          return;
        }
        ast.forEachChild(candidate, (child) => {
          if (child !== undefined) {
            findUse(child);
          }
        });
      };
      findUse(catchBlock);
      if (!used) {
        binding = `_${binding}`;
      }
    }
    const terminates = rustBlockDefinitelyExits(catchBody);
    plannedCatch = {
      binding,
      body: terminates ? tailCompletionExits(catchBody) : catchBody,
      fallible: outwardFallible,
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
      ...(outwardFallible ? { fallibleContext: true } : {}),
    });
    if (finallyBody === undefined) {
      return undefined;
    }
    const terminates = rustBlockDefinitelyExits(finallyBody);
    plannedFinally = {
      body: terminates ? tailCompletionExits(finallyBody) : finallyBody,
      fallible: outwardFallible,
      terminates,
    };
  }

  const bodyTerminates = rustBlockDefinitelyExits(body);
  const terminates = plannedFinally?.terminates === true ||
    (plannedCatch === undefined
      ? bodyTerminates
      : bodyTerminates && plannedCatch.terminates);
  const boundaries = [bodyBoundary, catchBoundary, finallyBoundary]
    .filter((boundary): boundary is RustCompletionBoundary => boundary !== undefined);
  const dispatch = collectRustCompletionDispatch(boundaries);
  context.usedAliases?.add("rt");
  return [{
    kind: "try-scope",
    bodyName: allocateRustSyntheticName(context.syntheticNames, "try_body"),
    flowName: allocateRustSyntheticName(context.syntheticNames, "try_flow"),
    ...(plannedFinally === undefined
      ? {}
      : { finallyName: allocateRustSyntheticName(context.syntheticNames, "finally_flow") }),
    returnType: bodyBoundary.returnType,
    fallible: outwardFallible,
    asynchronous: bodyBoundary.asynchronous,
    body: bodyTerminates ? tailCompletionExits(body) : body,
    bodyFallible,
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
  }];
}
