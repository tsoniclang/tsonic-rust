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
import { collectRustCompletionDispatch, createRustCompletionBoundary, tailCompletionExits } from "./resources.js";
import { rustBlockDefinitelyExits } from "../../target-ast/normalization/block-flow.js";
import {
  diagnosticInput,
  registerAliasFromPath,
  rustCurrentErrorBoundary,
  rustActiveErrorType,
} from "../program/plan-context.js";
import { rustPackageFallibleBoundary, rustLocalErrorOwner, rustInjectLocalError } from "../program/fallible-boundaries.js";
import { failRustPlannerInvariant, missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { planBlockLike } from "./core.js";
import { planExpression } from "../expressions/index.js";
import { effectivePlannedExpressionCarrier } from "../expressions/fundamentals.js";

import type { Node } from "@tsonic/tsts";
import type { RustCompletionBoundary, RustPlanContext } from "../program/plan-context.js";
import type { RustExpr, RustStmt } from "../../target-ast/syntax/nodes.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { isRustProgramErrorCarrier } from "../../../target-model/types/index.js";
import { planRustProgramErrorConstruction } from "../expressions/program-errors.js";

export function planThrowStatement(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const fact = context.input.program.records.targetOperation.get(node);
  if (fact === undefined || fact.kind !== "throw-op" ||
    fact.error.kind !== "conversion" && fact.error.kind !== "program") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.error.throw",
      "throw requires one finalized runtime, project-error, or exact rethrow fact.",
    ));
    return undefined;
  }
  const activeBoundary = context.fallibleBoundary;
  if (activeBoundary === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.error.throw",
      "throw requires a fallible lowering context.",
    ));
    return undefined;
  }
  const localOwner = rustLocalErrorOwner(activeBoundary);
  if (localOwner === undefined) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
      "rust.error.throw-channel", "A local throw requires its exact source-package error channel."));
    return undefined;
  }
  const expression = Node_Expression(context.input.program.source.ast, node);
  if (expression === undefined) {
    failRustPlannerInvariant(
      "Finalized throw fact has no exact source expression.",
      node,
    );
  }
  const carrier = fact.error.kind === "conversion" ? fact.error.conversion.source : fact.error.carrier;
  if (fact.error.expression !== expression ||
    !rustTargetTypeRefEquals(effectivePlannedExpressionCarrier(expression, context), carrier) ||
    fact.error.kind === "program" && !isRustProgramErrorCarrier(carrier)) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, expression),
      "rust.backend.throw-carrier", "Finalized throw fact conflicts with its exact source operand or native Error carrier."));
    return undefined;
  }
  const value = planExpression(expression, context);
  if (value === undefined) {
    return undefined;
  }
  context.usedAliases?.add("rt");
  registerAliasFromPath(context, localOwner.errorTypePath);
  let error: RustExpr;
  if (fact.error.kind === "program") {
    if (localOwner.componentId !== context.sourcePackageComponentId) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, expression),
        "rust.error.cross-package-rethrow",
        "A source-package program error cannot be rethrown through an unrelated callable error ABI.",
      ));
      return undefined;
    }
    error = value;
  } else {
    const constructed = planRustProgramErrorConstruction(fact.error.conversion, value, expression, context, localOwner);
    if (constructed === undefined) return undefined;
    error = constructed;
  }
  const injected = rustInjectLocalError(activeBoundary, error);
  if (injected === undefined) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
      "rust.error.throw-channel", "A local throw conflicts with its exact source-package error channel."));
    return undefined;
  }
  return [{ kind: "throw", error: injected }];
}

export function planTryStatement(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const { ast } = context.input.program.source;
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
  const errorType = rustActiveErrorType(context);
  const bodyFallible = catchBlock !== undefined || outwardFallible;
  const catchOwner = catchBlock === undefined ? undefined : rustCurrentErrorBoundary(context);
  const bodyErrorBoundary = catchBlock === undefined ? context.fallibleBoundary
    : catchOwner === undefined ? undefined : rustPackageFallibleBoundary(catchOwner);
  if (bodyFallible && bodyErrorBoundary === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.try-error-boundary",
      "A throwing try body has no exact source-package error ABI.",
    ));
    return undefined;
  }
  const bodyBoundary = createRustCompletionBoundary(context, bodyFallible);
  const body = planBlockLike(tryBlock, {
    ...context,
    completionBoundary: bodyBoundary,
    fallibleBoundary: bodyErrorBoundary,
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
      ...(context.fallibleBoundary === undefined
        ? {}
        : { fallibleBoundary: context.fallibleBoundary }),
    });
    if (catchBody === undefined) {
      return undefined;
    }
    const catchDeclaration = CatchClause_VariableDeclaration(context.input.program.source.ast, catchClause);
    const bindingNode = Node_Name(context.input.program.source.ast, catchDeclaration);
    const bindingSource = bindingNode === undefined ? "" : ast.text(bindingNode);
    let binding = bindingSource.length === 0
      ? "_"
      : context.input.program.names.nameForDeclaration(catchDeclaration) ?? "";
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
    if (finallyBody === undefined) {
      return undefined;
    }
    const terminates = rustBlockDefinitelyExits(finallyBody);
    plannedFinally = {
      body: terminates ? tailCompletionExits(finallyBody) : finallyBody,
      errorType,
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
  }];
}
