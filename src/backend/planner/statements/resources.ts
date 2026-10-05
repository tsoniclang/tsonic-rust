import { allocateRustSyntheticName } from "../names/synthetic.js";
import { applyRustErrorBoundary } from "../types/error-boundary.js";
import {
  BreakOrContinueStatement_Label,
  KindVariableDeclaration,
  KindVariableDeclarationList,
  KindVariableStatement,
  VariableDeclarationList_Declarations,
  VariableStatement_DeclarationList,
} from "@tsonic/target-api/source";
import {
  diagnosticInput,
  isValidRustIdentifier,
  registerAliasFromPath,
  rustActiveErrorType,
} from "../program/plan-context.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { planStatementSequence } from "./core.js";
import { planVariableStatement } from "./variable-declarations.js";
import { rustResourceManagementFactKey } from "../../../analysis/facts/keys.js";
import type { Node } from "@tsonic/tsts";
import type { RustBlock, RustExpr, RustStmt } from "../../target-ast/nodes.js";
import type { RustCompletionBoundary, RustControlTarget, RustPlanContext } from "../program/plan-context.js";
import type { RustResourceManagementFact } from "../../../analysis/facts/keys.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { planRustVirtualProjectMethodCall } from "../objects/project-method-dispatch.js";
import { rustBlockDefinitelyExits } from "../../target-ast/normalization/block-flow.js";
import { isDenseDataArray } from "../../../target-model/metadata/closed-data.js";

export function directResourceDeclaration(
  statement: Node,
  context: RustPlanContext,
): Node | undefined {
  if (context.input.program.source.ast.kindName(statement) !== KindVariableStatement) {
    return undefined;
  }
  const declarations = collectVariableDeclarations(statement, context);
  if (declarations.length !== 1) {
    return undefined;
  }
  const [declaration] = declarations;
  const kind = context.input.program.source.ast.variableDeclarationKind(declaration);
  return declaration !== undefined && (kind === "using" || kind === "await using")
    ? declaration
    : undefined;
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

export function planResourceDeclarationScope(
  statement: Node,
  declaration: Node,
  remainder: readonly (Node | undefined)[],
  diagnosticNode: Node,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const fact = resourceFactForPlanning(declaration, context);
  if (fact === undefined) {
    return undefined;
  }
  const declarations = planVariableStatement(statement, context);
  const resourceName = context.input.program.names.nameForDeclaration(declaration) ?? "";
  if (declarations === undefined || !isValidRustIdentifier(resourceName)) {
    return undefined;
  }
  const scope = planResourceManagedBody(
    declaration,
    resourceName,
    fact,
    context,
    (bodyContext) => planStatementSequence(remainder, diagnosticNode, bodyContext, false),
  );
  return scope === undefined ? undefined : [...declarations, scope];
}

export function resourceFactForPlanning(
  declaration: Node,
  context: RustPlanContext,
): RustResourceManagementFact | undefined {
  const fact = context.input.program.facts.getFact(declaration, rustResourceManagementFactKey);
  if (fact === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.resource-management",
      "Resource declaration has no finalized exact Rust disposal fact.",
    ));
    return undefined;
  }
  if ((fact.declarationKind === "await using" || fact.disposal.kind === "async") &&
    context.asyncContext !== true) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.async-resource-management",
      "Asynchronous resource management requires a finalized async callable context.",
    ));
    return undefined;
  }
  if (fact.disposal.fallible && context.fallibleBoundary === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.resource-fallibility",
      "A fallible disposer requires a finalized fallible enclosing callable.",
    ));
    return undefined;
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
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.resource-names",
      "Resource management requires a finalized hygienic-name scope.",
    ));
    return undefined;
  }
  if (!isValidRustIdentifier(resourceName)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.resource-binding",
      "Resource management requires a plain finalized Rust binding name.",
    ));
    return undefined;
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
    fallible: boundary.fallible,
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
  if (receiverMode === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, context.sourceFile),
      "rust.backend.resource-disposer",
      "Finalized resource disposal target has no closed Rust receiver mode.",
    ));
    return undefined;
  }
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
  if (fact.disposal.kind === "async") {
    disposal = { kind: "await", expr: disposal };
  }
  if (fact.disposal.fallible) {
    const resultErrorType = rustActiveErrorType(context);
    const providerErrorType = fact.disposal.errorBoundary === "provider-native"
      ? rustTypeFromCarrierInContext(fact.disposal.errorCarrier, context)
      : undefined;
    if (resultErrorType === undefined ||
      fact.disposal.errorBoundary === "provider-native" && providerErrorType === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, context.sourceFile),
        "rust.backend.resource-error-type",
        "A fallible resource disposer has no exact result or provider error type.",
      ));
      return undefined;
    }
    disposal = applyRustErrorBoundary(
      disposal,
      fact.disposal.errorBoundary,
      resultErrorType,
      providerErrorType,
    );
  }
  const body: RustBlock = { statements: [{ kind: "expr", expr: disposal }] };
  if (!fact.nullable) {
    return body;
  }
  return {
    statements: [{ kind: "expr", expr: { kind: "if-let", pattern: { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name: cleanupResourceName }] }, expression: {
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
): "ref" | "mut-ref" | undefined {
  const target = fact.disposal.target;
  if (target.form === "source-method") {
    return target.receiverMode;
  }
  if (target.target.form === "free-call") {
    return target.target.receiverMode === "value"
      ? undefined
      : target.target.receiverMode;
  }
  if (target.target.form === "receiver-method") {
    return target.target.mutatesReceiver === true ? "mut-ref" : "ref";
  }
  return target.target.form === "method" ? "ref" : undefined;
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
  const operation = target.target;
  if (operation.form === "method" || operation.form === "receiver-method") {
    return {
      kind: "method-call",
      receiver,
      method: operation.name,
      args: [],
      receiverMode: operation.form === "receiver-method" && operation.mutatesReceiver === true
        ? "mut-ref"
        : "ref",
    };
  }
  if (operation.form === "free-call") {
    registerAliasFromPath(context, operation.path);
    const argument = alreadyBorrowed
      ? receiver
      : operation.receiverMode === "value"
        ? receiver
        : { kind: "reference" as const, expr: receiver, mutable: operation.receiverMode === "mut-ref" };
    return { kind: "call", path: operation.path, args: [argument] };
  }
  context.diagnostics.push(missingFactDiagnostic(
    diagnosticInput(context, context.sourceFile),
    "rust.backend.resource-disposer",
    "Finalized provider resource disposal target is not a closed Rust receiver operation.",
  ));
  return undefined;
}

export function planLoopExitStatement(
  node: Node,
  completion: "break" | "continue",
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const sourceLabelNode = BreakOrContinueStatement_Label(context.input.program.source.ast, node);
  const sourceLabel = sourceLabelNode === undefined
    ? undefined
    : context.input.program.source.ast.text(sourceLabelNode);
  const target = [...(context.controlTargets ?? [])].reverse().find((candidate) =>
    completion === "continue"
      ? candidate.kind === "loop" &&
        (sourceLabel === undefined || candidate.sourceLabel === sourceLabel)
      : sourceLabel === undefined
        ? candidate.kind !== "label"
        : candidate.sourceLabel === sourceLabel);
  if (target === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.loop-exit",
      sourceLabel === undefined
        ? `${completion} has no enclosing Rust loop target.`
        : `${completion} label '${sourceLabel}' has no finalized Rust loop target.`,
    ));
    return undefined;
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
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.loop-resource-boundary",
      "Loop exit cannot be reconciled with the finalized Rust resource boundary stack.",
    ));
    return undefined;
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
