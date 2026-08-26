import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import {
  BinaryExpression_Left,
  BinaryExpression_Right,
  BreakOrContinueStatement_Label,
  CaseBlock_Clauses,
  CaseOrDefaultClause_Expression,
  CaseOrDefaultClause_Statements,
  CatchClause_Block,
  CatchClause_VariableDeclaration,
  ConditionalExpression_Condition,
  ConditionalExpression_WhenFalse,
  ConditionalExpression_WhenTrue,
  DoStatement_Statement,
  ForInOrOfStatement_Initializer,
  ForInOrOfStatement_Statement,
  ForStatement_Condition,
  ForStatement_Incrementor,
  ForStatement_Initializer,
  IfStatement_ElseStatement,
  IfStatement_ThenStatement,
  IterationStatement_Statement,
  LabeledStatement_Label,
  LabeledStatement_Statement,
  Node_Expression,
  SwitchStatement_CaseBlock,
  SwitchStatement_Expression,
  TryStatement_CatchClause,
  TryStatement_FinallyBlock,
  TryStatement_TryBlock,
} from "@tsonic/target-api/source";
import type { RustLexicalRegionIndex } from "./lexical-regions.js";
import {
  rustFlowConstructionDepthComplexityDiagnostic,
} from "./complexity.js";
import { requireRustOwnershipSourceIdentity } from "./identity.js";
import type {
  RustSourceFlowEffects,
  RustSourceFlowGraph,
  RustSourceFlowPoint,
  RustSourceResourceCleanupEffect,
} from "./control-flow.js";
import {
  FlowLimitError,
  FlowShapeError,
} from "./control-flow-errors.js";
import {
  RustSourceFlowGraphDraft,
} from "./control-flow-graph.js";
import {
  rustSourceFlowContextThroughCompletion,
  rustSourceFlowLoopBodyContext,
  rustSourceFlowWithoutPendingLoopLabels,
  type RustSourceFlowContext,
} from "./control-flow-context.js";
import {
  collectRustSourceCallables,
  isRustSourceFlowCallable,
  isRustSourceFlowIterationKind,
  isRustSourceFlowShortCircuitOperator,
  requireRustSourceFlowNode,
  rustSourceFlowCleanupPoint,
  rustSourceFlowDenseNodes,
  rustSourceFlowDenseStatements,
  rustSourceFlowDirectResourceDeclaration,
  rustSourceFlowNodePoint,
  rustSourceFlowResourceDeclarationForInitializer,
} from "./control-flow-source-shape.js";

interface FlowFragment {
  readonly entry: number;
  readonly exits: readonly number[];
}

export function buildRustSourceFlowGraphInternal(
  ast: AstReader,
  sourceFiles: readonly SourceFile[],
  lexicalRegions: RustLexicalRegionIndex,
  effects: RustSourceFlowEffects,
): RustSourceFlowGraph {
  return new SourceFlowGraphBuilder(ast, sourceFiles, lexicalRegions, effects).build();
}

class SourceFlowGraphBuilder {
  readonly #ast: AstReader;
  readonly #sourceFiles: readonly SourceFile[];
  readonly #lexicalRegions: RustLexicalRegionIndex;
  readonly #effects: RustSourceFlowEffects;
  readonly #graph = new RustSourceFlowGraphDraft();
  readonly #callables: Node[] = [];
  readonly #callableSet = new WeakSet<Node>();
  #constructionDepth = 0;

  constructor(
    ast: AstReader,
    sourceFiles: readonly SourceFile[],
    lexicalRegions: RustLexicalRegionIndex,
    effects: RustSourceFlowEffects,
  ) {
    this.#ast = ast;
    this.#sourceFiles = sourceFiles;
    this.#lexicalRegions = lexicalRegions;
    this.#effects = effects;
  }

  build(): RustSourceFlowGraph {
    for (const sourceFile of this.#sourceFiles) {
      for (const callable of collectRustSourceCallables(sourceFile, this.#ast)) {
        if (this.#callableSet.has(callable)) continue;
        this.#callableSet.add(callable);
        this.#callables.push(callable);
      }
      this.#buildRegion(sourceFile, undefined);
    }
    for (const callable of this.#callables) {
      this.#buildRegion(callable, callable);
    }
    return this.#graph.seal();
  }

  #buildRegion(owner: SourceFile | Node, rootCallable: Node | undefined): void {
    const ownerIdentity = requireRustOwnershipSourceIdentity(this.#ast, owner);
    const regionId = `rust-flow\0${ownerIdentity}`;
    const lexicalRegionId = this.#lexicalRegions.ownedRegionFor(owner)?.id ??
      this.#lexicalRegions.regionFor(owner)?.id;
    if (lexicalRegionId === undefined) {
      throw new FlowShapeError("Rust flow owner has no exact lexical region.");
    }
    const entry = this.#syntheticPoint(regionId, "entry", "entry", lexicalRegionId);
    const exit = this.#syntheticPoint(regionId, "exit", "exit", undefined);
    const record = { owner, regionId, entry, exit };
    this.#graph.registerRegion(record);
    const context: RustSourceFlowContext = {
      regionId,
      lexicalRegionId,
      ...(rootCallable === undefined ? {} : { rootCallable }),
      returnTarget: exit,
      throwTarget: exit,
      labeledTargets: new Map(),
      pendingLoopLabels: Object.freeze([]),
    };
    const body = rootCallable === undefined
      ? this.#sequence(rustSourceFlowDenseStatements(owner, this.#ast), context)
      : this.#callableBody(rootCallable, context);
    if (body === undefined) {
      this.#connect(entry, exit);
      return;
    }
    this.#connect(entry, body.entry);
    for (const normalExit of body.exits) this.#connect(normalExit, exit);
  }

  #callableBody(callable: Node, context: RustSourceFlowContext): FlowFragment | undefined {
    const parameters = rustSourceFlowDenseNodes(
      this.#ast.parameters(callable),
      "Callable contains an undefined or non-data parameter slot.",
    );
    const body = this.#ast.body(callable);
    const fragments = parameters.flatMap((parameter) => {
      const fragment = this.#generic(parameter, context);
      return fragment === undefined ? [] : [fragment];
    });
    if (body !== undefined) {
      const bodyFragment = this.#ast.kindName(body) === "KindBlock"
        ? this.#sequence(rustSourceFlowDenseStatements(body, this.#ast), context)
        : this.#buildNode(body, context);
      if (bodyFragment !== undefined) fragments.push(bodyFragment);
    }
    return this.#compose(fragments);
  }

  #buildNode(node: Node, context: RustSourceFlowContext): FlowFragment {
    this.#constructionDepth += 1;
    const depthDiagnostic = rustFlowConstructionDepthComplexityDiagnostic(this.#constructionDepth);
    if (depthDiagnostic !== undefined) {
      this.#constructionDepth -= 1;
      throw new FlowLimitError(depthDiagnostic.code, depthDiagnostic.message);
    }
    try {
      return this.#buildNodeAtDepth(node, context);
    } finally {
      this.#constructionDepth -= 1;
    }
  }

  #buildNodeAtDepth(node: Node, context: RustSourceFlowContext): FlowFragment {
    context = Object.freeze({
      ...context,
      lexicalRegionId: this.#lexicalRegions.regionFor(node)?.id ?? context.lexicalRegionId,
    });
    this.#graph.setRegionForNode(node, context.regionId);
    const kind = this.#ast.kindName(node);
    if (kind === "KindLabeledStatement") {
      return this.#labeledStatement(node, context);
    }
    if (!isRustSourceFlowIterationKind(kind) && context.pendingLoopLabels.length > 0) {
      context = rustSourceFlowWithoutPendingLoopLabels(context);
    }
    if (kind === "KindBlock" || kind === "KindSourceFile") {
      const statements = this.#sequence(rustSourceFlowDenseStatements(node, this.#ast), context);
      const completion = this.#nodePoint(node, context.regionId);
      if (statements === undefined) return { entry: completion, exits: [completion] };
      for (const exit of statements.exits) this.#connect(exit, completion);
      return { entry: statements.entry, exits: [completion] };
    }
    if (isRustSourceFlowCallable(node, this.#ast) && node !== context.rootCallable) {
      return this.#atomic(node, context.regionId);
    }
    switch (kind) {
      case "KindIfStatement":
        return this.#ifStatement(node, context);
      case "KindConditionalExpression":
        return this.#conditionalExpression(node, context);
      case "KindWhileStatement":
        return this.#whileStatement(node, context);
      case "KindDoStatement":
        return this.#doStatement(node, context);
      case "KindForStatement":
        return this.#forStatement(node, context);
      case "KindForInStatement":
      case "KindForOfStatement":
        return this.#forInOrOfStatement(node, context);
      case "KindSwitchStatement":
        return this.#switchStatement(node, context);
      case "KindTryStatement":
        return this.#tryStatement(node, context);
      case "KindReturnStatement":
        return this.#abruptStatement(
          node,
          context,
          context.returnTarget,
          Node_Expression(this.#ast, node),
        );
      case "KindThrowStatement":
        return this.#abruptStatement(
          node,
          context,
          context.throwTarget,
          requireRustSourceFlowNode(
            Node_Expression(this.#ast, node),
            "Throw statement has no exact expression.",
          ),
        );
      case "KindBreakStatement":
        return this.#breakOrContinueStatement(node, context, "break");
      case "KindContinueStatement":
        return this.#breakOrContinueStatement(node, context, "continue");
      case "KindBinaryExpression":
        if (isRustSourceFlowShortCircuitOperator(this.#ast.operatorKindName(node))) {
          return this.#shortCircuitExpression(node, context);
        }
        return this.#generic(node, context);
      default:
        return this.#generic(node, context);
    }
  }

  #labeledStatement(node: Node, context: RustSourceFlowContext): FlowFragment {
    const labelNode = requireRustSourceFlowNode(
      LabeledStatement_Label(this.#ast, node),
      "Labeled statement has no exact label.",
    );
    const statement = requireRustSourceFlowNode(
      LabeledStatement_Statement(this.#ast, node),
      "Labeled statement has no exact body.",
    );
    const label = this.#ast.text(labelNode);
    if (label.length === 0) {
      throw new FlowShapeError("Labeled statement has no exact label or body.");
    }
    if (context.labeledTargets.has(label)) {
      throw new FlowShapeError(`Labeled statement reuses active label '${label}'.`);
    }
    const join = this.#nodePoint(node, context.regionId);
    const labeledTargets = new Map(context.labeledTargets);
    labeledTargets.set(label, Object.freeze({ breakTarget: join }));
    const body = this.#buildNode(statement, {
      ...context,
      labeledTargets,
      pendingLoopLabels: Object.freeze([...context.pendingLoopLabels, label]),
    });
    for (const exit of body.exits) this.#connect(exit, join);
    return { entry: body.entry, exits: [join] };
  }

  #ifStatement(node: Node, context: RustSourceFlowContext): FlowFragment {
    const condition = requireRustSourceFlowNode(
      Node_Expression(this.#ast, node),
      "If statement has no exact condition.",
    );
    const thenNode = requireRustSourceFlowNode(
      IfStatement_ThenStatement(this.#ast, node),
      "If statement has no exact consequent.",
    );
    const elseNode = IfStatement_ElseStatement(this.#ast, node);
    const conditionFlow = this.#buildNode(condition, context);
    const join = this.#nodePoint(node, context.regionId);
    const thenFlow = this.#buildNode(thenNode, context);
    const elseFlow = elseNode === undefined ? undefined : this.#buildNode(elseNode, context);
    for (const exit of conditionFlow.exits) {
      this.#connect(exit, thenFlow.entry);
      this.#connect(exit, elseFlow?.entry ?? join);
    }
    for (const exit of thenFlow.exits) this.#connect(exit, join);
    for (const exit of elseFlow?.exits ?? []) this.#connect(exit, join);
    return { entry: conditionFlow.entry, exits: [join] };
  }

  #conditionalExpression(node: Node, context: RustSourceFlowContext): FlowFragment {
    const condition = requireRustSourceFlowNode(
      ConditionalExpression_Condition(this.#ast, node),
      "Conditional expression has no exact condition.",
    );
    const whenTrue = requireRustSourceFlowNode(
      ConditionalExpression_WhenTrue(this.#ast, node),
      "Conditional expression has no exact true branch.",
    );
    const whenFalse = requireRustSourceFlowNode(
      ConditionalExpression_WhenFalse(this.#ast, node),
      "Conditional expression has no exact false branch.",
    );
    const conditionFlow = this.#buildNode(condition, context);
    const trueFlow = this.#buildNode(whenTrue, context);
    const falseFlow = this.#buildNode(whenFalse, context);
    const join = this.#nodePoint(node, context.regionId);
    for (const exit of conditionFlow.exits) {
      this.#connect(exit, trueFlow.entry);
      this.#connect(exit, falseFlow.entry);
    }
    for (const exit of trueFlow.exits) this.#connect(exit, join);
    for (const exit of falseFlow.exits) this.#connect(exit, join);
    return { entry: conditionFlow.entry, exits: [join] };
  }

  #shortCircuitExpression(node: Node, context: RustSourceFlowContext): FlowFragment {
    const left = requireRustSourceFlowNode(
      BinaryExpression_Left(this.#ast, node),
      "Short-circuit expression has no exact left operand.",
    );
    const right = requireRustSourceFlowNode(
      BinaryExpression_Right(this.#ast, node),
      "Short-circuit expression has no exact right operand.",
    );
    const leftFlow = this.#buildNode(left, context);
    const rightFlow = this.#buildNode(right, context);
    const join = this.#nodePoint(node, context.regionId);
    for (const exit of leftFlow.exits) {
      this.#connect(exit, rightFlow.entry);
      this.#connect(exit, join);
    }
    for (const exit of rightFlow.exits) this.#connect(exit, join);
    return { entry: leftFlow.entry, exits: [join] };
  }

  #whileStatement(node: Node, context: RustSourceFlowContext): FlowFragment {
    const join = this.#nodePoint(node, context.regionId);
    const loopContext = rustSourceFlowWithoutPendingLoopLabels(context);
    const conditionNode = requireRustSourceFlowNode(
      Node_Expression(this.#ast, node),
      "While statement has no exact condition.",
    );
    const condition = this.#buildNode(conditionNode, loopContext);
    const bodyNode = requireRustSourceFlowNode(
      IterationStatement_Statement(this.#ast, node),
      "While statement has no exact body.",
    );
    const body = this.#buildNode(
      bodyNode,
      rustSourceFlowLoopBodyContext(context, join, condition.entry),
    );
    for (const exit of condition.exits) {
      this.#connect(exit, body.entry);
      this.#connect(exit, join);
    }
    for (const exit of body.exits) this.#connect(exit, condition.entry);
    return { entry: condition.entry, exits: [join] };
  }

  #doStatement(node: Node, context: RustSourceFlowContext): FlowFragment {
    const join = this.#nodePoint(node, context.regionId);
    const loopContext = rustSourceFlowWithoutPendingLoopLabels(context);
    const conditionNode = requireRustSourceFlowNode(
      Node_Expression(this.#ast, node),
      "Do statement has no exact condition.",
    );
    const condition = this.#buildNode(conditionNode, loopContext);
    const bodyNode = requireRustSourceFlowNode(
      DoStatement_Statement(this.#ast, node),
      "Do statement has no exact body.",
    );
    const body = this.#buildNode(
      bodyNode,
      rustSourceFlowLoopBodyContext(context, join, condition.entry),
    );
    for (const exit of body.exits) this.#connect(exit, condition.entry);
    for (const exit of condition.exits) {
      this.#connect(exit, body.entry);
      this.#connect(exit, join);
    }
    return { entry: body.entry, exits: [join] };
  }

  #forStatement(node: Node, context: RustSourceFlowContext): FlowFragment {
    const join = this.#nodePoint(node, context.regionId);
    const loopContext = rustSourceFlowWithoutPendingLoopLabels(context);
    const loopRegionId = this.#lexicalRegions.ownedRegionFor(node)?.id ?? context.lexicalRegionId;
    const initializerNode = ForStatement_Initializer(this.#ast, node);
    const conditionNode = ForStatement_Condition(this.#ast, node);
    const incrementNode = ForStatement_Incrementor(this.#ast, node);
    const resourceDeclaration = initializerNode === undefined
      ? undefined
      : rustSourceFlowResourceDeclarationForInitializer(initializerNode, this.#ast);
    const initializer = initializerNode === undefined
      ? undefined
      : this.#buildNode(initializerNode, loopContext);
    const resourceEffect = resourceDeclaration === undefined
      ? undefined
      : this.#effects.resourceCleanupFor(resourceDeclaration);
    if (resourceDeclaration !== undefined && resourceEffect === undefined) {
      throw new FlowShapeError(
        "Rust ownership flow has no finalized cleanup effect for a for-loop resource initializer.",
      );
    }
    const resourceScope = resourceDeclaration === undefined || resourceEffect === undefined
      ? undefined
      : this.#resourceCleanupScope(resourceDeclaration, resourceEffect, context);
    const activeContext = resourceScope?.context ?? context;
    const loopEvaluationContext = rustSourceFlowWithoutPendingLoopLabels(activeContext);
    const loopExit = resourceScope?.route(join) ?? join;
    const condition = conditionNode === undefined
      ? this.#syntheticFragment(context.regionId, "for-condition", loopRegionId)
      : this.#buildNode(conditionNode, loopEvaluationContext);
    const increment = incrementNode === undefined
      ? this.#syntheticFragment(context.regionId, "for-increment", loopRegionId)
      : this.#buildNode(incrementNode, loopEvaluationContext);
    const bodyNode = requireRustSourceFlowNode(
      IterationStatement_Statement(this.#ast, node),
      "For statement has no exact body.",
    );
    const body = this.#buildNode(
      bodyNode,
      rustSourceFlowLoopBodyContext(activeContext, loopExit, increment.entry),
    );
    for (const exit of initializer?.exits ?? []) this.#connect(exit, condition.entry);
    for (const exit of condition.exits) {
      this.#connect(exit, body.entry);
      if (conditionNode !== undefined) this.#connect(exit, loopExit);
    }
    for (const exit of body.exits) this.#connect(exit, increment.entry);
    for (const exit of increment.exits) this.#connect(exit, condition.entry);
    return { entry: initializer?.entry ?? condition.entry, exits: [join] };
  }

  #forInOrOfStatement(node: Node, context: RustSourceFlowContext): FlowFragment {
    const join = this.#syntheticPoint(
      context.regionId,
      "join",
      "for-in-or-of-exit",
      context.lexicalRegionId,
    );
    const step = this.#nodePoint(node, context.regionId);
    const stepMayThrow = this.#effects.nodeMayThrow(node);
    if (stepMayThrow === undefined) {
      throw new FlowShapeError(
        "Rust ownership flow has no finalized execution effects for an exact iteration operation.",
      );
    }
    if (stepMayThrow) this.#connect(step, context.throwTarget);
    const loopContext = rustSourceFlowWithoutPendingLoopLabels(context);
    const expressionNode = requireRustSourceFlowNode(
      Node_Expression(this.#ast, node),
      "Iteration statement has no exact iterable expression.",
    );
    const initializerNode = requireRustSourceFlowNode(
      ForInOrOfStatement_Initializer(this.#ast, node),
      "Iteration statement has no exact binding or assignment target.",
    );
    const resourceDeclaration = rustSourceFlowResourceDeclarationForInitializer(
      initializerNode,
      this.#ast,
    );
    const iterable = this.#buildNode(expressionNode, loopContext);
    const initializer = this.#buildNode(initializerNode, loopContext);
    const resourceEffect = resourceDeclaration === undefined
      ? undefined
      : this.#effects.resourceCleanupFor(resourceDeclaration);
    if (resourceDeclaration !== undefined && resourceEffect === undefined) {
      throw new FlowShapeError(
        "Rust ownership flow has no finalized cleanup effect for an iteration resource binding.",
      );
    }
    const resourceScope = resourceDeclaration === undefined || resourceEffect === undefined
      ? undefined
      : this.#resourceCleanupScope(resourceDeclaration, resourceEffect, context);
    const breakTarget = resourceScope?.route(join) ?? join;
    const continueTarget = resourceScope?.route(step) ?? step;
    const bodyContext = resourceScope?.context ?? context;
    const bodyNode = requireRustSourceFlowNode(
      ForInOrOfStatement_Statement(this.#ast, node),
      "Iteration statement has no exact body.",
    );
    const body = this.#buildNode(
      bodyNode,
      rustSourceFlowLoopBodyContext(bodyContext, breakTarget, continueTarget),
    );
    for (const exit of iterable.exits) this.#connect(exit, step);
    this.#connect(step, initializer.entry);
    this.#connect(step, join);
    for (const exit of initializer.exits) this.#connect(exit, body.entry);
    for (const exit of body.exits) this.#connect(exit, continueTarget);
    return { entry: iterable.entry, exits: [join] };
  }

  #switchStatement(node: Node, context: RustSourceFlowContext): FlowFragment {
    const join = this.#nodePoint(node, context.regionId);
    const expressionNode = requireRustSourceFlowNode(
      SwitchStatement_Expression(this.#ast, node),
      "Switch statement has no exact expression.",
    );
    const expression = this.#buildNode(expressionNode, context);
    const caseBlock = requireRustSourceFlowNode(
      SwitchStatement_CaseBlock(this.#ast, node),
      "Switch statement has no exact case block.",
    );
    const clauses = rustSourceFlowDenseNodes(
      CaseBlock_Clauses(this.#ast, caseBlock),
      "Switch statement contains an absent, undefined, or non-data clause list.",
    );
    if (clauses.length === 0) {
      for (const exit of expression.exits) this.#connect(exit, join);
      return { entry: expression.entry, exits: [join] };
    }
    const clauseBodies = clauses.map((clause) => {
      const test = CaseOrDefaultClause_Expression(this.#ast, clause);
      const statements = rustSourceFlowDenseNodes(
        CaseOrDefaultClause_Statements(this.#ast, clause),
        "Switch clause contains an absent, undefined, or non-data statement list.",
      );
      const statementsFlow = this.#sequence(statements, { ...context, breakTarget: join });
      return Object.freeze({
        clause,
        test,
        body: this.#compose([
          this.#atomic(clause, context.regionId),
          ...(statementsFlow === undefined ? [] : [statementsFlow]),
        ])!,
      });
    });
    const defaultBodies = clauseBodies.filter(({ test }) => test === undefined);
    if (defaultBodies.length > 1) {
      throw new FlowShapeError("Switch statement contains more than one default clause.");
    }
    const testedClauses = clauseBodies.flatMap(({ test, body }) =>
      test === undefined ? [] : [Object.freeze({ test: this.#buildNode(test, context), body })]);
    const noMatchTarget = defaultBodies[0]?.body.entry ?? join;
    const firstTest = testedClauses[0]?.test.entry;
    for (const exit of expression.exits) {
      this.#connect(exit, firstTest ?? noMatchTarget);
    }
    for (let index = 0; index < testedClauses.length; index += 1) {
      const selected = testedClauses[index]!;
      const nextTest = testedClauses[index + 1]?.test.entry ?? noMatchTarget;
      for (const exit of selected.test.exits) {
        this.#connect(exit, selected.body.entry);
        this.#connect(exit, nextTest);
      }
    }
    for (let index = 0; index < clauseBodies.length; index += 1) {
      for (const exit of clauseBodies[index]!.body.exits) {
        this.#connect(exit, clauseBodies[index + 1]?.body.entry ?? join);
      }
    }
    return { entry: expression.entry, exits: [join] };
  }

  #tryStatement(node: Node, context: RustSourceFlowContext): FlowFragment {
    const join = this.#nodePoint(node, context.regionId);
    const catchClause = TryStatement_CatchClause(this.#ast, node);
    const finallyBlock = TryStatement_FinallyBlock(this.#ast, node);
    if (catchClause === undefined && finallyBlock === undefined) {
      throw new FlowShapeError("Try statement has neither an exact catch clause nor a finally block.");
    }
    const catchVariable = catchClause === undefined
      ? undefined
      : CatchClause_VariableDeclaration(this.#ast, catchClause);
    const catchBlock = catchClause === undefined
      ? undefined
      : requireRustSourceFlowNode(
          CatchClause_Block(this.#ast, catchClause),
          "Catch clause has no exact block.",
        );
    const catchEntry = catchBlock === undefined
      ? undefined
      : this.#syntheticPoint(
          context.regionId,
          "join",
          "catch-entry",
          this.#lexicalRegions.ownedRegionFor(catchClause)?.id ?? context.lexicalRegionId,
        );
    const finallyContinuations = new Map<number, number>();
    const throughFinally = (target: number): number => {
      if (finallyBlock === undefined) return target;
      const existing = finallyContinuations.get(target);
      if (existing !== undefined) return existing;
      const finalizer = this.#buildNode(finallyBlock, context);
      finallyContinuations.set(target, finalizer.entry);
      for (const exit of finalizer.exits) this.#connect(exit, target);
      return finalizer.entry;
    };
    const tryBlock = requireRustSourceFlowNode(
      TryStatement_TryBlock(this.#ast, node),
      "Try statement has no exact try block.",
    );
    const tryContext = rustSourceFlowContextThroughCompletion(
      context,
      throughFinally,
      catchEntry ?? throughFinally(context.throwTarget),
    );
    const tryFlow = this.#buildNode(tryBlock, tryContext);
    const catchFlow = catchClause === undefined || catchBlock === undefined
      ? undefined
      : (() => {
          const catchContext: RustSourceFlowContext = {
            ...rustSourceFlowContextThroughCompletion(
              context,
              throughFinally,
              throughFinally(context.throwTarget),
            ),
            lexicalRegionId: this.#lexicalRegions.ownedRegionFor(catchClause)?.id ??
              context.lexicalRegionId,
          };
          return this.#compose([
            ...(catchVariable === undefined ? [] : [this.#buildNode(catchVariable, catchContext)]),
            this.#buildNode(catchBlock, catchContext),
          ]);
        })();
    if (catchEntry !== undefined && catchFlow !== undefined) this.#connect(catchEntry, catchFlow.entry);
    const normalContinuation = throughFinally(join);
    for (const exit of [...tryFlow.exits, ...(catchFlow?.exits ?? [])]) {
      this.#connect(exit, normalContinuation);
    }
    return { entry: tryFlow.entry, exits: [join] };
  }

  #breakOrContinueStatement(
    node: Node,
    context: RustSourceFlowContext,
    completion: "break" | "continue",
  ): FlowFragment {
    const labelNode = BreakOrContinueStatement_Label(this.#ast, node);
    if (labelNode === undefined) {
      const target = completion === "break" ? context.breakTarget : context.continueTarget;
      if (target === undefined) {
        throw new FlowShapeError(`${completion} statement has no enclosing target.`);
      }
      return this.#abruptStatement(node, context, target, undefined);
    }
    const label = this.#ast.text(labelNode);
    const labeled = context.labeledTargets.get(label);
    const target = completion === "break" ? labeled?.breakTarget : labeled?.continueTarget;
    if (label.length === 0 || target === undefined) {
      throw new FlowShapeError(
        `${completion} statement has no exact active target for label '${label}'.`,
      );
    }
    return this.#abruptStatement(node, context, target, undefined);
  }

  #abruptStatement(
    node: Node,
    context: RustSourceFlowContext,
    target: number,
    expression: Node | undefined,
  ): FlowFragment {
    const expressionFlow = expression === undefined ? undefined : this.#buildNode(expression, context);
    const point = this.#nodePoint(node, context.regionId);
    for (const exit of expressionFlow?.exits ?? []) this.#connect(exit, point);
    this.#connect(point, target);
    return { entry: expressionFlow?.entry ?? point, exits: [] };
  }

  #generic(node: Node, context: RustSourceFlowContext): FlowFragment {
    const children: Node[] = [];
    this.#ast.forEachChild(node, (child) => {
      if (child !== undefined && !this.#skipCallableBody(node, child, context)) children.push(child);
    });
    const childFlow = this.#compose(children.map((child) => this.#buildNode(child, context)));
    const point = this.#nodePoint(node, context.regionId);
    const mayThrow = this.#effects.nodeMayThrow(node);
    if (mayThrow === undefined) {
      throw new FlowShapeError(
        "Rust ownership flow has no finalized execution effects for an exact source operation.",
      );
    }
    if (mayThrow) this.#connect(point, context.throwTarget);
    if (childFlow === undefined) return { entry: point, exits: [point] };
    for (const exit of childFlow.exits) this.#connect(exit, point);
    return { entry: childFlow.entry, exits: [point] };
  }

  #skipCallableBody(parent: Node, child: Node, context: RustSourceFlowContext): boolean {
    return isRustSourceFlowCallable(parent, this.#ast) && parent !== context.rootCallable &&
      this.#ast.body(parent) === child;
  }

  #sequence(nodes: readonly Node[], context: RustSourceFlowContext): FlowFragment | undefined {
    const resourceIndex = nodes.findIndex((node) => {
      const declarationKind = this.#ast.variableDeclarationKind(node);
      return declarationKind === "using" || declarationKind === "await using";
    });
    if (resourceIndex < 0) {
      return this.#compose(nodes.map((node) => this.#buildNode(node, context)));
    }
    const resourceStatement = nodes[resourceIndex]!;
    const declaration = rustSourceFlowDirectResourceDeclaration(resourceStatement, this.#ast);
    const effect = this.#effects.resourceCleanupFor(declaration);
    if (effect === undefined) {
      throw new FlowShapeError(
        "Rust ownership flow has no finalized cleanup effect for an exact resource declaration.",
      );
    }
    const prefix = this.#compose(
      nodes.slice(0, resourceIndex + 1).map((node) => this.#buildNode(node, context)),
    )!;
    const normalContinuation = this.#syntheticPoint(
      context.regionId,
      "join",
      "resource-normal-continuation",
      context.lexicalRegionId,
    );
    const scope = this.#resourceCleanupScope(declaration, effect, context);
    const remainder = this.#sequence(nodes.slice(resourceIndex + 1), scope.context);
    const cleanup = scope.route(normalContinuation);
    const scopedBody: FlowFragment = remainder === undefined
      ? { entry: cleanup, exits: [normalContinuation] }
      : (() => {
          for (const exit of remainder.exits) this.#connect(exit, cleanup);
          return { entry: remainder.entry, exits: [normalContinuation] };
        })();
    const complete = this.#compose([prefix, scopedBody])!;
    return { entry: complete.entry, exits: [normalContinuation] };
  }

  #resourceCleanupScope(
    declaration: Node,
    effect: RustSourceResourceCleanupEffect,
    context: RustSourceFlowContext,
  ): {
    readonly context: RustSourceFlowContext;
    route(target: number): number;
  } {
    const routes = new Map<number, number>();
    const route = (target: number): number => {
      const existing = routes.get(target);
      if (existing !== undefined) return existing;
      const cleanup = this.#resourceCleanupPoint(
        declaration,
        effect,
        context.regionId,
      );
      routes.set(target, cleanup);
      this.#connect(cleanup, target);
      if (effect.fallible) this.#connect(cleanup, context.throwTarget);
      return cleanup;
    };
    return Object.freeze({
      context: rustSourceFlowContextThroughCompletion(
        context,
        route,
        route(context.throwTarget),
      ),
      route,
    });
  }

  #compose(fragments: readonly FlowFragment[]): FlowFragment | undefined {
    const [first] = fragments;
    if (first === undefined) return undefined;
    let exits = first.exits;
    for (const fragment of fragments.slice(1)) {
      for (const exit of exits) this.#connect(exit, fragment.entry);
      exits = fragment.exits;
    }
    return { entry: first.entry, exits };
  }

  #atomic(node: Node, regionId: string): FlowFragment {
    const point = this.#nodePoint(node, regionId);
    return { entry: point, exits: [point] };
  }

  #syntheticFragment(
    regionId: string,
    label: string,
    lexicalRegionId: string,
  ): FlowFragment {
    const point = this.#syntheticPoint(regionId, "join", label, lexicalRegionId);
    return { entry: point, exits: [point] };
  }

  #nodePoint(node: Node, regionId: string): number {
    const occurrence = this.#graph.pointOccurrenceCount(node);
    const point = this.#appendPoint(rustSourceFlowNodePoint(
      node,
      regionId,
      occurrence,
      this.#ast,
      this.#lexicalRegions,
      this.#effects,
    ));
    this.#graph.recordPointForNode(node, point, regionId);
    return point;
  }

  #resourceCleanupPoint(
    declaration: Node,
    effect: RustSourceResourceCleanupEffect,
    regionId: string,
  ): number {
    const ordinal = this.#graph.pointCount;
    return this.#appendPoint(rustSourceFlowCleanupPoint(
      declaration,
      effect,
      regionId,
      ordinal,
      this.#ast,
      this.#lexicalRegions,
    ));
  }

  #syntheticPoint(
    regionId: string,
    kind: RustSourceFlowPoint["kind"],
    label: string,
    lexicalRegionId: string | undefined,
  ): number {
    return this.#appendPoint({
      id: `${regionId}\0${label}:${this.#graph.pointCount}`,
      regionId,
      ...(lexicalRegionId === undefined ? {} : { lexicalRegionId }),
      kind,
    });
  }

  #appendPoint(point: Omit<RustSourceFlowPoint, "index">): number {
    return this.#graph.appendPoint(point);
  }

  #connect(from: number, to: number): void {
    this.#graph.connect(from, to);
  }

}
