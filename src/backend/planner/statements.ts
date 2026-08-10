import type { Node } from "@tsonic/tsts";
import { rustTargetTypeRefEquals } from "../../policy/equality.js";
import type { TargetTypeRef } from "../../policy/types.js";
import { isRustAssignmentOperator } from "../../common/rust-syntax.js";
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
  KindDoStatement,
  KindEmptyStatement,
  KindEqualsToken,
  KindExpressionStatement,
  KindForStatement,
  KindForInStatement,
  KindIdentifier,
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
  KindWhileStatement,
  Node_Expression,
  Node_Initializer,
  Node_Name,
  Node_Type,
  Node_Operand,
} from "../../common/source-ast.js";
import { rustMutatedBindingFactKey, rustMutatedReferentFactKey, rustResourceManagementFactKey, rustTargetOperationFactKey } from "../../source/rust-facts/keys.js";
import type { RustResourceManagementFact } from "../../source/rust-facts/keys.js";
import { rustTypeFromCarrierInContext as renderRustTypeInContext } from "./render-types.js";
import {
  isRustBoolCarrier,
  isRustUnitCarrier,
  rustLocationTargetType,
} from "../../source/rust-target-types.js";
import { validateRustFinalizedOperationAbi } from "../../source/rust-facts/finalized-operation-abi.js";
import { rustTargetOperationIsDirectLocation } from "../../source/rust-facts/target-operation.js";
import type { RustBlock, RustExpr, RustStmt } from "../rust-ast/nodes.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "./diagnostics.js";
import {
  expressionCarrier,
  planExpression,
  planFinalizedSourceInput,
  planFinalizedTargetInput,
  providerSelectedCallMatches,
  requireProviderArgumentPassingFacts,
} from "./expressions.js";
import { diagnosticInput, isValidRustIdentifier, registerAliasFromPath, rustSourceName } from "./plan-context.js";
import type { RustCompletionBoundary, RustControlTarget, RustLoopTarget, RustPlanContext } from "./plan-context.js";
import { allocateRustSyntheticName } from "./synthetic-names.js";
import { rustTypeFromCarrierInContext } from "./render-types.js";
import {
  planRustPromotedStorageWrite,
  rustLocationStorageForDeclaration,
} from "./typed-locations.js";
import { requireRustLocationValueCarrier } from "./generic-requirements.js";

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
      return planReturnStatement(planned, context);
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

function planStatementSequence(
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
  const boundary: RustCompletionBoundary = {
    ...(context.completionBoundary === undefined
      ? {}
      : { parent: context.completionBoundary }),
    returnType: context.functionReturnType ?? { kind: "unit" },
    fallible: context.fallibleContext === true,
    asynchronous: context.asyncContext === true,
    dispatchReturn: { value: false },
    dispatchTargets: new Map(),
  };
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

function planReturnStatement(
  expression: RustExpr | undefined,
  context: RustPlanContext,
): readonly RustStmt[] {
  const boundary = context.completionBoundary;
  if (boundary === undefined) {
    return [{ kind: "return", ...(expression === undefined ? {} : { expr: expression }) }];
  }
  let outermost = boundary;
  while (outermost.parent !== undefined) {
    outermost = outermost.parent;
  }
  outermost.dispatchReturn.value = true;
  context.usedAliases?.add("rt");
  return [{
    kind: "completion-exit",
    completion: "return",
    resultWrapped: boundary.fallible,
    ...(expression === undefined ? {} : { expr: expression }),
  }];
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
  if (last.kind === "scope") {
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
  } else if (last.kind === "scope") {
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
  const { ast } = context.input;
  const declarations = collectVariableDeclarations(node, context);
  if (declarations.length !== 1) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.variable",
      "Variable statements must declare exactly one binding.",
    ));
    return undefined;
  }
  const declaration = declarations[0];
  if (declaration === undefined) {
    return undefined;
  }
  const nameNode = Node_Name(context.input.ast, declaration);
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
  if (initializer === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.variable",
      "Variable declarations require an initializer.",
    ));
    return undefined;
  }
  const initializerFact = context.input.facts.getFact(initializer, rustTargetOperationFactKey);
  const locationStorage = rustLocationStorageForDeclaration(declaration, context);
  if (initializerFact !== undefined && initializerFact.kind === "array-literal" && initializerFact.lane === "sparse") {
    if (locationStorage !== undefined) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, declaration),
        "rust.backend.typed-location-storage",
        "Sparse JavaScript array storage cannot be promoted to a Rust typed location.",
      ));
      return undefined;
    }
    return planSparseArrayLet(node, declaration, name, initializer, initializerFact, context);
  }
  const planned = planExpression(initializer, context);
  if (planned === undefined) {
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
  if (context.emittedLocalNames !== undefined) {
    if (context.emittedLocalNames.has(name)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, declaration),
        "rust.backend.naming",
        `Binding '${sourceName}' collides with another binding in the same scope.`,
      ));
      return undefined;
    }
    context.emittedLocalNames.add(name);
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
  const init = locationStorage === undefined
    ? planned
    : (() => {
        if (!requireRustLocationValueCarrier(
          locationStorage.valueCarrier,
          declaration,
          context,
        )) {
          return undefined;
        }
        context.usedAliases?.add("rt");
        return { kind: "call", path: "rt::Location::allocate", args: [planned] } as const;
      })();
  if (init === undefined) {
    return undefined;
  }
  return [{
    kind: "let",
    name,
    mutable,
    ...(rustType === undefined ? {} : { type: rustType }),
    init,
  }];
}

function planUpdateStatement(expression: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const { ast } = context.input;
  const fact = context.input.facts.getFact(expression, rustTargetOperationFactKey);
  if (fact === undefined || fact.kind !== "operator-token" || (fact.operator !== "+=" && fact.operator !== "-=")) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, expression),
      "rust.backend.operator",
      "Increment/decrement requires a finalized Rust update-operator fact.",
    ));
    return undefined;
  }
  if (!selectedOperatorMatches(expression, fact, context)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, expression),
      "rust.backend.operator-selected-evidence",
      "Update operation fact conflicts with the TSTS-selected operator fact.",
    ));
    return undefined;
  }
  const operand = Node_Operand(context.input.ast, expression);
  if (operand === undefined || ast.kindName(operand) !== KindIdentifier) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, expression),
      "rust.backend.operator",
      "Increment/decrement targets must be identifiers.",
    ));
    return undefined;
  }
  const target = rustSourceName(context, ast.text(operand));
  if (!isValidRustIdentifier(target)) {
    return undefined;
  }
  const promoted = planRustPromotedStorageWrite(
    operand,
    fact.operator,
    { kind: "int-literal", text: "1" },
    context,
    planExpression,
  );
  if (promoted.handled) {
    return promoted.statement === undefined ? undefined : [promoted.statement];
  }
  return [{ kind: "assign", target: { kind: "path", path: target }, operator: fact.operator, value: { kind: "int-literal", text: "1" } }];
}

function planExpressionStatement(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const { ast } = context.input;
  const expression = Node_Expression(context.input.ast, node);
  if (expression === undefined) {
    return undefined;
  }
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
    let selectedAssignmentFact: Extract<
      import("../../source/rust-facts/keys.js").RustTargetOperationFact,
      { kind: "operator-token" }
    > | undefined;
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
      const target = ast.kindName(left) === KindIdentifier
        ? (() => {
            const path = rustSourceName(context, ast.text(left));
            return isValidRustIdentifier(path) ? { kind: "path" as const, path } : undefined;
          })()
        : rustTargetOperationIsDirectLocation(
            context.input.facts.getFact(left, rustTargetOperationFactKey),
          )
          ? planExpression(left, context)
          : undefined;
      if (target === undefined) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, expression),
          "rust.backend.assignment",
          "Assignments require a plain binding or a finalized direct Rust location.",
        ));
        return undefined;
      }
      const fact = selectedAssignmentFact ??
        context.input.facts.getFact(expression, rustTargetOperationFactKey);
      if (fact === undefined || fact.kind !== "operator-token") {
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
      const value = planExpression(valueNode, context);
      if (value === undefined) {
        return undefined;
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
    return planUpdateStatement(expression, context);
  }
  if (expressionKind === KindCallExpression || expressionKind === "KindAwaitExpression" ||
    expressionKind === "KindYieldExpression") {
    const planned = planExpression(expression, context);
    return planned === undefined ? undefined : [{ kind: "expr", expr: planned }];
  }
  context.diagnostics.push(unsupportedConstructDiagnostic(
    diagnosticInput(context, node),
    "rust.backend.statement",
    "Expression statements support only calls, assignments, increments, awaits, and checked generator yields.",
  ));
  return undefined;
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
  return body === undefined ? undefined : [{
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
  const { ast } = context.input;
  const kind = ast.kindName(node);
  if (kind === KindPostfixUnaryExpression || kind === KindPrefixUnaryExpression) {
    return planUpdateStatement(node, context);
  }
  context.diagnostics.push(unsupportedConstructDiagnostic(
    diagnosticInput(context, node),
    "rust.backend.loop",
    "For incrementors support only increment/decrement of an identifier.",
  ));
  return undefined;
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
  if (receiverNode === undefined || fact.abi.targetReceiver.kind !== "input" ||
    fact.abi.targetReceiver.input.mode !== "mut-ref") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, expression),
      "rust.backend.runtime-set-receiver",
      "Runtime setter ABI has no finalized target receiver input.",
    ));
    return undefined;
  }
  const receiver = planFinalizedSourceInput(
    context,
    fact.abi.targetReceiver.input,
    receiverNode,
    sourceArgumentNodes,
    expression,
    "target-receiver",
  );
  if (receiver === undefined) {
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
    if (index === undefined || value === undefined || targetArguments.length !== 2) {
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
  if (fact.abi.target.form === "receiver-method") {
    return [{
      kind: "expr",
      expr: { kind: "method-call", receiver, method: fact.abi.target.name, args: targetArguments },
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
  fact: Extract<import("../../source/rust-facts/keys.js").RustTargetOperationFact, { kind: "operator-token" }>,
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
  let binding = "";
  if (bindingDeclaration !== undefined) {
    const nameNode = Node_Name(context.input.ast, bindingDeclaration);
    binding = nameNode !== undefined && ast.kindName(nameNode) === KindIdentifier ? rustSourceName(context, ast.text(nameNode)) : "";
  }
  if (!isValidRustIdentifier(binding)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.loop",
      "for-of bindings require a plain identifier.",
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
  const resourceFact = resourceBinding && bindingDeclaration !== undefined
    ? resourceFactForPlanning(bindingDeclaration, context)
    : undefined;
  if (resourceBinding && resourceFact === undefined) {
    return undefined;
  }
  const body = resourceFact === undefined || bindingDeclaration === undefined
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
  const targetIterable: RustExpr = fact.lowering.kind === "borrowed"
    ? {
        kind: "method-call",
        receiver: { kind: "method-call", receiver: iterable, method: "iter", args: [] },
        method: fact.lowering.style,
        args: [],
      }
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
    (fact.lowering.kind !== "dense-index-keys" && fact.lowering.kind !== "sparse-index-keys" &&
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
  const iterable: RustExpr = fact.lowering.kind === "sparse-index-keys"
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

function planSparseArrayLet(
  statement: Node,
  declaration: Node,
  name: string,
  initializer: Node,
  fact: Extract<import("../../source/rust-facts/keys.js").RustTargetOperationFact, { kind: "array-literal" }>,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const { ast } = context.input;
  const elementType = renderRustTypeInContext(fact.elementCarrier, context);
  const arrayType = renderRustTypeInContext(fact.resultCarrier, context);
  if (elementType === undefined || arrayType === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, declaration),
      "rust.js.sparse-array",
      "Sparse array lane carrier cannot be rendered.",
    ));
    return undefined;
  }
  context.usedAliases?.add("js_abi");
  const statements: RustStmt[] = [{
    kind: "let",
    name,
    mutable: true,
    type: arrayType,
    init: {
      kind: "call",
      path: "js_abi::JsArray::with_length",
      args: [{ kind: "int-literal", text: String(fact.length) }],
    },
  }];
  const elements = ast.elements(initializer);
  for (const [index, element] of elements.entries()) {
    if (element === undefined || ast.kindName(element) === "KindOmittedExpression") {
      continue;
    }
    const planned = planExpression(element, context);
    if (planned === undefined) {
      return undefined;
    }
    statements.push({
      kind: "expr",
      expr: {
        kind: "method-call",
        receiver: { kind: "path", path: name },
        method: "set",
        args: [{ kind: "int-literal", text: String(index) }, planned],
      },
    });
  }
  void statement;
  return statements;
}

function planThrowStatement(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const fact = context.input.facts.getFact(node, rustTargetOperationFactKey);
  if (fact === undefined || fact.kind !== "throw-op") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.error.throw",
      "throw supports only `throw new Error(message)` with a finalized throw fact.",
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
  const { ast } = context.input;
  const newExpression = Node_Expression(context.input.ast, node);
  const arguments_ = newExpression === undefined ? [] : ast.arguments(newExpression);
  const [messageNode] = arguments_;
  if (newExpression === undefined || ast.kindName(newExpression) !== "KindNewExpression" ||
    messageNode === undefined || arguments_.length !== 1) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.throw-shape",
      "Finalized throw fact must correspond to exactly `throw new Error(message)`.",
    ));
    return undefined;
  }
  const constructor = context.input.facts.getFact(newExpression, rustTargetOperationFactKey);
  if (constructor === undefined || constructor.kind !== "provider-operation" ||
    constructor.operationId !== fact.constructorOperationId || constructor.abi.operationKind !== "constructor" ||
    !providerSelectedCallMatches(newExpression, constructor, context)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, newExpression),
      "rust.backend.throw-constructor",
      "Finalized throw fact conflicts with the selected provider Error constructor ABI.",
    ));
    return undefined;
  }
  if (!requireProviderArgumentPassingFacts(context, constructor, arguments_)) {
    return undefined;
  }
  const message = planExpression(messageNode, context);
  if (message !== undefined) {
    context.usedAliases?.add("rt");
  }
  return message === undefined ? undefined : [{ kind: "throw", message }];
}

function planTryStatement(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const { ast } = context.input;
  const tryBlock = TryStatement_TryBlock(context.input.ast, node);
  const catchClause = TryStatement_CatchClause(context.input.ast, node);
  const catchBlock = CatchClause_Block(context.input.ast, catchClause);
  const finallyBlock = TryStatement_FinallyBlock(context.input.ast, node);
  if (tryBlock === undefined || catchBlock === undefined || finallyBlock !== undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.error.try",
      "try statements require a catch clause and no finally block.",
    ));
    return undefined;
  }
  // The try body lowers into a Result-returning closure; control flow that
  // escapes the closure is unrepresentable.
  let escapes = false;
  const scan = (candidate: Node): void => {
    if (escapes) {
      return;
    }
    const kind = ast.kindName(candidate);
    // Nested functions are their own control-flow boundary.
    if (kind === "KindArrowFunction" || kind === "KindFunctionExpression" || kind === "KindFunctionDeclaration") {
      return;
    }
    if (kind === KindReturnStatement || kind === "KindBreakStatement" || kind === "KindContinueStatement") {
      escapes = true;
      return;
    }
    ast.forEachChild(candidate, (child) => {
      if (child !== undefined) {
        scan(child);
      }
    });
  };
  scan(tryBlock);
  if (escapes) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.error.try",
      "try blocks must not contain return, break, or continue.",
    ));
    return undefined;
  }
  const tryContext: RustPlanContext = { ...context, fallibleContext: true };
  const body = planBlockLike(tryBlock, tryContext);
  const catchBody = planBlockLike(catchBlock, context);
  if (body === undefined || catchBody === undefined) {
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
  context.usedAliases?.add("rt");
  return [{ kind: "try-catch", body, catchBinding: binding, catchBody }];
}
