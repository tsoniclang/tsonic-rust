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
import {
  diagnosticInput,
  registerAliasFromPath,
  rustCurrentErrorBoundary,
} from "../program/plan-context.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { planBlockLike } from "./core.js";
import { planExpression, providerSelectedCallMatches } from "../expressions/index.js";
import { rustTargetOperationFactKey } from "../../../analysis/facts/keys.js";
import type { Node } from "@tsonic/tsts";
import type { RustCompletionBoundary, RustPlanContext } from "../program/plan-context.js";
import type { RustExpr, RustStmt } from "../../target-ast/nodes.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { resolveRustProgramErrorRoute } from "../program/source-package-errors.js";

export function planThrowStatement(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const fact = context.input.program.facts.getFact(node, rustTargetOperationFactKey);
  if (fact === undefined || fact.kind !== "throw-op") {
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
  const expression = Node_Expression(context.input.program.source.ast, node);
  if (expression === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.throw-shape",
      "Finalized throw fact has no exact source expression.",
    ));
    return undefined;
  }
  if (fact.error.kind === "runtime") {
    const constructor = context.input.program.facts.getFact(expression, rustTargetOperationFactKey);
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
  registerAliasFromPath(context, activeBoundary.errorTypePath);
  let error: RustExpr;
  if (fact.error.kind === "program") {
    if (activeBoundary.componentId !== context.sourcePackageComponentId) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, expression),
        "rust.error.cross-package-rethrow",
        "A source-package program error cannot be rethrown through an unrelated callable error ABI.",
      ));
      return undefined;
    }
    error = value;
  } else if (fact.error.kind === "runtime") {
    error = {
        kind: "call",
        path: `${activeBoundary.errorTypePath}::from`,
        args: [value],
      };
  } else {
    const definition = context.input.program.projectTypes.definitionForCarrier(fact.error.carrier);
    const route = definition === undefined ||
      context.input.program.projectTypes.programErrorVariant(definition) !== fact.error.variant ||
      !rustTargetTypeRefEquals(
        context.input.program.projectTypes.openCarrier(definition),
        fact.error.carrier,
      )
      ? undefined
      : resolveRustProgramErrorRoute(
          context.sourcePackageErrors,
          activeBoundary.componentId,
          definition,
          fact.error.variant,
        );
    if (route === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, expression),
        "rust.backend.throw-project-error-route",
        "Project error throw has no exact route through the current source-package error domain.",
      ));
      return undefined;
    }
    error = route.kind === "local"
      ? {
          kind: "call",
          path: `${activeBoundary.errorTypePath}::${route.variant}`,
          args: [value],
        }
      : {
          kind: "call",
          path: `${activeBoundary.errorTypePath}::${route.consumerVariant}`,
          args: [{
            kind: "call",
            path: `${route.ownerTypePath}::${route.ownerVariant}`,
            args: [value],
          }],
        };
  }
  return [{ kind: "throw", error }];
}

export function planTryStatement(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const { ast } = context.input.program.source;
  const tryBlock = TryStatement_TryBlock(context.input.program.source.ast, node);
  const catchClause = TryStatement_CatchClause(context.input.program.source.ast, node);
  const catchBlock = CatchClause_Block(context.input.program.source.ast, catchClause);
  const finallyBlock = TryStatement_FinallyBlock(context.input.program.source.ast, node);
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

  const outwardFallible = context.fallibleBoundary !== undefined;
  const bodyFallible = catchBlock !== undefined || outwardFallible;
  const bodyErrorBoundary = catchBlock === undefined
    ? context.fallibleBoundary
    : rustCurrentErrorBoundary(context);
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
    ...(bodyErrorBoundary === undefined ? {} : { fallibleBoundary: bodyErrorBoundary }),
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
