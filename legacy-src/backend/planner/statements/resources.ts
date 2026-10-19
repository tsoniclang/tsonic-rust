import { allocateRustSyntheticName } from "../names/synthetic.js";
import { applyRustErrorBoundary, applyRustLocalErrorBoundary } from "../types/error-boundary.js";
import {
  KindVariableDeclaration,
  KindVariableDeclarationList,
  KindVariableStatement,
  VariableDeclarationList_Declarations,
  VariableStatement_DeclarationList,
} from "@tsonic/target-api/source";
import {
  isValidRustIdentifier,
  diagnosticInput,
  rustActiveErrorType,
} from "../program/plan-context.js";
import { failRustPlannerInvariant, missingFactDiagnostic } from "../diagnostics.js";
import { planVariableStatement } from "./variable-declarations.js";

import type { Node } from "@tsonic/tsts";
import type { RustBlock, RustExpr, RustStmt } from "../../target-ast/syntax/nodes.js";
import type { RustCompletionBoundary, RustControlTarget, RustPlanContext } from "../program/plan-context.js";
import type { RustResourceManagementFact } from "../../../target-model/records/callables-and-resources.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { planRustVirtualProjectMethodCall } from "../objects/project-method-dispatch.js";
import { rustBlockDefinitelyExits } from "../../target-ast/normalization/block-flow.js";
import { isDenseDataArray } from "../../../target-model/metadata/closed-data.js";
import { isRustFinalizedDispatchContextInput, isRustFinalizedSourceInput } from "../../../analysis/operations/finalized-operation/conversions.js";
import { finishProviderOperationExpression, planFinalizedTargetInput } from "../expressions/conversions.js";
import { planRustFinalizedOperationForm } from "../expressions/finalized-operation-form.js";
import { applyFinalizedValueConversion } from "../expressions/value-conversions.js";
import { applyFinalizedRustArgumentMode } from "../expressions/input-shaping.js";
import { planRustDispatchContextInputScope } from "../project/dispatch-contexts.js";

export function directResourceDeclarations(
  statement: Node,
  context: RustPlanContext,
): readonly Node[] {
  if (context.input.program.source.ast.kindName(statement) !== KindVariableStatement) {
    return [];
  }
  const declarations = collectVariableDeclarations(statement, context);
  const kind = context.input.program.source.ast.variableDeclarationKind(declarations[0]);
  return kind === "using" || kind === "await using" ? declarations : [];
}

export function collectVariableDeclarations(node: Node, context: RustPlanContext): readonly Node[] {
  const { ast } = context.input.program.source;
  if (ast.kindName(node) === KindVariableDeclaration) return [node];
  const list = ast.kindName(node) === KindVariableStatement ? VariableStatement_DeclarationList(ast, node) : node;
  if (ast.kindName(list) !== KindVariableDeclarationList) return [];
  const declarations = VariableDeclarationList_Declarations(ast, list);
  return declarations === undefined || !isDenseDataArray(declarations) || declarations.some(declaration =>
    declaration === undefined || ast.kindName(declaration) !== KindVariableDeclaration)
    ? [] : declarations as readonly Node[];
}

export function planResourceDeclarations(
  declarations: readonly Node[],
  context: RustPlanContext,
  planBody: (context: RustPlanContext) => RustBlock | undefined,
): readonly RustStmt[] | undefined {
  const [declaration, ...remaining] = declarations;
  if (declaration === undefined) return planBody(context)?.statements;
  const fact = resourceFactForPlanning(declaration, context);
  if (fact === undefined) {
    return undefined;
  }
  const initialization = planVariableStatement(declaration, context);
  const resourceName = context.input.program.names.nameForDeclaration(declaration);
  if (resourceName === undefined) failRustPlannerInvariant("Admitted resource binding requires its sealed native name.", declaration);
  if (initialization === undefined) return undefined;
  const scope = planResourceManagedBody(
    declaration,
    resourceName,
    fact,
    context,
    (bodyContext) => {
      const statements = planResourceDeclarations(remaining, bodyContext, planBody);
      return statements === undefined ? undefined : { statements };
    },
  );
  return scope === undefined ? undefined : [...initialization, scope];
}

export function resourceFactForPlanning(
  declaration: Node,
  context: RustPlanContext,
): RustResourceManagementFact | undefined {
  const fact = context.input.program.records.resourceManagement.get(declaration);
  if (fact === undefined) {
    failRustPlannerInvariant(
      "Resource declaration has no finalized exact Rust disposal fact.",
      declaration,
    );
  }
  if ((fact.declarationKind === "await using" || fact.disposal.kind === "async") &&
    context.asyncContext !== true) {
    failRustPlannerInvariant("Admitted asynchronous disposal requires its native execution frame.", declaration);
  }
  if (fact.disposal.fallible && context.fallibleBoundary === undefined) {
    failRustPlannerInvariant("Admitted fallible disposal requires its native error frame.", declaration);
  }
  return fact;
}

export function planResourceManagedBody(
  declaration: Node,
  resourceName: string,
  fact: RustResourceManagementFact,
  context: RustPlanContext,
  planBody: (context: RustPlanContext) => RustBlock | undefined,
): Extract<RustStmt, { readonly kind: "resource-scope" }> | undefined {
  if (context.syntheticNames === undefined) {
    failRustPlannerInvariant(
      "Resource management requires a finalized hygienic-name scope.",
      declaration,
    );
  }
  if (!isValidRustIdentifier(resourceName)) {
    failRustPlannerInvariant("Admitted resource management requires its native binding name.", declaration);
  }
  const boundary = createRustCompletionBoundary(
    context,
    context.fallibleBoundary !== undefined,
  );
  const body = planBody({ ...context, completionBoundary: boundary });
  const cleanupResourceName = allocateRustSyntheticName(
    context.syntheticNames,
    "resource",
  );
  const cleanup = planResourceCleanup(
    declaration,
    resourceName,
    cleanupResourceName,
    fact,
    context,
  );
  if (body === undefined || cleanup === undefined) {
    return undefined;
  }
  const terminates = rustBlockDefinitelyExits(body);
  const finalizedBody = terminates ? tailCompletionExits(body) : body;
  context.usedAliases?.add("rt");
  return {
    kind: "resource-scope",
    flowName: allocateRustSyntheticName(context.syntheticNames, "resource_flow"),
    cleanupName: allocateRustSyntheticName(context.syntheticNames, "resource_cleanup"),
    returnType: boundary.returnType,
    errorType: rustActiveErrorType(context),
    asynchronous: boundary.asynchronous,
    body: finalizedBody,
    cleanup,
    propagate: boundary.parent !== undefined,
    dispatchReturn: boundary.dispatchReturn.value,
    dispatchTargets: [...boundary.dispatchTargets.values()]
      .sort((left, right) => left.id - right.id)
      .map((target) => ({
        kind: target.kind,
        id: target.id,
        label: target.label,
        ...(target.kind === "loop" ? { continuePrelude: target.continuePrelude } : {}),
      })),
    terminates,
  };
}

export function createRustCompletionBoundary(
  context: RustPlanContext,
  fallible: boolean,
): RustCompletionBoundary {
  return {
    ...(context.completionBoundary === undefined
      ? {}
      : { parent: context.completionBoundary }),
    returnType: context.functionReturnType ?? { kind: "unit" },
    fallible,
    asynchronous: context.asyncContext === true || context.generator !== undefined,
    dispatchReturn: { value: false },
    dispatchTargets: new Map(),
  };
}

export function collectRustCompletionDispatch(
  boundaries: readonly RustCompletionBoundary[],
): {
  readonly dispatchReturn: boolean;
  readonly dispatchTargets: readonly RustControlTarget[];
} {
  const targets = new Map<number, RustControlTarget>();
  let dispatchReturn = false;
  for (const boundary of boundaries) {
    dispatchReturn ||= boundary.dispatchReturn.value;
    for (const [id, target] of boundary.dispatchTargets) {
      targets.set(id, target);
    }
  }
  return {
    dispatchReturn,
    dispatchTargets: [...targets.values()].sort((left, right) => left.id - right.id),
  };
}

function planResourceCleanup(
  declaration: Node,
  resourceName: string,
  cleanupResourceName: string,
  fact: RustResourceManagementFact,
  context: RustPlanContext,
): RustBlock | undefined {
  const receiverMode = resourceDisposalReceiverMode(fact);
  const receiver: RustExpr = {
    kind: "path",
    path: fact.nullable ? cleanupResourceName : resourceName,
  };
  let disposal = planResourceDisposalExpression(
    declaration,
    receiver,
    fact,
    fact.nullable,
    context,
  );
  if (disposal === undefined) {
    return undefined;
  }
  const target = fact.disposal.target;
  if (target.form === "source-method" && fact.disposal.kind === "async") {
    disposal = { kind: "await", expr: disposal };
  }
  if (target.form === "source-method" && target.errorBoundary !== "none") {
    const resultErrorType = rustActiveErrorType(context);
    if (resultErrorType === undefined) failRustPlannerInvariant("Admitted fallible disposal requires its native result error type.", declaration);
    disposal = applyRustErrorBoundary(
      disposal,
      target.errorBoundary,
      resultErrorType,
      undefined,
    );
  }
  const body: RustBlock = { statements: [{ kind: "expr", expr: disposal }] };
  if (!fact.nullable) {
    return body;
  }
  return {
    statements: [{ kind: "expr", expr: { kind: "if-let", pattern: { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name: cleanupResourceName }] }, expression: receiverMode === "value" ? {
        kind: "path", path: resourceName,
      } : {
        kind: "method-call",
        receiver: { kind: "path", path: resourceName },
        method: receiverMode === "mut-ref" ? "as_mut" : "as_ref",
        args: [],
        receiverMode,
      }, whenTrue: { kind: "block", body: body } } }],
  };
}

export function resourceDisposalReceiverMode(
  fact: RustResourceManagementFact,
): "value" | "ref" | "mut-ref" {
  const target = fact.disposal.target;
  switch (target.form) {
    case "source-method":
    case "provider":
      if (target.form === "provider") {
        switch (target.abi.target.form) {
          case "method":
          case "receiver-method":
          case "free-call": break;
          default: return failRustPlannerInvariant("Finalized resource disposal target has no closed Rust receiver mode.");
        }
      }
      switch (target.receiverMode) {
        case "value": return "value";
        case "ref": return "ref";
        case "mut-ref": return "mut-ref";
        default: return failRustPlannerInvariant("Finalized resource disposal target has no closed Rust receiver mode.");
      }
    default: return failRustPlannerInvariant("Finalized resource disposal target has no closed Rust receiver mode.");
  }
}

function planResourceDisposalExpression(
  subject: Node,
  receiver: RustExpr,
  fact: RustResourceManagementFact,
  alreadyBorrowed: boolean,
  context: RustPlanContext,
): RustExpr | undefined {
  const target = fact.disposal.target;
  if (target.form === "source-method") {
    if (target.dispatch !== undefined) {
      return planRustVirtualProjectMethodCall(
        subject,
        receiver,
        target.dispatch.ownerCarrier,
        target.dispatch.virtualSlot,
        [],
        context,
      );
    }
    return {
      kind: "method-call",
      receiver,
      method: target.name,
      args: [],
      receiverMode: target.receiverMode,
    };
  }
  const { abi } = target;
  const dispatch = planRustDispatchContextInputScope(abi.targetArguments.filter(isRustFinalizedDispatchContextInput), subject, context);
  if (dispatch === undefined) return undefined;
  const planReceiver = (input: import("../../../target-model/records/finalized-operation.js").RustFinalizedSourceInput,
    position: "receiver" | "argument"): RustExpr | undefined => {
    if (input.source.kind !== "receiver") failRustPlannerInvariant("A zero-argument disposer requires its admitted resource input.", subject);
    const borrowed = alreadyBorrowed && target.receiverMode !== "value";
    const converted = applyFinalizedValueConversion(context, receiver, input.conversion, subject, borrowed);
    if (converted === undefined || position === "receiver") return converted;
    if (borrowed && input.conversion.kind === "identity" && input.mode !== "value") return converted;
    return applyFinalizedRustArgumentMode(context, subject, converted, input, false);
  };
  const targetReceiver = abi.targetReceiver.kind === "input" ? planReceiver(abi.targetReceiver.input, "receiver") : undefined;
  if (abi.targetReceiver.kind === "input" && targetReceiver === undefined) return undefined;
  const args: RustExpr[] = [];
  for (const input of abi.targetArguments) {
    const planned = isRustFinalizedSourceInput(input) ? planReceiver(input, "argument")
      : planFinalizedTargetInput(context, input, undefined, [], subject, undefined, dispatch);
    if (planned === undefined) return undefined;
    args.push(planned);
  }
  const native = planRustFinalizedOperationForm(context, abi, targetReceiver, args, subject,
    { resultUse: "value", assignment: false });
  if (native === undefined) return undefined;
  let completed = finishProviderOperationExpression(context, target, native, subject);
  if (completed === undefined) return undefined;
  if (abi.result.kind === "async") {
    completed = { kind: "await", expr: completed };
    if (abi.effects.awaiting === "fallible") {
      const region = context.fallibleBoundary;
      if (region === undefined || abi.effects.errorBoundary === "none") {
        failRustPlannerInvariant("Admitted asynchronous disposal requires its exact native error boundary.", subject);
      }
      const providerErrorType = abi.effects.errorBoundary === "provider-native"
        ? rustTypeFromCarrierInContext(abi.effects.errorCarrier, context) : undefined;
      if (abi.effects.errorBoundary === "provider-native" && providerErrorType === undefined) {
        context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, subject), "rust.backend.resource-error-type",
          "Fallible resource disposal requires its exact rendered native provider error type."));
        return undefined;
      }
      completed = applyRustLocalErrorBoundary(completed, abi.effects.errorBoundary, region, providerErrorType);
      if (completed === undefined) return undefined;
    }
    completed = applyFinalizedValueConversion(context, completed, abi.result.awaitedConversion, subject);
    if (completed === undefined) return undefined;
  }
  return dispatch.apply(completed);
}

export function planLoopExitStatement(
  node: Node,
  completion: "break" | "continue",
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const exit = context.input.program.records.controlExit.get(node);
  if (exit === undefined || exit.completion !== completion) {
    failRustPlannerInvariant("Control transfer requires its exact admitted source destination.", node);
  }
  const target = [...(context.controlTargets ?? [])].reverse().find((candidate) =>
    (completion !== "continue" || candidate.kind === "loop") && candidate.sourceTargets.includes(exit.target));
  if (target === undefined) {
    failRustPlannerInvariant("Admitted control transfer requires its active native destination.", node);
  }
  target.used.value = true;
  if (completion === "break" && target.kind === "loop") {
    target.breakUsed.value = true;
  }
  if (context.completionBoundary === target.resourceBoundary) {
    return completion === "continue"
      ? [...(target.kind === "loop" ? target.continuePrelude : []), { kind: "continue", label: target.label }]
      : [{ kind: "break", label: target.label }];
  }
  let boundary = context.completionBoundary;
  while (boundary !== undefined && boundary !== target.resourceBoundary) {
    if (boundary.parent === target.resourceBoundary) {
      boundary.dispatchTargets.set(target.id, target);
    }
    boundary = boundary.parent;
  }
  if (boundary !== target.resourceBoundary || context.completionBoundary === undefined) {
    failRustPlannerInvariant("Control transfer must preserve the native cleanup-boundary ancestry.", node);
  }
  context.usedAliases?.add("rt");
  return [{
    kind: "completion-exit",
    completion,
    resultWrapped: context.completionBoundary.fallible,
    loopId: target.id,
  }];
}

export function tailCompletionExits(block: RustBlock): RustBlock {
  const lastIndex = block.statements.length - 1;
  if (lastIndex < 0) {
    return block;
  }
  const last = block.statements[lastIndex]!;
  let replacement = last;
  if (last.kind === "completion-exit") {
    replacement = { ...last, tail: true };
  } else if (last.kind === "throw") {
    replacement = { ...last, tail: true };
  } else if (last.kind === "try-scope" || last.kind === "resource-scope") {
    replacement = { ...last, tail: true };
  } else if (last.kind === "scope" || last.kind === "unsafe-scope") {
    replacement = { ...last, body: tailCompletionExits(last.body) };
  } else if (last.kind === "if" && last.else !== undefined) {
    replacement = {
      ...last,
      then: tailCompletionExits(last.then),
      else: tailCompletionExits(last.else),
    };
  }
  return replacement === last
    ? block
    : { statements: [...block.statements.slice(0, lastIndex), replacement] };
}
