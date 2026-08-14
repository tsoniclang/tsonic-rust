import type { Node } from "@tsonic/tsts";
import { rustTargetTypeRefEquals } from "../../policy/equality.js";
import type { TargetTypeRef } from "../../policy/types.js";
import { isRustAssignmentOperator } from "../../common/rust-syntax.js";
import type { RustAssignmentOperator, RustBinaryOperator } from "../../common/rust-syntax.js";
import {
  BinaryExpression_Left,
  BinaryExpression_OperatorToken,
  BinaryExpression_Right,
  BreakOrContinueStatement_Label,
  CatchClause_Block,
  CatchClause_VariableDeclaration,
  CaseBlock_Clauses,
  CaseOrDefaultClause_Expression,
  CaseOrDefaultClause_Statements,
  DoStatement_Statement,
  LabeledStatement_Label,
  LabeledStatement_Statement,
  ElementAccessExpression_ArgumentExpression,
  TryStatement_CatchClause,
  TryStatement_FinallyBlock,
  TryStatement_TryBlock,
  ForInOrOfStatement_Initializer,
  ForInOrOfStatement_Statement,
  IterationStatement_Statement,
  SwitchStatement_CaseBlock,
  SwitchStatement_Expression,
  KindAsteriskEqualsToken,
  KindMinusEqualsToken,
  KindPercentEqualsToken,
  KindPlusEqualsToken,
  KindSlashEqualsToken,
  ForStatement_Condition,
  ForStatement_Incrementor,
  ForStatement_Initializer,
  IfStatement_ElseStatement,
  IfStatement_ThenStatement,
  KindBinaryExpression,
  KindBlock,
  KindBreakStatement,
  KindCallExpression,
  KindCaseClause,
  KindContinueStatement,
  KindDebuggerStatement,
  KindDeleteExpression,
  KindDoStatement,
  KindEmptyStatement,
  KindEqualsToken,
  KindExpressionStatement,
  KindForStatement,
  KindForInStatement,
  KindIdentifier,
  KindArrayBindingPattern,
  KindObjectBindingPattern,
  KindIfStatement,
  KindLabeledStatement,
  KindNumericLiteral,
  KindPostfixUnaryExpression,
  KindPrefixUnaryExpression,
  KindReturnStatement,
  KindStringLiteral,
  KindSwitchStatement,
  KindVariableDeclaration,
  KindVariableStatement,
  KindVoidExpression,
  KindWhileStatement,
  Node_Expression,
  Node_Initializer,
  Node_Name,
  Node_Type,
} from "../../common/source-ast.js";
import { rustMutatedBindingFactKey, rustMutatedReferentFactKey, rustResourceManagementFactKey, rustTargetOperationFactKey } from "../../source/rust-facts/keys.js";
import type { RustResourceManagementFact, RustTargetOperationFact } from "../../source/rust-facts/keys.js";
import {
  isRustBoolCarrier,
  isRustCopyCarrier,
  isRustStringCarrier,
  isRustUnitCarrier,
  rustLocationTargetType,
  rustOptionElementCarrier,
} from "../../source/rust-target-types.js";
import { validateRustFinalizedOperationAbi } from "../../source/rust-facts/finalized-operation-abi.js";
import { rustTargetOperationIsDirectLocation } from "../../source/rust-facts/target-operation.js";
import type { RustBlock, RustExpr, RustStmt } from "../rust-ast/nodes.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "./diagnostics.js";
import {
  applyRustArgumentMode,
  expressionCarrier,
  planExpression,
  planRustOperatorCallExpression,
  planFinalizedSourceInput,
  planFinalizedTargetInput,
  finishRustSourceAccessorCall,
  planRustSourceAccessorCall,
  providerSelectedCallMatches,
  sourceAccessorSelectedOperationMatches,
  sourceFieldSelectedOperationMatches,
  sourceStaticFieldSelectedOperationMatches,
  sourceUnionFieldSelectedOperationMatches,
} from "./expressions.js";
import { diagnosticInput, isValidRustIdentifier, registerAliasFromPath, rustSourceName } from "./plan-context.js";
import type { RustCompletionBoundary, RustControlTarget, RustLoopTarget, RustPlanContext } from "./plan-context.js";
import { allocateRustSyntheticName } from "./synthetic-names.js";
import { planRustBindingPattern } from "./binding-patterns.js";
import { rustTypeFromCarrierInContext } from "./render-types.js";
import {
  planRustNonConsumingValue,
  planRustPromotedStorageLocation,
  planRustPromotedStorageWrite,
  rustLocationStorageForDeclaration,
} from "./typed-locations.js";
import { requireRustLocationValueCarrier } from "./generic-requirements.js";
import { planRustReturnExit } from "./completion-exits.js";
import {
  readRustProjectDispatchedField,
  readRustProjectObjectField,
  readRustStructuralObjectField,
  writeRustProjectDispatchedField,
  writeRustProjectObjectField,
  writeRustStructuralObjectField,
} from "./project-objects.js";
import {
  isErasedRustSafetyExpressionStatement,
  isRustExplicitUnsafeBlockMarker,
  rustSelectedAccessorRequiresUnsafe,
  withExplicitUnsafeContext,
} from "./explicit-safety.js";
import { planRustSourceUnionFieldProjection } from "./source-union-projection.js";
import { rustSourceStaticFieldLocation } from "./static-field-storage.js";

type RustAssignmentOperationFact = Extract<
  RustTargetOperationFact,
  { readonly kind: "operator-token" | "operator-call" }
>;

export function planStatement(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const diagnosticCount = context.diagnostics.length;
  const planned = planStatementInner(node, context);
  if (planned === undefined && context.diagnostics.length === diagnosticCount) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.statement-finalization",
      "Statement planning returned no Rust AST and no specific diagnostic.",
    ));
  }
  return planned;
}

function planStatementInner(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const { ast } = context.input;
  const kind = ast.kindName(node);
  switch (kind) {
    case KindVariableStatement: {
      return planVariableStatement(node, context);
    }
    case KindReturnStatement: {
      const expression = Node_Expression(context.input.ast, node);
      const planned = expression === undefined ? undefined : planExpression(expression, context);
      if (expression !== undefined && planned === undefined) {
        return undefined;
      }
      return [planRustReturnExit(planned, context)];
    }
    case KindBreakStatement:
    case KindContinueStatement: {
      return planLoopExitStatement(node, kind === KindBreakStatement ? "break" : "continue", context);
    }
    case KindEmptyStatement:
    case KindDebuggerStatement: {
      return [];
    }
    case KindLabeledStatement: {
      return planLabeledStatement(node, context);
    }
    case KindSwitchStatement: {
      return planSwitchStatement(node, context);
    }
    case KindExpressionStatement: {
      if (isErasedRustSafetyExpressionStatement(node, context.input)) {
        return [];
      }
      return planExpressionStatement(node, context);
    }
    case KindIfStatement: {
      return planIfStatement(node, context);
    }
    case KindWhileStatement: {
      return planWhileStatement(node, context);
    }
    case KindDoStatement: {
      return planDoStatement(node, context);
    }
    case KindForStatement: {
      return planForStatement(node, context);
    }
    case KindForInStatement: {
      return planForInStatement(node, context);
    }
    case "KindForOfStatement": {
      return planForOfStatement(node, context);
    }
    case "KindThrowStatement": {
      return planThrowStatement(node, context);
    }
    case "KindTryStatement": {
      return planTryStatement(node, context);
    }
    case KindBlock: {
      const body = planBlockLike(node, context);
      return body === undefined ? undefined : [{ kind: "scope", body }];
    }
    default: {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.statement",
        "The Rust target does not support this statement.",
      ));
      return undefined;
    }
  }
}

export function planBlockLike(node: Node, context: RustPlanContext): RustBlock | undefined {
  const { ast } = context.input;
  const children = ast.kindName(node) === KindBlock ? ast.statements(node) : [node];
  return planStatementSequence(children, node, context);
}

export function planStatementSequence(
  children: readonly (Node | undefined)[],
  diagnosticNode: Node,
  context: RustPlanContext,
): RustBlock | undefined {
  const statements: RustStmt[] = [];
  let failed = false;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, diagnosticNode),
        "rust.backend.block-statement",
        "Source block contains an undefined statement slot.",
      ));
      failed = true;
      continue;
    }
    if (isRustExplicitUnsafeBlockMarker(child, context.input)) {
      const body = planStatementSequence(
        children.slice(index + 1),
        diagnosticNode,
        withExplicitUnsafeContext(context),
      );
      if (body === undefined) {
        return undefined;
      }
      statements.push({ kind: "unsafe-scope", body });
      return { statements };
    }
    const resourceDeclaration = directResourceDeclaration(child, context);
    if (resourceDeclaration !== undefined) {
      const planned = planResourceDeclarationScope(
        child,
        resourceDeclaration,
        children.slice(index + 1),
        diagnosticNode,
        context,
      );
      if (planned === undefined) {
        failed = true;
      } else {
        statements.push(...planned);
      }
      return failed ? undefined : { statements };
    }
    const planned = planStatement(child, context);
    if (planned === undefined) {
      failed = true;
      continue;
    }
    statements.push(...planned);
  }
  return failed ? undefined : { statements };
}

function directResourceDeclaration(
  statement: Node,
  context: RustPlanContext,
): Node | undefined {
  if (context.input.ast.kindName(statement) !== KindVariableStatement) {
    return undefined;
  }
  const declarations = collectVariableDeclarations(statement, context);
  if (declarations.length !== 1) {
    return undefined;
  }
  const [declaration] = declarations;
  const kind = context.input.ast.variableDeclarationKind(declaration);
  return declaration !== undefined && (kind === "using" || kind === "await using")
    ? declaration
    : undefined;
}

function collectVariableDeclarations(node: Node, context: RustPlanContext): readonly Node[] {
  const { ast } = context.input;
  const declarations: Node[] = [];
  const visit = (candidate: Node): void => {
    if (ast.kindName(candidate) === KindVariableDeclaration) {
      declarations.push(candidate);
      return;
    }
    ast.forEachChild(candidate, (child) => {
      if (child !== undefined) {
        visit(child);
      }
    });
  };
  visit(node);
  return declarations;
}

function planResourceDeclarationScope(
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
  const nameNode = Node_Name(context.input.ast, declaration);
  const resourceName = nameNode === undefined
    ? ""
    : rustSourceName(context, context.input.ast.text(nameNode));
  if (declarations === undefined || !isValidRustIdentifier(resourceName)) {
    return undefined;
  }
  const scope = planResourceManagedBody(
    declaration,
    resourceName,
    fact,
    context,
    (bodyContext) => planStatementSequence(remainder, diagnosticNode, bodyContext),
  );
  return scope === undefined ? undefined : [...declarations, scope];
}

function resourceFactForPlanning(
  declaration: Node,
  context: RustPlanContext,
): RustResourceManagementFact | undefined {
  const fact = context.input.facts.getFact(declaration, rustResourceManagementFactKey);
  if (fact === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.resource-management",
      "Resource declaration has no finalized exact Rust disposal fact.",
    ));
    return undefined;
  }
  if (context.generator !== undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.generator-resource-management",
      "Rust generators cannot preserve exact resource cleanup and suppressed-error semantics across suspension.",
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
  if (fact.disposal.fallible && context.fallibleContext !== true) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.resource-fallibility",
      "A fallible disposer requires a finalized fallible enclosing callable.",
    ));
    return undefined;
  }
  return fact;
}

function planResourceManagedBody(
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
    context.fallibleContext === true,
  );
  const body = planBody({ ...context, completionBoundary: boundary });
  const cleanupResourceName = allocateRustSyntheticName(
    context.syntheticNames,
    "resource",
  );
  const cleanup = planResourceCleanup(
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

function createRustCompletionBoundary(
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

function collectRustCompletionDispatch(
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
    disposal = { kind: "try", expr: disposal };
  }
  const body: RustBlock = { statements: [{ kind: "expr", expr: disposal }] };
  if (!fact.nullable) {
    return body;
  }
  return {
    statements: [{
      kind: "if-let-some",
      binding: cleanupResourceName,
      expression: {
        kind: "method-call",
        receiver: { kind: "path", path: resourceName },
        method: receiverMode === "mut-ref" ? "as_mut" : "as_ref",
        args: [],
      },
      body,
    }],
  };
}

function resourceDisposalReceiverMode(
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
  receiver: RustExpr,
  fact: RustResourceManagementFact,
  alreadyBorrowed: boolean,
  context: RustPlanContext,
): RustExpr | undefined {
  const target = fact.disposal.target;
  if (target.form === "source-method") {
    return { kind: "method-call", receiver, method: target.name, args: [] };
  }
  const operation = target.target;
  if (operation.form === "method" || operation.form === "receiver-method") {
    return { kind: "method-call", receiver, method: operation.name, args: [] };
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

function planLoopExitStatement(
  node: Node,
  completion: "break" | "continue",
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const sourceLabelNode = BreakOrContinueStatement_Label(context.input.ast, node);
  const sourceLabel = sourceLabelNode === undefined
    ? undefined
    : context.input.ast.text(sourceLabelNode);
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

function rustBlockDefinitelyExits(block: RustBlock): boolean {
  const last = block.statements[block.statements.length - 1];
  if (last === undefined) {
    return false;
  }
  if (last.kind === "return" || last.kind === "tail" || last.kind === "throw" ||
    last.kind === "break" || last.kind === "continue" ||
    last.kind === "completion-exit") {
    return true;
  }
  if (last.kind === "expr" && last.expr.kind === "bottom") {
    return true;
  }
  if (last.kind === "scope" || last.kind === "unsafe-scope") {
    return rustBlockDefinitelyExits(last.body);
  }
  if (last.kind === "resource-scope") {
    return last.terminates;
  }
  return last.kind === "if" && last.else !== undefined &&
    rustBlockDefinitelyExits(last.then) && rustBlockDefinitelyExits(last.else);
}

function tailCompletionExits(block: RustBlock): RustBlock {
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

export function planVariableStatement(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const declarations = collectVariableDeclarations(node, context);
  if (declarations.length === 0) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.variable",
      "Variable statement has no exact variable declaration.",
    ));
    return undefined;
  }
  const statements: RustStmt[] = [];
  for (const declaration of declarations) {
    const planned = planVariableDeclaration(declaration, context);
    if (planned === undefined) {
      return undefined;
    }
    statements.push(...planned);
  }
  return statements;
}

function planVariableDeclaration(
  declaration: Node,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const { ast } = context.input;
  const nameNode = Node_Name(context.input.ast, declaration);
  const nameKind = nameNode === undefined ? "" : ast.kindName(nameNode);
  if (nameNode !== undefined && (nameKind === KindArrayBindingPattern || nameKind === KindObjectBindingPattern)) {
    return planBindingVariableDeclaration(declaration, nameNode, context);
  }
  const sourceName = nameNode === undefined ? "" : ast.kindName(nameNode) === KindIdentifier ? ast.text(nameNode) : "";
  const name = rustSourceName(context, sourceName);
  if (!isValidRustIdentifier(name)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.variable",
      "Variable declarations require a plain identifier that is valid in Rust.",
    ));
    return undefined;
  }
  const initializer = Node_Initializer(context.input.ast, declaration);
  const locationStorage = rustLocationStorageForDeclaration(declaration, context);
  if (initializer === undefined && locationStorage !== undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.typed-location-storage",
      "Promoted Rust location storage requires an initialized source binding.",
    ));
    return undefined;
  }
  const planned = initializer === undefined ? undefined : planExpression(initializer, context);
  if (initializer !== undefined && planned === undefined) {
    return undefined;
  }
  const typeNode = Node_Type(context.input.ast, declaration);
  const annotatedCarrier = typeNode === undefined
    ? undefined
    : context.input.facts.getRuntimeCarrierFact(typeNode)?.carrier;
  let rustType;
  if (typeNode !== undefined) {
    const renderedCarrier = locationStorage === undefined
      ? annotatedCarrier
      : rustLocationTargetType(locationStorage.valueCarrier);
    rustType = rustTypeFromCarrierInContext(renderedCarrier, context);
    if (rustType === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, typeNode),
        "rust.backend.variable",
        "Variable type annotation has no supported Rust carrier fact.",
      ));
      return undefined;
    }
  }
  const declarationCarrier = context.input.facts.getRuntimeCarrierFact(declaration)?.carrier;
  if (declarationCarrier === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.variable-carrier",
      "Variable declaration has no finalized Rust carrier fact.",
    ));
    return undefined;
  }
  if (rustType === undefined) {
    const renderedCarrier = locationStorage === undefined
      ? declarationCarrier
      : rustLocationTargetType(locationStorage.valueCarrier);
    rustType = rustTypeFromCarrierInContext(renderedCarrier, context);
    if (rustType === undefined && initializer === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, declaration),
        "rust.backend.variable",
        "Uninitialized variable declaration has no renderable finalized Rust carrier.",
      ));
      return undefined;
    }
  }
  if (locationStorage !== undefined &&
    (!rustTargetTypeRefEquals(declarationCarrier, locationStorage.valueCarrier) ||
      (annotatedCarrier !== undefined &&
        !rustTargetTypeRefEquals(annotatedCarrier, locationStorage.valueCarrier)))) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.typed-location-storage-carrier",
      "Promoted Rust storage conflicts with its finalized declaration carrier.",
    ));
    return undefined;
  }
  const ownedBinding = declarationCarrier.kind !== "pointer";
  const resourceFact = context.input.facts.getFact(declaration, rustResourceManagementFactKey);
  const mutable = locationStorage === undefined &&
    (context.input.facts.getFact(declaration, rustMutatedBindingFactKey) !== undefined ||
      (ownedBinding && context.input.facts.getFact(declaration, rustMutatedReferentFactKey) !== undefined) ||
      resourceFact !== undefined && resourceDisposalReceiverMode(resourceFact) === "mut-ref");
  let init: RustExpr | undefined;
  if (initializer !== undefined) {
    if (planned === undefined) {
      return undefined;
    }
    if (locationStorage === undefined) {
      init = planned;
    } else {
      if (!requireRustLocationValueCarrier(
        locationStorage.valueCarrier,
        declaration,
        context,
      )) {
        return undefined;
      }
      context.usedAliases?.add("rt");
      init = { kind: "call", path: "rt::Location::allocate", args: [planned] };
    }
  } else if (rustOptionElementCarrier(declarationCarrier) !== undefined && rustType !== undefined) {
    init = { kind: "associated-value", owner: rustType, name: "None" };
  }
  if (initializer !== undefined && init === undefined) {
    return undefined;
  }
  return [{
    kind: "let",
    name,
    mutable,
    ...(rustType === undefined ? {} : { type: rustType }),
    ...(init === undefined ? {} : { init }),
    ...(initializer === undefined && mutable ? { attrs: ["#[allow(unused_mut)]"] } : {}),
  }];
}

function planBindingVariableDeclaration(
  declaration: Node,
  pattern: Node,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const initializer = Node_Initializer(context.input.ast, declaration);
  const sourceCarrier = context.input.facts.getRuntimeCarrierFact(declaration)?.carrier;
  if (initializer === undefined || sourceCarrier === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.binding-declaration",
      "Binding-pattern declaration requires an initializer and one finalized source carrier.",
    ));
    return undefined;
  }
  if (context.syntheticNames === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, pattern),
      "rust.backend.binding-temporary",
      "Binding-pattern declaration requires a finalized hygienic-name scope.",
    ));
    return undefined;
  }
  const value = planExpression(initializer, context);
  if (value === undefined) {
    return undefined;
  }
  const temporary = allocateRustSyntheticName(context.syntheticNames, "binding");
  const bindings = planRustBindingPattern(
    pattern,
    { kind: "path", path: temporary },
    sourceCarrier,
    context,
    planExpression,
  );
  return bindings === undefined
    ? undefined
    : [{ kind: "let", name: temporary, mutable: false, init: value }, ...bindings];
}

function planExpressionStatement(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const expression = Node_Expression(context.input.ast, node);
  return expression === undefined
    ? undefined
    : planExpressionAsStatement(expression, context);
}

function planExpressionAsStatement(
  expression: Node,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const { ast } = context.input;
  const expressionKind = ast.kindName(expression);
  if (expressionKind === KindBinaryExpression) {
    const operatorToken = BinaryExpression_OperatorToken(context.input.ast, expression);
    const operatorKind = operatorToken === undefined ? "" : ast.kindName(operatorToken);
    const compoundTokens = [
      KindPlusEqualsToken,
      KindMinusEqualsToken,
      KindAsteriskEqualsToken,
      KindSlashEqualsToken,
      KindPercentEqualsToken,
    ];
    let selectedAssignmentFact: RustAssignmentOperationFact | undefined;
    if (operatorKind === KindEqualsToken) {
      const assignment = context.input.facts.getFact(expression, rustTargetOperationFactKey);
      if (assignment !== undefined && assignment.kind === "runtime-set") {
        return planRuntimeSetStatement(expression, assignment, context);
      }
      if (assignment === undefined || assignment.kind !== "operator-token" ||
        !["=", "+=", "-=", "*=", "/=", "%="].includes(assignment.operator)) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, expression),
          "rust.backend.assignment",
          "Assignment requires a finalized Rust assignment fact.",
        ));
        return undefined;
      }
      if (!selectedOperatorMatches(expression, assignment, context)) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, expression),
          "rust.backend.assignment-selected-evidence",
          "Assignment operation fact conflicts with the TSTS-selected operator fact.",
        ));
        return undefined;
      }
      selectedAssignmentFact = assignment;
    }
    if (operatorKind === KindEqualsToken || compoundTokens.includes(operatorKind)) {
      const left = BinaryExpression_Left(context.input.ast, expression);
      const right = BinaryExpression_Right(context.input.ast, expression);
      if (left === undefined || right === undefined) {
        return undefined;
      }
      const sourceField = context.input.facts.getFact(left, rustTargetOperationFactKey);
      const storageOverride = context.expressionOverrides?.get(left);
      const target = storageOverride?.valueForm === "storage"
        ? storageOverride.expression
        : ast.kindName(left) === KindIdentifier
        ? (() => {
            const path = rustSourceName(context, ast.text(left));
            return isValidRustIdentifier(path) ? { kind: "path" as const, path } : undefined;
          })()
        : rustTargetOperationIsDirectLocation(
            context.input.facts.getFact(left, rustTargetOperationFactKey),
          )
          ? planExpression(left, context)
          : undefined;
      if (target === undefined && sourceField?.kind !== "source-accessor" &&
        sourceField?.kind !== "source-static-field" &&
        sourceField?.kind !== "source-field" &&
        sourceField?.kind !== "source-union-field") {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, expression),
          "rust.backend.assignment",
          "Assignments require a plain binding or a finalized direct Rust location.",
        ));
        return undefined;
      }
      const fact = selectedAssignmentFact ??
        context.input.facts.getFact(expression, rustTargetOperationFactKey);
      if (fact === undefined || (fact.kind !== "operator-token" && fact.kind !== "operator-call")) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, expression),
          "rust.backend.operator",
          "Compound assignment requires a finalized Rust operator fact.",
        ));
        return undefined;
      }
      if (!selectedOperatorMatches(expression, fact, context)) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, expression),
          "rust.backend.operator-selected-evidence",
          "Compound assignment fact conflicts with the TSTS-selected operator fact.",
        ));
        return undefined;
      }
      const operator = fact.operator;
      if (!isRustAssignmentOperator(operator)) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, expression),
          "rust.backend.assignment-operator",
          "Finalized assignment fact does not contain a Rust assignment operator.",
        ));
        return undefined;
      }
      const valueNode = operatorKind === KindEqualsToken && operator !== "="
        ? BinaryExpression_Right(context.input.ast, right)
        : right;
      if (valueNode === undefined) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, expression),
          "rust.backend.assignment-shape",
          "Finalized equivalent assignment requires the proven binary value operand.",
        ));
        return undefined;
      }
      if (sourceField?.kind === "source-accessor") {
        return planRustSourceAccessorAssignment(
          left,
          valueNode,
          sourceField,
          fact,
          context,
        );
      }
      if (sourceField?.kind === "source-static-field") {
        return planRustSourceStaticFieldAssignment(
          left,
          valueNode,
          sourceField,
          fact,
          context,
        );
      }
      if (sourceField?.kind === "source-union-field") {
        if (!sourceUnionFieldSelectedOperationMatches(left, sourceField, context)) {
          context.diagnostics.push(missingFactDiagnostic(
            diagnosticInput(context, left),
            "rust.backend.source-union-field-selected-evidence",
            "Source-union field assignment conflicts with the TSTS-selected property fact.",
          ));
          return undefined;
        }
        const receiverNode = Node_Expression(ast, left);
        const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
        if (receiver === undefined || context.syntheticNames === undefined) {
          return undefined;
        }
        const syntheticNames = context.syntheticNames;
        const receiverName = allocateRustSyntheticName(syntheticNames, "union_receiver");
        const value = planExpression(valueNode, context);
        if (value === undefined) {
          return undefined;
        }
        const valueName = allocateRustSyntheticName(syntheticNames, "union_value");
        const projected = planRustSourceUnionFieldProjection(
          left,
          { kind: "path", path: receiverName },
          sourceField,
          context,
          (payload, field) => {
            const read = field.storage === "project-object"
              ? readRustProjectObjectField
              : readRustStructuralObjectField;
            const write = field.storage === "project-object"
              ? writeRustProjectObjectField
              : writeRustStructuralObjectField;
            if (fact.kind === "operator-call") {
              const currentName = allocateRustSyntheticName(syntheticNames, "union_current");
              const nextName = allocateRustSyntheticName(syntheticNames, "union_next");
              const next = planRustCompoundAssignmentValue(
                fact,
                { kind: "path", path: currentName },
                { kind: "path", path: valueName },
                left,
                context,
              );
              return next === undefined
                ? undefined
                : {
                    kind: "block",
                    bindings: [
                      {
                        name: currentName,
                        value: read(payload, field.storageIndex, fact.resultCarrier),
                      },
                      { name: valueName, value },
                      { name: nextName, value: next },
                    ],
                    value: write(
                      payload,
                      field.storageIndex,
                      "=",
                      { kind: "path", path: nextName },
                    ),
                  };
            }
            const selectedValue: RustExpr = { kind: "path", path: valueName };
            if (operator === "+=" && isRustStringCarrier(fact.resultCarrier)) {
              const currentName = allocateRustSyntheticName(
                syntheticNames,
                "union_current",
              );
              return {
                kind: "block",
                bindings: [{
                  name: currentName,
                  value: read(payload, field.storageIndex, fact.resultCarrier),
                }],
                value: write(
                  payload,
                  field.storageIndex,
                  "=",
                  {
                    kind: "string-concat",
                    parts: [
                      { kind: "path", path: currentName },
                      selectedValue,
                    ],
                  },
                ),
              };
            }
            return write(payload, field.storageIndex, operator, selectedValue);
          },
        );
        return projected === undefined
          ? undefined
          : [{
              kind: "expr",
              expr: {
                kind: "block",
                bindings: [
                  { name: receiverName, value: receiver },
                  ...(fact.kind === "operator-token" ? [{ name: valueName, value }] : []),
                ],
                value: projected,
              },
            }];
      }
      if (storageOverride?.valueForm !== "storage" && sourceField?.kind === "source-field") {
        if (!sourceFieldSelectedOperationMatches(left, sourceField, context)) {
          context.diagnostics.push(missingFactDiagnostic(
            diagnosticInput(context, left),
            "rust.backend.source-field-selected-evidence",
            "Project-source field assignment conflicts with the TSTS-selected property fact.",
          ));
          return undefined;
        }
        const receiverNode = Node_Expression(ast, left);
        const plannedReceiver = receiverNode === undefined
          ? undefined
          : planExpression(receiverNode, context);
        const receiver = plannedReceiver;
        if (receiver === undefined) {
          return undefined;
        }
        if (context.syntheticNames === undefined) {
          context.diagnostics.push(missingFactDiagnostic(
            diagnosticInput(context, left),
            "rust.backend.project-field-temporary",
            "Project-source field assignment requires a finalized hygienic-name scope.",
          ));
          return undefined;
        }
        const receiverName = allocateRustSyntheticName(context.syntheticNames, "receiver");
        if (fact.kind === "operator-call") {
          const currentName = allocateRustSyntheticName(context.syntheticNames, "current");
          const valueName = allocateRustSyntheticName(context.syntheticNames, "value");
          const nextName = allocateRustSyntheticName(context.syntheticNames, "next");
          const selectedReceiver: RustExpr = { kind: "path", path: receiverName };
          const current = sourceField.dispatch === undefined
            ? (sourceField.storage === "project-object"
              ? readRustProjectObjectField
              : readRustStructuralObjectField)(
                selectedReceiver,
                sourceField.storageIndex,
                fact.resultCarrier,
              )
            : readRustProjectDispatchedField(selectedReceiver, sourceField.dispatch.read);
          const value = planExpression(valueNode, context);
          if (value === undefined) {
            return undefined;
          }
          const next = planRustCompoundAssignmentValue(
            fact,
            { kind: "path", path: currentName },
            { kind: "path", path: valueName },
            left,
            context,
          );
          if (next === undefined) {
            return undefined;
          }
          return [{
            kind: "expr",
            expr: {
              kind: "block",
              bindings: [
                { name: receiverName, value: receiver },
                { name: currentName, value: current },
                { name: valueName, value },
                { name: nextName, value: next },
              ],
              value: sourceField.dispatch === undefined
                ? (sourceField.storage === "project-object"
                  ? writeRustProjectObjectField
                  : writeRustStructuralObjectField)(
                    selectedReceiver,
                    sourceField.storageIndex,
                    "=",
                    { kind: "path", path: nextName },
                  )
                : writeRustProjectDispatchedField(
                    selectedReceiver,
                    allocateRustSyntheticName(context.syntheticNames, "dispatch_receiver"),
                    sourceField.dispatch.read,
                    sourceField.dispatch.write,
                    "=",
                    { kind: "path", path: nextName },
                  ),
            },
          }];
        }
        const value = planExpression(valueNode, context);
        if (value === undefined) {
          return undefined;
        }
        const valueName = allocateRustSyntheticName(context.syntheticNames, "value");
        if (operator === "+=" && isRustStringCarrier(fact.resultCarrier)) {
          const currentName = allocateRustSyntheticName(context.syntheticNames, "current");
          const selectedReceiver: RustExpr = { kind: "path", path: receiverName };
          const current = sourceField.dispatch === undefined
            ? (sourceField.storage === "project-object"
              ? readRustProjectObjectField
              : readRustStructuralObjectField)(
                selectedReceiver,
                sourceField.storageIndex,
                fact.resultCarrier,
              )
            : readRustProjectDispatchedField(selectedReceiver, sourceField.dispatch.read);
          const concatenated: RustExpr = {
            kind: "string-concat",
            parts: [
              { kind: "path", path: currentName },
              value,
            ],
          };
          return [{
            kind: "expr",
            expr: {
              kind: "block",
              bindings: [
                { name: receiverName, value: receiver },
                { name: currentName, value: current },
              ],
              value: sourceField.dispatch === undefined
                ? (sourceField.storage === "project-object"
                  ? writeRustProjectObjectField
                  : writeRustStructuralObjectField)(
                    selectedReceiver,
                    sourceField.storageIndex,
                    "=",
                    concatenated,
                  )
                : writeRustProjectDispatchedField(
                    selectedReceiver,
                    allocateRustSyntheticName(context.syntheticNames, "dispatch_receiver"),
                    sourceField.dispatch.read,
                    sourceField.dispatch.write,
                    "=",
                    concatenated,
                  ),
            },
          }];
        }
        return [{
          kind: "expr",
          expr: {
            kind: "block",
            bindings: [
              { name: receiverName, value: receiver },
              { name: valueName, value },
            ],
            value: sourceField.dispatch === undefined
              ? (sourceField.storage === "project-object"
                ? writeRustProjectObjectField
                : writeRustStructuralObjectField)(
                  { kind: "path", path: receiverName },
                  sourceField.storageIndex,
                  operator,
                  { kind: "path", path: valueName },
                )
              : writeRustProjectDispatchedField(
                  { kind: "path", path: receiverName },
                  allocateRustSyntheticName(context.syntheticNames, "dispatch_receiver"),
                  sourceField.dispatch.read,
                  sourceField.dispatch.write,
                  operator,
                  { kind: "path", path: valueName },
                ),
          },
        }];
      }
      const value = planExpression(valueNode, context);
      if (value === undefined || target === undefined) {
        return undefined;
      }
      if (fact.kind === "operator-call") {
        return planRustDirectOperatorCallAssignment(
          left,
          target,
          value,
          fact,
          context,
        );
      }
      if (operator === "+=" && isRustStringCarrier(fact.resultCarrier)) {
        if (context.syntheticNames === undefined) {
          context.diagnostics.push(missingFactDiagnostic(
            diagnosticInput(context, expression),
            "rust.backend.string-append-temporary",
            "String compound assignment requires one finalized hygienic-name scope.",
          ));
          return undefined;
        }
        const currentName = allocateRustSyntheticName(context.syntheticNames, "current");
        const concatenated: RustExpr = {
          kind: "string-concat",
          parts: [
            { kind: "path", path: currentName },
            value,
          ],
        };
        const promotedLocation = planRustPromotedStorageLocation(
          left,
          context,
          planExpression,
        );
        if (promotedLocation.kind === "promoted") {
          if (promotedLocation.expression === undefined) {
            return undefined;
          }
          const locationName = allocateRustSyntheticName(context.syntheticNames, "location");
          const location: RustExpr = { kind: "path", path: locationName };
          return [{
            kind: "expr",
            expr: {
              kind: "block",
              bindings: [
                { name: locationName, value: promotedLocation.expression },
                {
                  name: currentName,
                  value: { kind: "method-call", receiver: location, method: "load", args: [] },
                },
              ],
              value: {
                kind: "method-call",
                receiver: location,
                method: "store",
                args: [concatenated],
              },
            },
          }];
        }
        if (ast.kindName(left) !== KindIdentifier) {
          context.diagnostics.push(unsupportedConstructDiagnostic(
            diagnosticInput(context, expression),
            "rust.backend.string-append-location",
            "String compound assignment requires a binding or finalized Rust location plan.",
          ));
          return undefined;
        }
        return [{
          kind: "expr",
          expr: {
            kind: "block",
            bindings: [
              {
                name: currentName,
                value: { kind: "method-call", receiver: target, method: "clone", args: [] },
              },
            ],
            value: { kind: "assignment", operator: "=", target, value: concatenated },
          },
        }];
      }
      const promoted = planRustPromotedStorageWrite(
        left,
        operator,
        value,
        context,
        planExpression,
      );
      if (promoted.handled) {
        return promoted.statement === undefined ? undefined : [promoted.statement];
      }
      return operator === "+=" || operator === "-=" || operator === "*=" || operator === "/=" || operator === "%="
        ? [{ kind: "assign", target, operator, value }]
        : operator === "="
          ? [{ kind: "assign", target, operator, value }]
          : undefined;
    }
  }
  if (expressionKind === KindPostfixUnaryExpression || expressionKind === KindPrefixUnaryExpression) {
    const planned = planExpression(expression, context, "discarded");
    return planned === undefined ? undefined : [{ kind: "expr", expr: planned }];
  }
  if (expressionKind === KindCallExpression || expressionKind === "KindAwaitExpression" ||
    expressionKind === "KindYieldExpression" || expressionKind === KindDeleteExpression ||
    expressionKind === KindVoidExpression) {
    const planned = planExpression(expression, context);
    return planned === undefined ? undefined : [{ kind: "expr", expr: planned }];
  }
  const planned = planExpression(expression, context);
  return planned === undefined
    ? undefined
    : [{ kind: "let", name: "_", mutable: false, init: planned }];
}

function planRustSourceStaticFieldAssignment(
  target: Node,
  valueNode: Node,
  field: Extract<RustTargetOperationFact, { readonly kind: "source-static-field" }>,
  assignment: RustAssignmentOperationFact,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  if (!isRustAssignmentOperator(assignment.operator)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, target),
      "rust.backend.source-static-field-operator",
      "Project static-field assignment requires an exact Rust assignment operator.",
    ));
    return undefined;
  }
  if (!sourceStaticFieldSelectedOperationMatches(target, field, context)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, target),
      "rust.backend.source-static-field-selected-evidence",
      "Project static-field assignment conflicts with the TSTS-selected property fact.",
    ));
    return undefined;
  }
  const location = rustSourceStaticFieldLocation(field, context);
  const value = planExpression(valueNode, context);
  if (location === undefined || value === undefined || context.syntheticNames === undefined) {
    return undefined;
  }
  const locationName = allocateRustSyntheticName(context.syntheticNames, "static_field_location");
  const valueName = allocateRustSyntheticName(context.syntheticNames, "static_field_value");
  const locationPath: RustExpr = { kind: "path", path: locationName };
  const valuePath: RustExpr = { kind: "path", path: valueName };
  if (assignment.operator === "=") {
    return [{
      kind: "expr",
      expr: {
        kind: "block",
        bindings: [
          { name: locationName, value: location },
          { name: valueName, value },
        ],
        value: {
          kind: "method-call",
          receiver: locationPath,
          method: "store",
          args: [valuePath],
        },
      },
    }];
  }
  const currentName = allocateRustSyntheticName(context.syntheticNames, "static_field_current");
  const nextName = allocateRustSyntheticName(context.syntheticNames, "static_field_next");
  const nextValue = planRustCompoundAssignmentValue(
    assignment,
    { kind: "path", path: currentName },
    valuePath,
    target,
    context,
  );
  if (nextValue === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, target),
      "rust.backend.source-static-field-operator",
      "Project static-field compound assignment has no exact Rust value operation.",
    ));
    return undefined;
  }
  return [{
    kind: "expr",
    expr: {
      kind: "block",
      bindings: [
        { name: locationName, value: location },
        {
          name: currentName,
          value: { kind: "method-call", receiver: locationPath, method: "load", args: [] },
        },
        { name: valueName, value },
        { name: nextName, value: nextValue },
      ],
      value: {
        kind: "method-call",
        receiver: locationPath,
        method: "store",
        args: [{ kind: "path", path: nextName }],
      },
    },
  }];
}

function planRustDirectOperatorCallAssignment(
  targetNode: Node,
  target: RustExpr,
  value: RustExpr,
  assignment: Extract<RustAssignmentOperationFact, { readonly kind: "operator-call" }>,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  if (context.syntheticNames === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, targetNode),
      "rust.backend.compound-assignment-temporary",
      "Fallible compound assignment requires a finalized hygienic-name scope.",
    ));
    return undefined;
  }
  const promoted = planRustPromotedStorageLocation(
    targetNode,
    context,
    planExpression,
    false,
  );
  if (promoted.kind === "promoted") {
    if (promoted.expression === undefined) {
      return undefined;
    }
    const locationName = allocateRustSyntheticName(context.syntheticNames, "location");
    const currentName = allocateRustSyntheticName(context.syntheticNames, "current");
    const valueName = allocateRustSyntheticName(context.syntheticNames, "value");
    const nextName = allocateRustSyntheticName(context.syntheticNames, "next");
    const locationPath: RustExpr = { kind: "path", path: locationName };
    const next = planRustCompoundAssignmentValue(
      assignment,
      { kind: "path", path: currentName },
      { kind: "path", path: valueName },
      targetNode,
      context,
    );
    if (next === undefined) {
      return undefined;
    }
    return [{
      kind: "expr",
      expr: {
        kind: "block",
        bindings: [
          { name: locationName, value: promoted.expression },
          {
            name: currentName,
            value: { kind: "method-call", receiver: locationPath, method: "load", args: [] },
          },
          { name: valueName, value },
          { name: nextName, value: next },
        ],
        value: {
          kind: "method-call",
          receiver: locationPath,
          method: "store",
          args: [{ kind: "path", path: nextName }],
        },
      },
    }];
  }

  const currentName = allocateRustSyntheticName(context.syntheticNames, "current");
  const valueName = allocateRustSyntheticName(context.syntheticNames, "value");
  const nextName = allocateRustSyntheticName(context.syntheticNames, "next");
  const directIdentifier = context.input.ast.kindName(targetNode) === KindIdentifier;
  const locationName = directIdentifier
    ? undefined
    : allocateRustSyntheticName(context.syntheticNames, "location");
  const locationPath: RustExpr = locationName === undefined
    ? target
    : { kind: "dereference", pointer: { kind: "path", path: locationName } };
  const current = isRustCopyCarrier(assignment.resultCarrier)
    ? locationPath
    : { kind: "method-call", receiver: locationPath, method: "clone", args: [] } as RustExpr;
  const next = planRustCompoundAssignmentValue(
    assignment,
    { kind: "path", path: currentName },
    { kind: "path", path: valueName },
    targetNode,
    context,
  );
  if (next === undefined) {
    return undefined;
  }
  return [{
    kind: "expr",
    expr: {
      kind: "block",
      bindings: [
        ...(locationName === undefined
          ? []
          : [{
              name: locationName,
              value: { kind: "reference" as const, expr: target, mutable: true },
            }]),
        { name: currentName, value: current },
        { name: valueName, value },
        { name: nextName, value: next },
      ],
      value: {
        kind: "assignment",
        operator: "=",
        target: locationPath,
        value: { kind: "path", path: nextName },
      },
    },
  }];
}

function rustBinaryOperatorForAssignment(
  operator: RustAssignmentOperator,
): RustBinaryOperator | undefined {
  switch (operator) {
    case "+=":
      return "+";
    case "-=":
      return "-";
    case "*=":
      return "*";
    case "/=":
      return "/";
    case "%=":
      return "%";
    case "&=":
      return "&";
    case "|=":
      return "|";
    case "^=":
      return "^";
    case "<<=":
      return "<<";
    case ">>=":
      return ">>";
    case "=":
      return undefined;
  }
}

function planRustSourceAccessorAssignment(
  target: Node,
  valueNode: Node,
  accessor: Extract<RustTargetOperationFact, { readonly kind: "source-accessor" }>,
  assignment: RustAssignmentOperationFact,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const operator = assignment.operator;
  if (!isRustAssignmentOperator(operator)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, target),
      "rust.backend.source-accessor-assignment-operator",
      "Project accessor assignment requires a finalized Rust assignment operator.",
    ));
    return undefined;
  }
  if (!sourceAccessorSelectedOperationMatches(target, accessor, context)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, target),
      "rust.backend.source-accessor-selected-evidence",
      "Project accessor assignment conflicts with the TSTS-selected property fact.",
    ));
    return undefined;
  }
  const unsafeAccessor = rustSelectedAccessorRequiresUnsafe(
    target,
    "setter",
    context.input,
  ) || (operator !== "=" && rustSelectedAccessorRequiresUnsafe(
    target,
    "getter",
    context.input,
  ));
  if (unsafeAccessor && (context.explicitUnsafeContextDepth ?? 0) === 0) {
    context.diagnostics.push({
      code: "RUST_UNSAFE_OPERATION_CONTEXT_REQUIRED",
      category: "error",
      source: "tsonic-rust",
      message: "The selected Rust operation requires an explicit unsafeContext() source region at this use site.",
      sourceNode: target,
    });
    return undefined;
  }
  const write = accessor.write;
  const read = operator === "=" ? undefined : accessor.read;
  if (write === undefined || (operator !== "=" && read === undefined)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, target),
      "rust.backend.source-accessor-assignment",
      "Project accessor assignment requires the exact selected setter and compound assignments also require the selected getter.",
    ));
    return undefined;
  }
  if (context.syntheticNames === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, target),
      "rust.backend.source-accessor-temporary",
      "Project accessor assignment requires a finalized hygienic-name scope.",
    ));
    return undefined;
  }
  const bindings: { name: string; value: RustExpr }[] = [];
  let receiver: RustExpr | undefined;
  if (accessor.receiver.kind === "instance") {
    const receiverNode = Node_Expression(context.input.ast, target);
    const plannedReceiver = receiverNode === undefined
      ? undefined
      : planExpression(receiverNode, context);
    if (plannedReceiver === undefined) {
      return undefined;
    }
    const receiverName = allocateRustSyntheticName(context.syntheticNames, "accessor_receiver");
    bindings.push({ name: receiverName, value: plannedReceiver });
    receiver = { kind: "path", path: receiverName };
  }
  let current: RustExpr | undefined;
  if (read !== undefined) {
    const plannedRead = planRustSourceAccessorCall(
      target,
      accessor,
      read.method,
      [],
      context,
      receiver,
    );
    const finalizedRead = plannedRead === undefined
      ? undefined
      : finishRustSourceAccessorCall(target, "read", plannedRead, context);
    if (finalizedRead === undefined) {
      return undefined;
    }
    const currentName = allocateRustSyntheticName(context.syntheticNames, "accessor_current");
    bindings.push({ name: currentName, value: finalizedRead });
    current = { kind: "path", path: currentName };
  }
  const plannedValue = planExpression(valueNode, context);
  if (plannedValue === undefined) {
    return undefined;
  }
  const valueName = allocateRustSyntheticName(context.syntheticNames, "accessor_value");
  bindings.push({ name: valueName, value: plannedValue });
  const selectedValue: RustExpr = { kind: "path", path: valueName };
  const next = operator === "="
    ? selectedValue
    : current === undefined
      ? undefined
      : planRustCompoundAssignmentValue(
          assignment,
          current,
          selectedValue,
          target,
          context,
        );
  if (next === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, target),
      "rust.backend.source-accessor-operator",
      "Project accessor compound assignment has no exact Rust value operation.",
    ));
    return undefined;
  }
  const plannedWrite = planRustSourceAccessorCall(
    target,
    accessor,
    write.method,
    [next],
    context,
    receiver,
  );
  const finalizedWrite = plannedWrite === undefined
    ? undefined
    : finishRustSourceAccessorCall(target, "write", plannedWrite, context);
  return finalizedWrite === undefined
    ? undefined
    : [{ kind: "expr", expr: { kind: "block", bindings, value: finalizedWrite } }];
}

function planRustCompoundAssignmentValue(
  assignment: RustAssignmentOperationFact,
  current: RustExpr,
  value: RustExpr,
  node: Node,
  context: RustPlanContext,
): RustExpr | undefined {
  if (assignment.kind === "operator-call") {
    return planRustOperatorCallExpression(assignment, current, value, node, context);
  }
  const operator = assignment.operator;
  if (!isRustAssignmentOperator(operator)) {
    return undefined;
  }
  if (operator === "=") {
    return value;
  }
  if (operator === "+=" && isRustStringCarrier(assignment.resultCarrier)) {
    return { kind: "string-concat", parts: [current, value] };
  }
  const binary = rustBinaryOperatorForAssignment(operator);
  if (binary === undefined) {
    return undefined;
  }
  return { kind: "binary", operator: binary, left: current, right: value };
}

function planCondition(condition: Node, context: RustPlanContext, construct: string) {
  const carrier: TargetTypeRef | undefined = expressionCarrier(condition, context);
  if (!isRustBoolCarrier(carrier)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, condition),
      "rust.backend.condition",
      `${construct} conditions require a finalized bool carrier fact.`,
    ));
    return undefined;
  }
  return planExpression(condition, context);
}

function planEmbeddedBlock(node: Node | undefined, context: RustPlanContext): RustBlock | undefined {
  if (node === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, context.sourceFile),
      "rust.backend.embedded-statement",
      "Control-flow construct has no source body statement.",
    ));
    return undefined;
  }
  return planBlockLike(node, context);
}

function planIfStatement(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const condition = Node_Expression(context.input.ast, node);
  if (condition === undefined) {
    return undefined;
  }
  const planned = planCondition(condition, context, "if");
  if (planned === undefined) {
    return undefined;
  }
  const thenBlock = planEmbeddedBlock(IfStatement_ThenStatement(context.input.ast, node), context);
  const elseStatement = IfStatement_ElseStatement(context.input.ast, node);
  const elseBlock = elseStatement === undefined ? undefined : planEmbeddedBlock(elseStatement, context);
  if (thenBlock === undefined || (elseStatement !== undefined && elseBlock === undefined)) {
    return undefined;
  }
  return [{
    kind: "if",
    condition: planned,
    then: thenBlock,
    ...(elseBlock === undefined ? {} : { else: elseBlock }),
  }];
}

function planLabeledStatement(
  node: Node,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const { ast } = context.input;
  const labelNode = LabeledStatement_Label(ast, node);
  const bodyNode = LabeledStatement_Statement(ast, node);
  const sourceLabel = labelNode === undefined ? "" : ast.text(labelNode);
  if (bodyNode === undefined || sourceLabel.length === 0) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.labeled-statement-shape",
      "Labeled statements require exact label and body nodes.",
    ));
    return undefined;
  }
  switch (ast.kindName(bodyNode)) {
    case KindWhileStatement:
      return planWhileStatement(bodyNode, context, sourceLabel);
    case KindDoStatement:
      return planDoStatement(bodyNode, context, sourceLabel);
    case KindForStatement:
      return planForStatement(bodyNode, context, sourceLabel);
    case KindForInStatement:
      return planForInStatement(bodyNode, context, sourceLabel);
    case "KindForOfStatement":
      return planForOfStatement(bodyNode, context, sourceLabel);
    default: {
      const target = createRustBreakTarget(context, "label", sourceLabel);
      if (target === undefined) {
        return undefined;
      }
      const body = planEmbeddedBlock(bodyNode, withRustControlTarget(context, target));
      return body === undefined
        ? undefined
        : [{ kind: "scope", ...(target.used.value ? { label: target.label } : {}), body }];
    }
  }
}

function planSwitchStatement(
  node: Node,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const { ast } = context.input;
  const fact = context.input.facts.getFact(node, rustTargetOperationFactKey);
  const discriminantNode = SwitchStatement_Expression(ast, node);
  const clauseNodes = CaseBlock_Clauses(ast, SwitchStatement_CaseBlock(ast, node));
  if (fact?.kind !== "switch" || discriminantNode === undefined || clauseNodes === undefined ||
    clauseNodes.some((clause) => clause === undefined) || fact.clauses.length !== clauseNodes.length ||
    fact.clauses.some((clause, index) => clause.clause !== clauseNodes[index])) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.switch-selection",
      "Switch lowering requires one exact finalized discriminant and clause selection fact.",
    ));
    return undefined;
  }
  if (context.syntheticNames === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.switch-names",
      "Switch lowering requires finalized hygienic-name state.",
    ));
    return undefined;
  }
  const discriminant = planExpression(discriminantNode, context);
  const target = createRustBreakTarget(context, "switch");
  if (discriminant === undefined || target === undefined) {
    return undefined;
  }
  const switchContext = withRustControlTarget(context, target);
  const sections: { readonly expression?: RustExpr; readonly body: RustBlock }[] = [];
  for (let index = 0; index < clauseNodes.length; index += 1) {
    const clause = clauseNodes[index]!;
    const selected = fact.clauses[index]!;
    const sourceExpression = CaseOrDefaultClause_Expression(ast, clause);
    const statements = CaseOrDefaultClause_Statements(ast, clause);
    if (statements === undefined || statements.some((statement) => statement === undefined) ||
      (ast.kindName(clause) === KindCaseClause &&
        (sourceExpression === undefined || selected.expression !== sourceExpression ||
          selected.carrier === undefined ||
          !rustTargetTypeRefEquals(selected.carrier, fact.discriminantCarrier)))) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, clause),
        "rust.backend.switch-clause",
        "Switch clause conflicts with its finalized source selection fact.",
      ));
      return undefined;
    }
    if (statements.some((statement) =>
      statement !== undefined && directResourceDeclaration(statement, context) !== undefined)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, clause),
        "rust.backend.switch-resource-scope",
        "A switch-clause resource declaration requires an explicit block so its lexical disposal boundary is exact.",
      ));
      return undefined;
    }
    const expression = sourceExpression === undefined
      ? undefined
      : planExpression(sourceExpression, context);
    if (sourceExpression !== undefined && expression === undefined) {
      return undefined;
    }
    const body = planStatementSequence(
      statements,
      clause,
      switchContext,
    );
    if (body === undefined) {
      return undefined;
    }
    sections.push({
      ...(expression === undefined
        ? {}
        : { expression: switchCaseComparisonExpression(expression) }),
      body,
    });
  }

  const fallthroughBody = (start: number): RustBlock => {
    const statements: RustStmt[] = [];
    for (let index = start; index < sections.length; index += 1) {
      const section = sections[index]!;
      statements.push(...section.body.statements);
      if (rustBlockDefinitelyExits(section.body)) {
        break;
      }
    }
    return { statements };
  };
  const defaultIndex = sections.findIndex((section) => section.expression === undefined);
  let selection: RustBlock = defaultIndex < 0
    ? { statements: [] }
    : fallthroughBody(defaultIndex);
  const discriminantName = allocateRustSyntheticName(context.syntheticNames, "switch_value");
  for (let index = sections.length - 1; index >= 0; index -= 1) {
    const section = sections[index]!;
    if (section.expression === undefined) {
      continue;
    }
    selection = {
      statements: [{
        kind: "if",
        condition: switchGuardCondition(discriminantName, section.expression),
        then: fallthroughBody(index),
        else: selection,
      }],
    };
  }
  if (sections.every((section) => section.expression === undefined)) {
    const body = target.used.value
      ? [{ kind: "scope" as const, label: target.label, body: selection }]
      : selection.statements;
    return [
      { kind: "let", name: "_", mutable: false, init: discriminant },
      ...body,
    ];
  }
  return [
    { kind: "let", name: discriminantName, mutable: false, init: discriminant },
    {
      kind: "scope",
      ...(target.used.value ? { label: target.label } : {}),
      body: selection,
    },
  ];
}

function switchCaseComparisonExpression(expression: RustExpr): RustExpr {
  return expression.kind === "string-literal"
    ? { kind: "str-literal", value: expression.value }
    : expression;
}

function switchGuardCondition(discriminantName: string, expression: RustExpr): RustExpr {
  const discriminant: RustExpr = { kind: "path", path: discriminantName };
  if (expression.kind === "bool-literal") {
    return expression.value ? discriminant : negateRustCondition(discriminant);
  }
  return {
    kind: "binary",
    operator: "==",
    left: discriminant,
    right: expression,
  };
}

function planWhileStatement(
  node: Node,
  context: RustPlanContext,
  sourceLabel?: string,
): readonly RustStmt[] | undefined {
  const condition = Node_Expression(context.input.ast, node);
  if (condition === undefined) {
    return undefined;
  }
  const planned = planCondition(condition, context, "while");
  if (planned === undefined) {
    return undefined;
  }
  const target = createRustLoopTarget(context, [], sourceLabel);
  if (target === undefined) {
    return undefined;
  }
  const body = planEmbeddedBlock(
    IterationStatement_Statement(context.input.ast, node),
    withRustControlTarget(context, target),
  );
  if (body === undefined) {
    return undefined;
  }
  return planned.kind === "bool-literal" && planned.value && !target.breakUsed.value
    ? [{
        kind: "loop",
        ...(target.used.value ? { label: target.label } : {}),
        body,
        neverFallsThrough: true,
      }]
    : [{
        kind: "while",
        ...(target.used.value ? { label: target.label } : {}),
        condition: planned,
        body,
      }];
}

function planDoStatement(
  node: Node,
  context: RustPlanContext,
  sourceLabel?: string,
): readonly RustStmt[] | undefined {
  const condition = Node_Expression(context.input.ast, node);
  const bodyNode = DoStatement_Statement(context.input.ast, node);
  if (condition === undefined || bodyNode === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.do-while-shape",
      "do-while requires concrete body and condition nodes.",
    ));
    return undefined;
  }
  const plannedCondition = planCondition(condition, context, "do-while");
  const baseTarget = createRustLoopTarget(context, [], sourceLabel);
  if (plannedCondition === undefined || baseTarget === undefined) {
    return undefined;
  }
  const conditionExit: RustStmt = {
    kind: "if",
    condition: negateRustCondition(plannedCondition),
    then: { statements: [{ kind: "break" }] },
  };
  const target: RustLoopTarget = {
    ...baseTarget,
    continuePrelude: [conditionExit],
  };
  const body = planEmbeddedBlock(
    bodyNode,
    withRustControlTarget(context, target),
  );
  if (body === undefined) {
    return undefined;
  }
  return [{
    kind: "loop",
    ...(target.used.value ? { label: target.label } : {}),
    body: rustBlockDefinitelyExits(body)
      ? body
      : { statements: [...body.statements, conditionExit] },
  }];
}

function negateRustCondition(condition: RustExpr): RustExpr {
  if (condition.kind === "unary" && condition.operator === "!") {
    return condition.operand;
  }
  if (condition.kind === "binary") {
    const inverse = condition.operator === "==" ? "!="
      : condition.operator === "!=" ? "=="
        : condition.operator === "<" ? ">="
          : condition.operator === "<=" ? ">"
            : condition.operator === ">" ? "<="
              : condition.operator === ">=" ? "<"
                : undefined;
    if (inverse !== undefined) {
      return { ...condition, operator: inverse };
    }
    if (condition.operator === "&&" || condition.operator === "||") {
      return {
        kind: "binary",
        operator: condition.operator === "&&" ? "||" : "&&",
        left: negateRustCondition(condition.left),
        right: negateRustCondition(condition.right),
      };
    }
  }
  return { kind: "unary", operator: "!", operand: condition };
}

function planForStatement(
  node: Node,
  context: RustPlanContext,
  sourceLabel?: string,
): readonly RustStmt[] | undefined {
  const initializer = ForStatement_Initializer(context.input.ast, node);
  const condition = ForStatement_Condition(context.input.ast, node);
  const incrementor = ForStatement_Incrementor(context.input.ast, node);
  const planLoop = (loopContext: RustPlanContext): RustBlock | undefined => {
    const conditionExpr = condition === undefined
      ? { kind: "bool-literal" as const, value: true }
      : planCondition(condition, loopContext, "for");
    const incrementStatements = incrementor === undefined
      ? []
      : planIncrementor(incrementor, loopContext);
    if (conditionExpr === undefined || incrementStatements === undefined) {
      return undefined;
    }
    const target = createRustLoopTarget(loopContext, incrementStatements, sourceLabel);
    if (target === undefined) {
      return undefined;
    }
    const body = planEmbeddedBlock(
      IterationStatement_Statement(loopContext.input.ast, node),
      withRustControlTarget(loopContext, target),
    );
    if (body === undefined) {
      return undefined;
    }
    const loopBody: RustBlock = rustBlockDefinitelyExits(body)
      ? body
      : { statements: [...body.statements, ...incrementStatements] };
    return {
      statements: [{
        kind: "while",
        ...(target.used.value ? { label: target.label } : {}),
        condition: conditionExpr,
        body: loopBody,
      }],
    };
  };

  if (initializer === undefined) {
    const loop = planLoop(context);
    return loop?.statements;
  }
  const declarations = collectVariableDeclarations(initializer, context);
  const resourceDeclaration = declarations.length === 1 &&
      (context.input.ast.variableDeclarationKind(declarations[0]) === "using" ||
        context.input.ast.variableDeclarationKind(declarations[0]) === "await using")
    ? declarations[0]
    : undefined;
  const initStatements = planVariableStatement(initializer, context);
  if (initStatements === undefined) {
    return undefined;
  }
  if (resourceDeclaration === undefined) {
    const loop = planLoop(context);
    return loop === undefined
      ? undefined
      : [{ kind: "scope", body: { statements: [...initStatements, ...loop.statements] } }];
  }
  const fact = resourceFactForPlanning(resourceDeclaration, context);
  const nameNode = Node_Name(context.input.ast, resourceDeclaration);
  const resourceName = nameNode === undefined
    ? ""
    : rustSourceName(context, context.input.ast.text(nameNode));
  if (fact === undefined || !isValidRustIdentifier(resourceName)) {
    return undefined;
  }
  const scope = planResourceManagedBody(
    resourceDeclaration,
    resourceName,
    fact,
    context,
    planLoop,
  );
  return scope === undefined
    ? undefined
    : [{ kind: "scope", body: { statements: [...initStatements, scope] } }];
}

function createRustLoopTarget(
  context: RustPlanContext,
  continuePrelude: readonly RustStmt[],
  sourceLabel?: string,
): RustLoopTarget | undefined {
  if (context.syntheticNames === undefined || context.controlFlow === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, context.sourceFile),
      "rust.backend.loop-control",
      "Loop lowering requires finalized hygienic names and control-flow state.",
    ));
    return undefined;
  }
  const target: RustLoopTarget = {
    kind: "loop",
    id: context.controlFlow.nextLoopId,
    label: allocateRustSyntheticName(context.syntheticNames, "loop"),
    ...(sourceLabel === undefined ? {} : { sourceLabel }),
    ...(context.completionBoundary === undefined
      ? {}
      : { resourceBoundary: context.completionBoundary }),
    used: { value: false },
    breakUsed: { value: false },
    continuePrelude,
  };
  context.controlFlow.nextLoopId += 1;
  return target;
}

function createRustBreakTarget(
  context: RustPlanContext,
  kind: "switch" | "label",
  sourceLabel?: string,
): RustControlTarget | undefined {
  if (context.syntheticNames === undefined || context.controlFlow === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, context.sourceFile),
      "rust.backend.control-target",
      "Labeled control flow requires finalized hygienic names and control-flow state.",
    ));
    return undefined;
  }
  const target: RustControlTarget = {
    kind,
    id: context.controlFlow.nextLoopId,
    label: allocateRustSyntheticName(context.syntheticNames, kind),
    ...(sourceLabel === undefined ? {} : { sourceLabel }),
    ...(context.completionBoundary === undefined
      ? {}
      : { resourceBoundary: context.completionBoundary }),
    used: { value: false },
  };
  context.controlFlow.nextLoopId += 1;
  return target;
}

function withRustControlTarget(
  context: RustPlanContext,
  target: RustControlTarget,
): RustPlanContext {
  return {
    ...context,
    controlTargets: [...(context.controlTargets ?? []), target],
  };
}

function planIncrementor(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  return planExpressionAsStatement(node, context);
}



export function isConstLiteralInitializer(node: Node, context: RustPlanContext): boolean {
  const kind = context.input.ast.kindName(node);
  return kind === KindNumericLiteral || kind === KindStringLiteral || kind === "KindTrueKeyword" || kind === "KindFalseKeyword";
}

function planRuntimeSetStatement(
  expression: Node,
  fact: Extract<import("../../source/rust-facts/keys.js").RustTargetOperationFact, { kind: "runtime-set" }>,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const { ast } = context.input;
  const left = BinaryExpression_Left(context.input.ast, expression);
  const right = BinaryExpression_Right(context.input.ast, expression);
  if (left === undefined || right === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, expression),
      "rust.backend.runtime-set-shape",
      "Runtime setter fact requires concrete assignment target and value nodes.",
    ));
    return undefined;
  }
  const leftKind = ast.kindName(left);
  const expectedOperationKind = leftKind === "KindPropertyAccessExpression"
    ? "property-set"
    : leftKind === "KindElementAccessExpression"
      ? "index-set"
      : undefined;
  const indexNode = leftKind === "KindElementAccessExpression"
    ? ElementAccessExpression_ArgumentExpression(context.input.ast, left)
    : undefined;
  const sourceArgumentNodes = indexNode === undefined ? [right] : [indexNode, right];
  if (!validateRustFinalizedOperationAbi(fact.abi) ||
    expectedOperationKind === undefined || fact.abi.operationKind !== expectedOperationKind ||
    (expectedOperationKind === "index-set" && indexNode === undefined) ||
    sourceArgumentNodes.length !== fact.abi.sourceArguments.length ||
    fact.abi.sourceArguments.some((argument) => argument.disposition !== "runtime") ||
    fact.abi.effects.invocation !== "infallible" || fact.abi.effects.awaiting !== "not-applicable" ||
    fact.abi.result.kind !== "sync" || !isRustUnitCarrier(fact.abi.result.carrier)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, expression),
      "rust.backend.runtime-set-abi",
      "Runtime setter source shape, effects, and arguments do not match one valid total Rust setter ABI.",
    ));
    return undefined;
  }
  const selectedResult = context.input.facts.getRuntimeCarrierFact(right)?.carrier;
  if (selectedResult === undefined || !selectedOperatorIdentityMatches(
    expression,
    fact.operationId,
    fact.operationId,
    selectedResult,
    context,
  )) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, expression),
      "rust.backend.runtime-set-selected-evidence",
      "Runtime setter fact conflicts with the TSTS-selected assignment operation.",
    ));
    return undefined;
  }
  const receiverNode = Node_Expression(context.input.ast, left);
  const receiver = fact.abi.targetReceiver.kind === "input" && receiverNode !== undefined
    ? planFinalizedSourceInput(
        context,
        fact.abi.targetReceiver.input,
        receiverNode,
        sourceArgumentNodes,
        expression,
        "target-receiver",
      )
    : undefined;
  if (fact.abi.targetReceiver.kind === "input" && receiver === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, expression),
      "rust.backend.runtime-set-receiver",
      "Runtime setter ABI has no finalized target receiver input.",
    ));
    return undefined;
  }
  const targetArguments: RustExpr[] = [];
  for (const input of fact.abi.targetArguments) {
    const planned = planFinalizedTargetInput(context, input, receiverNode, sourceArgumentNodes, expression);
    if (planned === undefined) {
      return undefined;
    }
    targetArguments.push(planned);
  }
  if (fact.abi.target.form === "index") {
    const [index, value] = targetArguments;
    if (receiver === undefined || index === undefined || value === undefined ||
      targetArguments.length !== 2) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, expression),
        "rust.backend.runtime-index-set-abi",
        "Runtime index setter ABI must finalize exactly index and value target inputs.",
      ));
      return undefined;
    }
    return [{
      kind: "index-assign",
      receiver,
      index,
      value,
    }];
  }
  if (fact.abi.target.form === "call" || fact.abi.target.form === "free-call" ||
    fact.abi.target.form === "call-str-slice" ||
    fact.abi.target.form === "free-call-str-slice" ||
    fact.abi.target.form === "call-value-slice" ||
    fact.abi.target.form === "call-value-array") {
    registerAliasFromPath(context, fact.abi.target.path);
    let call: RustExpr = {
      kind: "call",
      path: fact.abi.target.path,
      args: targetArguments,
    };
    if (fact.abi.target.form === "call") {
      for (const step of fact.abi.target.chain ?? []) {
        if (step.kind !== "method") {
          context.diagnostics.push(missingFactDiagnostic(
            diagnosticInput(context, expression),
            "rust.backend.runtime-set-chain",
            "Runtime setter call chain contains a non-method step after ABI validation.",
          ));
          return undefined;
        }
        call = { kind: "method-call", receiver: call, method: step.name, args: [] };
      }
    }
    return [{ kind: "expr", expr: call }];
  }
  if (fact.abi.target.form === "receiver-method" || fact.abi.target.form === "method" ||
    fact.abi.target.form === "arg-method" ||
    fact.abi.target.form === "arg-receiver-method" ||
    fact.abi.target.form === "receiver-value-array" ||
    fact.abi.target.form === "receiver-tagged-array") {
    if (receiver === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, expression),
        "rust.backend.runtime-set-receiver",
        "Runtime setter method form has no finalized target receiver input.",
      ));
      return undefined;
    }
    let call: RustExpr = {
      kind: "method-call",
      receiver,
      method: fact.abi.target.name,
      args: targetArguments,
    };
    if (fact.abi.target.form === "receiver-method") {
      for (const step of fact.abi.target.chain ?? []) {
        if (step.kind !== "method") {
          context.diagnostics.push(missingFactDiagnostic(
            diagnosticInput(context, expression),
            "rust.backend.runtime-set-chain",
            "Runtime setter method chain contains a non-method step after ABI validation.",
          ));
          return undefined;
        }
        call = { kind: "method-call", receiver: call, method: step.name, args: [] };
      }
    }
    return [{
      kind: "expr",
      expr: call,
    }];
  }
  context.diagnostics.push(unsupportedConstructDiagnostic(
    diagnosticInput(context, expression),
    "rust.js.assignment",
    "Runtime set operation form is not supported.",
  ));
  return undefined;
}

function selectedOperatorMatches(
  expression: Node,
  fact: RustAssignmentOperationFact,
  context: RustPlanContext,
): boolean {
  return selectedOperatorIdentityMatches(expression, fact.operationId, fact.operator, fact.resultCarrier, context);
}

function selectedOperatorIdentityMatches(
  expression: Node,
  operationId: string,
  targetOperation: string,
  resultCarrier: TargetTypeRef,
  context: RustPlanContext,
): boolean {
  const selected = context.input.facts.getSelectedTargetOperator(expression);
  return selected !== undefined && selected.operationKind === "operator" &&
    selected.operationId === operationId && selected.targetOperation === targetOperation &&
    selected.resultType !== undefined && rustTargetTypeRefEquals(selected.resultType, resultCarrier);
}

function planForOfStatement(
  node: Node,
  context: RustPlanContext,
  sourceLabel?: string,
): readonly RustStmt[] | undefined {
  const { ast } = context.input;
  const fact = context.input.facts.getFact(node, rustTargetOperationFactKey);
  if (fact === undefined || fact.kind !== "iteration" || fact.iterationKind === "for-in") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.loop",
      "for-of statements require a finalized iteration fact.",
    ));
    return undefined;
  }
  const selectedIteration = context.input.facts.getSelectedTargetIteration(node);
  if (selectedIteration === undefined || selectedIteration.operationKind !== "iteration" ||
    selectedIteration.operationId !== fact.operationId || selectedIteration.resultType === undefined ||
    !rustTargetTypeRefEquals(selectedIteration.resultType, fact.elementCarrier)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.iteration-selected-element",
      "Finalized Rust iteration fact conflicts with the TSTS-selected iteration element carrier.",
    ));
    return undefined;
  }
  const initializer = ForInOrOfStatement_Initializer(context.input.ast, node);
  const declarations = initializer === undefined
    ? []
    : collectVariableDeclarations(initializer, context);
  const bindingDeclaration = declarations.length === 1 ? declarations[0] : undefined;
  const bindingNameNode = bindingDeclaration === undefined
    ? undefined
    : Node_Name(context.input.ast, bindingDeclaration);
  const bindingNameKind = bindingNameNode === undefined ? "" : ast.kindName(bindingNameNode);
  const bindingPattern = bindingNameNode !== undefined &&
      (bindingNameKind === KindArrayBindingPattern || bindingNameKind === KindObjectBindingPattern)
    ? bindingNameNode
    : undefined;
  let binding = "";
  if (bindingNameNode !== undefined && bindingNameKind === KindIdentifier) {
    binding = rustSourceName(context, ast.text(bindingNameNode));
  } else if (bindingPattern !== undefined && context.syntheticNames !== undefined) {
    binding = allocateRustSyntheticName(context.syntheticNames, "binding_element");
  }
  if (!isValidRustIdentifier(binding)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.loop",
      "for-of bindings require an exact identifier or finalized binding pattern.",
    ));
    return undefined;
  }
  const iterableNode = Node_Expression(context.input.ast, node);
  const iterable = iterableNode === undefined ? undefined : planExpression(iterableNode, context);
  if (iterable === undefined) {
    return undefined;
  }
  const bodyNode = ForInOrOfStatement_Statement(context.input.ast, node);
  if (bodyNode === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.iteration-body",
      "for-of statements require a concrete source body.",
    ));
    return undefined;
  }
  const target = createRustLoopTarget(context, [], sourceLabel);
  if (target === undefined) {
    return undefined;
  }
  const resourceKind = bindingDeclaration === undefined
    ? undefined
    : ast.variableDeclarationKind(bindingDeclaration);
  const resourceBinding = resourceKind === "using" || resourceKind === "await using";
  if (resourceBinding && bindingPattern !== undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, bindingPattern),
      "rust.backend.resource-binding-pattern",
      "Resource-managed iteration binding patterns require an exact per-binding disposal contract.",
    ));
    return undefined;
  }
  const resourceFact = resourceBinding && bindingDeclaration !== undefined
    ? resourceFactForPlanning(bindingDeclaration, context)
    : undefined;
  if (resourceBinding && resourceFact === undefined) {
    return undefined;
  }
  let body = resourceFact === undefined || bindingDeclaration === undefined
    ? planBlockLike(
        bodyNode,
        withRustControlTarget(context, target),
      )
    : (() => {
        const resourceScope = planResourceManagedBody(
          bindingDeclaration,
          binding,
          resourceFact,
          context,
          (bodyContext) => planBlockLike(
            bodyNode,
            withRustControlTarget(bodyContext, target),
          ),
        );
        return resourceScope === undefined
          ? undefined
          : { statements: [resourceScope] };
      })();
  if (body === undefined) {
    return undefined;
  }
  if (bindingPattern !== undefined) {
    const bindings = planRustBindingPattern(
      bindingPattern,
      { kind: "path", path: binding },
      fact.elementCarrier,
      context,
      planExpression,
    );
    if (bindings === undefined) {
      return undefined;
    }
    body = { statements: [...bindings, ...body.statements] };
  }
  const bindingMutable = resourceFact !== undefined &&
    resourceDisposalReceiverMode(resourceFact) === "mut-ref";
  if (fact.lowering.kind === "async-generator") {
    if (context.asyncContext !== true || context.syntheticNames === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.async-iteration-context",
        "Async generator iteration requires a finalized async function context and hygienic local-name state.",
      ));
      return undefined;
    }
    const iteratorName = allocateRustSyntheticName(context.syntheticNames, "async_iterator");
    const next: RustExpr = {
      kind: "await",
      expr: {
        kind: "method-call",
        receiver: { kind: "path", path: iteratorName },
        method: "next_yield",
        args: [],
      },
    };
    return [{
      kind: "scope",
      body: {
        statements: [
          { kind: "let", name: iteratorName, mutable: false, init: iterable },
          {
            kind: "while-let-some",
            ...(target.used.value ? { label: target.label } : {}),
            binding,
            ...(bindingMutable ? { bindingMutable: true } : {}),
            expression: next,
            body,
          },
        ],
      },
    }];
  }
  const nonConsumingIterable = iterableNode === undefined
    ? iterable
    : planRustNonConsumingValue(iterableNode, iterable, context);
  if (fact.lowering.kind === "borrowed") {
    context.usedAliases?.add("rt");
  }
  const targetIterable: RustExpr = fact.lowering.kind === "borrowed"
    ? {
        kind: "call",
        path: `rt::iter_${fact.lowering.style}`,
        args: [fact.lowering.input === "reference"
          ? applyRustArgumentMode(context, nonConsumingIterable, "ref", iterableNode)
          : nonConsumingIterable],
      }
    : fact.lowering.kind === "js-array"
      ? { kind: "method-call", receiver: nonConsumingIterable, method: "iter_values", args: [] }
      : fact.lowering.kind === "receiver-method"
        ? { kind: "method-call", receiver: nonConsumingIterable, method: fact.lowering.name, args: [] }
      : iterable;
  return [{
    kind: "for",
    ...(target.used.value ? { label: target.label } : {}),
    binding,
    ...(bindingMutable ? { bindingMutable: true } : {}),
    iterable: targetIterable,
    body,
  }];
}

type PlannedForInBinding =
  | { readonly kind: "declaration"; readonly name: string; readonly mutable: boolean }
  | { readonly kind: "assignment"; readonly name: string };

function planForInStatement(
  node: Node,
  context: RustPlanContext,
  sourceLabel?: string,
): readonly RustStmt[] | undefined {
  const { ast } = context.input;
  const fact = context.input.facts.getFact(node, rustTargetOperationFactKey);
  if (fact === undefined || fact.kind !== "iteration" || fact.iterationKind !== "for-in" ||
    (fact.lowering.kind !== "dense-index-keys" && fact.lowering.kind !== "js-array-index-keys" &&
      fact.lowering.kind !== "static-keys")) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.for-in",
      "for-in statements require one finalized property-key iteration policy.",
    ));
    return undefined;
  }
  const selectedIteration = context.input.facts.getSelectedTargetIteration(node);
  if (selectedIteration === undefined || selectedIteration.operationKind !== "iteration" ||
    selectedIteration.operationId !== fact.operationId || selectedIteration.resultType === undefined ||
    !rustTargetTypeRefEquals(selectedIteration.resultType, fact.elementCarrier)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.for-in-selected-key",
      "Finalized Rust property-key iteration conflicts with the TSTS-selected key carrier.",
    ));
    return undefined;
  }
  const initializer = ForInOrOfStatement_Initializer(ast, node);
  if (initializer === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.for-in-binding",
      "for-in requires one exact binding initializer.",
    ));
    return undefined;
  }
  const binding = planForInBinding(initializer, fact.elementCarrier, context);
  if (binding === undefined) {
    return undefined;
  }
  const expressionNode = Node_Expression(ast, node);
  const expression = expressionNode === undefined ? undefined : planExpression(expressionNode, context);
  const bodyNode = ForInOrOfStatement_Statement(ast, node);
  if (expression === undefined || bodyNode === undefined || context.syntheticNames === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.for-in-shape",
      "for-in requires exact receiver, body, and hygienic-name evidence.",
    ));
    return undefined;
  }
  const target = createRustLoopTarget(context, [], sourceLabel);
  if (target === undefined) {
    return undefined;
  }
  const body = planBlockLike(bodyNode, withRustControlTarget(context, target));
  if (body === undefined) {
    return undefined;
  }
  if (fact.lowering.kind === "dense-index-keys") {
    const lengthName = allocateRustSyntheticName(context.syntheticNames, "for_in_length");
    const indexName = allocateRustSyntheticName(context.syntheticNames, "for_in_index");
    const activation = activateForInBinding(binding, {
      kind: "method-call",
      receiver: { kind: "path", path: indexName },
      method: "to_string",
      args: [],
    });
    return [{
      kind: "scope",
      body: {
        statements: [
          {
            kind: "let",
            name: lengthName,
            mutable: false,
            init: {
              kind: "method-call",
              receiver: expression,
              method: "len",
              args: [],
            },
          },
          {
            kind: "for",
            ...(target.used.value ? { label: target.label } : {}),
            binding: indexName,
            iterable: {
              kind: "range",
              start: { kind: "int-literal", text: "0" },
              end: { kind: "path", path: lengthName },
            },
            body: { statements: [...activation, ...body.statements] },
          },
        ],
      },
    }];
  }
  const keyName = binding.kind === "declaration"
    ? binding.name
    : allocateRustSyntheticName(context.syntheticNames, "for_in_key");
  const activation = binding.kind === "assignment"
    ? activateForInBinding(binding, { kind: "path", path: keyName })
    : [];
  const iterable: RustExpr = fact.lowering.kind === "js-array-index-keys"
    ? {
        kind: "method-call",
        receiver: expression,
        method: "enumerable_own_keys",
        args: [],
      }
    : {
        kind: "slice-literal",
        elements: fact.lowering.keys.map((key) => ({ kind: "string-literal", value: key })),
      };
  return [{
    kind: "scope",
    body: {
      statements: [
        ...(fact.lowering.kind === "static-keys"
          ? [{ kind: "let" as const, name: "_", mutable: false, init: { kind: "reference" as const, expr: expression } }]
          : []),
        {
          kind: "for",
          ...(target.used.value ? { label: target.label } : {}),
          binding: keyName,
          ...(binding.kind === "declaration" && binding.mutable ? { bindingMutable: true } : {}),
          iterable,
          body: { statements: [...activation, ...body.statements] },
        },
      ],
    },
  }];
}

function planForInBinding(
  initializer: Node,
  elementCarrier: TargetTypeRef,
  context: RustPlanContext,
): PlannedForInBinding | undefined {
  const declarations = collectVariableDeclarations(initializer, context);
  if (declarations.length === 1) {
    const declaration = declarations[0]!;
    const nameNode = Node_Name(context.input.ast, declaration);
    const sourceName = nameNode === undefined || context.input.ast.kindName(nameNode) !== KindIdentifier
      ? ""
      : context.input.ast.text(nameNode);
    const directName = rustSourceName(context, sourceName);
    const carrier = context.input.facts.getRuntimeCarrierFact(declaration)?.carrier;
    const declarationKind = context.input.ast.variableDeclarationKind(declaration);
    if (!isValidRustIdentifier(directName) || carrier === undefined ||
      !rustTargetTypeRefEquals(carrier, elementCarrier) ||
      declarationKind === "using" || declarationKind === "await using") {
      return rejectForInBinding(declaration, context, "for-in declarations require one plain non-resource binding with the finalized String key carrier.");
    }
    return {
      kind: "declaration",
      name: directName,
      mutable: context.input.facts.getFact(declaration, rustMutatedBindingFactKey) !== undefined,
    };
  }
  if (context.input.ast.kindName(initializer) !== KindIdentifier) {
    return rejectForInBinding(initializer, context, "for-in assignment targets require one exact identifier location.");
  }
  const sourceName = context.input.ast.text(initializer);
  const assignmentName = rustSourceName(context, sourceName);
  const carrier = context.input.facts.getRuntimeCarrierFact(initializer)?.carrier;
  if (!isValidRustIdentifier(assignmentName) || carrier === undefined ||
    !rustTargetTypeRefEquals(carrier, elementCarrier)) {
    return rejectForInBinding(initializer, context, "for-in assignment targets require one mutable String binding with exact source identity.");
  }
  return { kind: "assignment", name: assignmentName };
}

function activateForInBinding(
  binding: PlannedForInBinding,
  value: RustExpr,
): readonly RustStmt[] {
  if (binding.kind === "declaration") {
    return [{ kind: "let", name: binding.name, mutable: binding.mutable, init: value }];
  }
  return [{
    kind: "assign",
    target: { kind: "path", path: binding.name },
    operator: "=",
    value,
  }];
}

function rejectForInBinding(
  node: Node,
  context: RustPlanContext,
  message: string,
): undefined {
  context.diagnostics.push(unsupportedConstructDiagnostic(
    diagnosticInput(context, node),
    "rust.backend.for-in-binding",
    message,
  ));
  return undefined;
}

function planThrowStatement(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
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

function planTryStatement(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
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
    const bindingNode = Node_Name(
      context.input.ast,
      CatchClause_VariableDeclaration(context.input.ast, catchClause),
    );
    const bindingSource = bindingNode === undefined ? "" : ast.text(bindingNode);
    let binding = bindingSource.length === 0 ? "_" : rustSourceName(context, bindingSource);
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
