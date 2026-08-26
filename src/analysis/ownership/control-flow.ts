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
  VariableDeclarationList_Declarations,
  VariableStatement_DeclarationList,
} from "@tsonic/target-api/source";
import type { RustLexicalRegionIndex } from "./lexical-regions.js";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import {
  maximumFlowQuerySteps,
  maximumFlowReachabilityCacheEntries,
  rustFlowConstructionDepthComplexityDiagnostic,
  rustFlowEdgeComplexityDiagnostic,
  rustFlowPointComplexityDiagnostic,
} from "./complexity.js";
import { requireRustOwnershipSourceIdentity } from "./identity.js";

export interface RustSourceFlowPoint {
  readonly id: string;
  readonly index: number;
  readonly regionId: string;
  readonly lexicalRegionId?: string;
  readonly node?: Node;
  readonly kind: "entry" | "node" | "exit" | "join";
  readonly suspension?: {
    readonly kind: "await" | "yield";
    readonly occurrenceId: string;
  };
  readonly resourceCleanup?: {
    readonly declaration: Node;
    readonly access: "shared" | "mutable";
  };
}

export interface RustSourceFlowGraph {
  readonly points: readonly RustSourceFlowPoint[];
  readonly edgeCount: number;
  pointsFor(node: Node | undefined): readonly RustSourceFlowPoint[];
  successors(point: RustSourceFlowPoint): readonly RustSourceFlowPoint[];
  predecessors(point: RustSourceFlowPoint): readonly RustSourceFlowPoint[];
  reaches(from: Node | RustSourceFlowPoint, to: Node | RustSourceFlowPoint): boolean;
  repeats(node: Node | RustSourceFlowPoint): boolean;
  pointsOnPaths(
    from: Node | RustSourceFlowPoint,
    to: readonly (Node | RustSourceFlowPoint)[],
  ): readonly RustSourceFlowPoint[];
  regionFor(node: Node | undefined): string | undefined;
  exitsFor(node: SourceFile | Node): readonly RustSourceFlowPoint[];
}

export type BuildRustSourceFlowGraphResult =
  | { readonly kind: "resolved"; readonly graph: RustSourceFlowGraph }
  | { readonly kind: "rejected"; readonly code: string; readonly message: string };

export interface RustSourceResourceCleanupEffect {
  readonly access: "shared" | "mutable";
  readonly asynchronous: boolean;
  readonly fallible: boolean;
}

export interface RustSourceFlowEffects {
  nodeMayThrow(node: Node): boolean | undefined;
  nodeSuspensionKind(node: Node): "await" | "yield" | undefined;
  resourceCleanupFor(declaration: Node): RustSourceResourceCleanupEffect | undefined;
}

interface FlowFragment {
  readonly entry: number;
  readonly exits: readonly number[];
}

interface FlowContext {
  readonly regionId: string;
  readonly lexicalRegionId: string;
  readonly rootCallable?: Node;
  readonly breakTarget?: number;
  readonly continueTarget?: number;
  readonly returnTarget: number;
  readonly throwTarget: number;
  readonly labeledTargets: ReadonlyMap<string, FlowLabelTarget>;
  readonly pendingLoopLabels: readonly string[];
}

interface FlowLabelTarget {
  readonly breakTarget: number;
  readonly continueTarget?: number;
}

interface RegionRecord {
  readonly owner: SourceFile | Node;
  readonly regionId: string;
  readonly entry: number;
  readonly exit: number;
}

class FlowConstructionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

class FlowLimitError extends FlowConstructionError {
  constructor(code: string, message: string) {
    super(code, message);
  }
}

class FlowShapeError extends FlowConstructionError {
  constructor(message: string) {
    super("RUST_SOURCE_AST_INCOMPLETE", message);
  }
}

export class RustSourceFlowQueryLimitError extends Error {
  constructor(readonly stepCount: number) {
    super(
      `Rust ownership analysis performed ${stepCount} control-flow query steps; ` +
      `the finite limit is ${maximumFlowQuerySteps}.`,
    );
  }
}

export function buildRustSourceFlowGraph(
  ast: AstReader,
  sourceFiles: readonly SourceFile[],
  lexicalRegions: RustLexicalRegionIndex,
  effects: RustSourceFlowEffects,
): BuildRustSourceFlowGraphResult {
  try {
    return {
      kind: "resolved",
      graph: new SourceFlowGraphBuilder(
        ast,
        sourceFiles,
        lexicalRegions,
        effects,
      ).build(),
    };
  } catch (error) {
    if (!(error instanceof FlowConstructionError)) throw error;
    return {
      kind: "rejected",
      code: error.code,
      message: error.message,
    };
  }
}

class SourceFlowGraphBuilder {
  readonly #ast: AstReader;
  readonly #sourceFiles: readonly SourceFile[];
  readonly #lexicalRegions: RustLexicalRegionIndex;
  readonly #effects: RustSourceFlowEffects;
  readonly #points: RustSourceFlowPoint[] = [];
  readonly #pointsByNode = new WeakMap<Node, number[]>();
  readonly #successors: number[][] = [];
  readonly #predecessors: number[][] = [];
  readonly #regions: RegionRecord[] = [];
  readonly #regionByNode = new WeakMap<Node, string>();
  readonly #regionByOwner = new WeakMap<Node, RegionRecord>();
  readonly #callables: Node[] = [];
  readonly #callableSet = new WeakSet<Node>();
  #edgeCount = 0;
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
      this.#collectCallables(sourceFile);
      this.#buildRegion(sourceFile, undefined);
    }
    for (const callable of this.#callables) {
      this.#buildRegion(callable, callable);
    }
    return this.#seal();
  }

  #collectCallables(root: Node): void {
    const pending = [root];
    while (pending.length > 0) {
      const node = pending.pop()!;
      if (isCallable(node, this.#ast)) {
        if (!this.#callableSet.has(node)) {
          this.#callableSet.add(node);
          this.#callables.push(node);
        }
      }
      const children: Node[] = [];
      this.#ast.forEachChild(node, (child) => {
        if (child !== undefined) children.push(child);
      });
      for (let index = children.length - 1; index >= 0; index -= 1) {
        pending.push(children[index]!);
      }
    }
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
    this.#regions.push(record);
    this.#regionByOwner.set(owner, record);
    const context: FlowContext = {
      regionId,
      lexicalRegionId,
      ...(rootCallable === undefined ? {} : { rootCallable }),
      returnTarget: exit,
      throwTarget: exit,
      labeledTargets: new Map(),
      pendingLoopLabels: Object.freeze([]),
    };
    const body = rootCallable === undefined
      ? this.#sequence(this.#denseStatements(owner), context)
      : this.#callableBody(rootCallable, context);
    if (body === undefined) {
      this.#connect(entry, exit);
      return;
    }
    this.#connect(entry, body.entry);
    for (const normalExit of body.exits) this.#connect(normalExit, exit);
  }

  #callableBody(callable: Node, context: FlowContext): FlowFragment | undefined {
    const parameters = this.#denseNodes(
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
        ? this.#sequence(this.#denseStatements(body), context)
        : this.#buildNode(body, context);
      if (bodyFragment !== undefined) fragments.push(bodyFragment);
    }
    return this.#compose(fragments);
  }

  #buildNode(node: Node, context: FlowContext): FlowFragment {
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

  #buildNodeAtDepth(node: Node, context: FlowContext): FlowFragment {
    context = Object.freeze({
      ...context,
      lexicalRegionId: this.#lexicalRegions.regionFor(node)?.id ?? context.lexicalRegionId,
    });
    this.#regionByNode.set(node, context.regionId);
    const kind = this.#ast.kindName(node);
    if (kind === "KindLabeledStatement") {
      return this.#labeledStatement(node, context);
    }
    if (!isIterationKind(kind) && context.pendingLoopLabels.length > 0) {
      context = this.#withoutPendingLoopLabels(context);
    }
    if (kind === "KindBlock" || kind === "KindSourceFile") {
      const statements = this.#sequence(this.#denseStatements(node), context);
      const completion = this.#nodePoint(node, context.regionId);
      if (statements === undefined) return { entry: completion, exits: [completion] };
      for (const exit of statements.exits) this.#connect(exit, completion);
      return { entry: statements.entry, exits: [completion] };
    }
    if (isCallable(node, this.#ast) && node !== context.rootCallable) {
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
          this.#requiredNode(
            Node_Expression(this.#ast, node),
            "Throw statement has no exact expression.",
          ),
        );
      case "KindBreakStatement":
        return this.#breakOrContinueStatement(node, context, "break");
      case "KindContinueStatement":
        return this.#breakOrContinueStatement(node, context, "continue");
      case "KindBinaryExpression":
        if (isShortCircuitOperator(this.#ast.operatorKindName(node))) {
          return this.#shortCircuitExpression(node, context);
        }
        return this.#generic(node, context);
      default:
        return this.#generic(node, context);
    }
  }

  #labeledStatement(node: Node, context: FlowContext): FlowFragment {
    const labelNode = this.#requiredNode(
      LabeledStatement_Label(this.#ast, node),
      "Labeled statement has no exact label.",
    );
    const statement = this.#requiredNode(
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

  #ifStatement(node: Node, context: FlowContext): FlowFragment {
    const condition = this.#requiredNode(
      Node_Expression(this.#ast, node),
      "If statement has no exact condition.",
    );
    const thenNode = this.#requiredNode(
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

  #conditionalExpression(node: Node, context: FlowContext): FlowFragment {
    const condition = this.#requiredNode(
      ConditionalExpression_Condition(this.#ast, node),
      "Conditional expression has no exact condition.",
    );
    const whenTrue = this.#requiredNode(
      ConditionalExpression_WhenTrue(this.#ast, node),
      "Conditional expression has no exact true branch.",
    );
    const whenFalse = this.#requiredNode(
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

  #shortCircuitExpression(node: Node, context: FlowContext): FlowFragment {
    const left = this.#requiredNode(
      BinaryExpression_Left(this.#ast, node),
      "Short-circuit expression has no exact left operand.",
    );
    const right = this.#requiredNode(
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

  #whileStatement(node: Node, context: FlowContext): FlowFragment {
    const join = this.#nodePoint(node, context.regionId);
    const loopContext = this.#withoutPendingLoopLabels(context);
    const conditionNode = this.#requiredNode(
      Node_Expression(this.#ast, node),
      "While statement has no exact condition.",
    );
    const condition = this.#buildNode(conditionNode, loopContext);
    const bodyNode = this.#requiredNode(
      IterationStatement_Statement(this.#ast, node),
      "While statement has no exact body.",
    );
    const body = this.#buildNode(
      bodyNode,
      this.#loopBodyContext(context, join, condition.entry),
    );
    for (const exit of condition.exits) {
      this.#connect(exit, body.entry);
      this.#connect(exit, join);
    }
    for (const exit of body.exits) this.#connect(exit, condition.entry);
    return { entry: condition.entry, exits: [join] };
  }

  #doStatement(node: Node, context: FlowContext): FlowFragment {
    const join = this.#nodePoint(node, context.regionId);
    const loopContext = this.#withoutPendingLoopLabels(context);
    const conditionNode = this.#requiredNode(
      Node_Expression(this.#ast, node),
      "Do statement has no exact condition.",
    );
    const condition = this.#buildNode(conditionNode, loopContext);
    const bodyNode = this.#requiredNode(
      DoStatement_Statement(this.#ast, node),
      "Do statement has no exact body.",
    );
    const body = this.#buildNode(
      bodyNode,
      this.#loopBodyContext(context, join, condition.entry),
    );
    for (const exit of body.exits) this.#connect(exit, condition.entry);
    for (const exit of condition.exits) {
      this.#connect(exit, body.entry);
      this.#connect(exit, join);
    }
    return { entry: body.entry, exits: [join] };
  }

  #forStatement(node: Node, context: FlowContext): FlowFragment {
    const join = this.#nodePoint(node, context.regionId);
    const loopContext = this.#withoutPendingLoopLabels(context);
    const loopRegionId = this.#lexicalRegions.ownedRegionFor(node)?.id ?? context.lexicalRegionId;
    const initializerNode = ForStatement_Initializer(this.#ast, node);
    const conditionNode = ForStatement_Condition(this.#ast, node);
    const incrementNode = ForStatement_Incrementor(this.#ast, node);
    const resourceDeclaration = initializerNode === undefined
      ? undefined
      : this.#resourceDeclarationForInitializer(initializerNode);
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
    const loopEvaluationContext = this.#withoutPendingLoopLabels(activeContext);
    const loopExit = resourceScope?.route(join) ?? join;
    const condition = conditionNode === undefined
      ? this.#syntheticFragment(context.regionId, "for-condition", loopRegionId)
      : this.#buildNode(conditionNode, loopEvaluationContext);
    const increment = incrementNode === undefined
      ? this.#syntheticFragment(context.regionId, "for-increment", loopRegionId)
      : this.#buildNode(incrementNode, loopEvaluationContext);
    const bodyNode = this.#requiredNode(
      IterationStatement_Statement(this.#ast, node),
      "For statement has no exact body.",
    );
    const body = this.#buildNode(
      bodyNode,
      this.#loopBodyContext(activeContext, loopExit, increment.entry),
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

  #forInOrOfStatement(node: Node, context: FlowContext): FlowFragment {
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
    const loopContext = this.#withoutPendingLoopLabels(context);
    const expressionNode = this.#requiredNode(
      Node_Expression(this.#ast, node),
      "Iteration statement has no exact iterable expression.",
    );
    const initializerNode = this.#requiredNode(
      ForInOrOfStatement_Initializer(this.#ast, node),
      "Iteration statement has no exact binding or assignment target.",
    );
    const resourceDeclaration = this.#resourceDeclarationForInitializer(initializerNode);
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
    const bodyNode = this.#requiredNode(
      ForInOrOfStatement_Statement(this.#ast, node),
      "Iteration statement has no exact body.",
    );
    const body = this.#buildNode(
      bodyNode,
      this.#loopBodyContext(bodyContext, breakTarget, continueTarget),
    );
    for (const exit of iterable.exits) this.#connect(exit, step);
    this.#connect(step, initializer.entry);
    this.#connect(step, join);
    for (const exit of initializer.exits) this.#connect(exit, body.entry);
    for (const exit of body.exits) this.#connect(exit, continueTarget);
    return { entry: iterable.entry, exits: [join] };
  }

  #switchStatement(node: Node, context: FlowContext): FlowFragment {
    const join = this.#nodePoint(node, context.regionId);
    const expressionNode = this.#requiredNode(
      SwitchStatement_Expression(this.#ast, node),
      "Switch statement has no exact expression.",
    );
    const expression = this.#buildNode(expressionNode, context);
    const caseBlock = this.#requiredNode(
      SwitchStatement_CaseBlock(this.#ast, node),
      "Switch statement has no exact case block.",
    );
    const clauses = this.#denseNodes(
      CaseBlock_Clauses(this.#ast, caseBlock),
      "Switch statement contains an absent, undefined, or non-data clause list.",
    );
    if (clauses.length === 0) {
      for (const exit of expression.exits) this.#connect(exit, join);
      return { entry: expression.entry, exits: [join] };
    }
    const clauseBodies = clauses.map((clause) => {
      const test = CaseOrDefaultClause_Expression(this.#ast, clause);
      const statements = this.#denseNodes(
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

  #tryStatement(node: Node, context: FlowContext): FlowFragment {
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
      : this.#requiredNode(
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
    const tryBlock = this.#requiredNode(
      TryStatement_TryBlock(this.#ast, node),
      "Try statement has no exact try block.",
    );
    const tryContext = this.#throughCompletionContext(
      context,
      throughFinally,
      catchEntry ?? throughFinally(context.throwTarget),
    );
    const tryFlow = this.#buildNode(tryBlock, tryContext);
    const catchFlow = catchClause === undefined || catchBlock === undefined
      ? undefined
      : (() => {
          const catchContext: FlowContext = {
            ...this.#throughCompletionContext(
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
    context: FlowContext,
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

  #withoutPendingLoopLabels(context: FlowContext): FlowContext {
    return context.pendingLoopLabels.length === 0
      ? context
      : Object.freeze({ ...context, pendingLoopLabels: Object.freeze([]) });
  }

  #loopBodyContext(
    context: FlowContext,
    breakTarget: number,
    continueTarget: number,
  ): FlowContext {
    const labeledTargets = new Map(context.labeledTargets);
    for (const label of context.pendingLoopLabels) {
      const target = labeledTargets.get(label);
      if (target === undefined) {
        throw new FlowShapeError(`Loop label '${label}' has no exact active target.`);
      }
      labeledTargets.set(label, Object.freeze({
        breakTarget: target.breakTarget,
        continueTarget,
      }));
    }
    return Object.freeze({
      ...context,
      breakTarget,
      continueTarget,
      labeledTargets,
      pendingLoopLabels: Object.freeze([]),
    });
  }

  #throughCompletionContext(
    context: FlowContext,
    throughFinally: (target: number) => number,
    throwTarget: number,
  ): FlowContext {
    const labeledTargets = new Map<string, FlowLabelTarget>();
    for (const [label, target] of context.labeledTargets) {
      labeledTargets.set(label, Object.freeze({
        breakTarget: throughFinally(target.breakTarget),
        ...(target.continueTarget === undefined
          ? {}
          : { continueTarget: throughFinally(target.continueTarget) }),
      }));
    }
    return Object.freeze({
      ...context,
      returnTarget: throughFinally(context.returnTarget),
      ...(context.breakTarget === undefined
        ? {}
        : { breakTarget: throughFinally(context.breakTarget) }),
      ...(context.continueTarget === undefined
        ? {}
        : { continueTarget: throughFinally(context.continueTarget) }),
      throwTarget,
      labeledTargets,
    });
  }

  #abruptStatement(
    node: Node,
    context: FlowContext,
    target: number,
    expression: Node | undefined,
  ): FlowFragment {
    const expressionFlow = expression === undefined ? undefined : this.#buildNode(expression, context);
    const point = this.#nodePoint(node, context.regionId);
    for (const exit of expressionFlow?.exits ?? []) this.#connect(exit, point);
    this.#connect(point, target);
    return { entry: expressionFlow?.entry ?? point, exits: [] };
  }

  #generic(node: Node, context: FlowContext): FlowFragment {
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

  #skipCallableBody(parent: Node, child: Node, context: FlowContext): boolean {
    return isCallable(parent, this.#ast) && parent !== context.rootCallable &&
      this.#ast.body(parent) === child;
  }

  #sequence(nodes: readonly Node[], context: FlowContext): FlowFragment | undefined {
    const resourceIndex = nodes.findIndex((node) => {
      const declarationKind = this.#ast.variableDeclarationKind(node);
      return declarationKind === "using" || declarationKind === "await using";
    });
    if (resourceIndex < 0) {
      return this.#compose(nodes.map((node) => this.#buildNode(node, context)));
    }
    const resourceStatement = nodes[resourceIndex]!;
    const declaration = this.#directResourceDeclaration(resourceStatement);
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

  #directResourceDeclaration(statement: Node): Node {
    if (!this.#ast.is.IsVariableStatement(statement)) {
      throw new FlowShapeError(
        "A lexical resource declaration must be represented by one exact variable statement.",
      );
    }
    const declarationList = this.#requiredNode(
      VariableStatement_DeclarationList(this.#ast, statement),
      "Resource statement has no exact declaration list.",
    );
    const declarations = VariableDeclarationList_Declarations(
      this.#ast,
      declarationList,
    );
    const dense = this.#denseNodes(
      declarations,
      "Resource statement contains an absent, undefined, or non-data declaration list.",
    );
    const [declaration] = dense;
    if (declaration === undefined || dense.length !== 1 ||
      !this.#ast.is.IsVariableDeclaration(declaration)) {
      throw new FlowShapeError(
        "A lexical resource statement must contain exactly one variable declaration.",
      );
    }
    const declarationKind = this.#ast.variableDeclarationKind(declaration);
    if (declarationKind !== "using" && declarationKind !== "await using") {
      throw new FlowShapeError(
        "Resource statement and declaration kinds do not identify the same exact resource binding.",
      );
    }
    return declaration;
  }

  #resourceDeclarationForInitializer(initializer: Node): Node | undefined {
    const declarationKind = this.#ast.variableDeclarationKind(initializer);
    if (declarationKind !== "using" && declarationKind !== "await using") {
      return undefined;
    }
    const declarations = this.#ast.is.IsVariableDeclaration(initializer)
      ? [initializer]
      : this.#ast.is.IsVariableDeclarationList(initializer)
        ? VariableDeclarationList_Declarations(this.#ast, initializer)
        : undefined;
    const dense = this.#denseNodes(
      declarations,
      "Resource initializer contains an absent, undefined, or non-data declaration list.",
    );
    const [declaration] = dense;
    if (declaration === undefined || dense.length !== 1 ||
      !this.#ast.is.IsVariableDeclaration(declaration) ||
      this.#ast.variableDeclarationKind(declaration) !== declarationKind) {
      throw new FlowShapeError(
        "A resource initializer must contain exactly one matching variable declaration.",
      );
    }
    return declaration;
  }

  #resourceCleanupScope(
    declaration: Node,
    effect: RustSourceResourceCleanupEffect,
    context: FlowContext,
  ): {
    readonly context: FlowContext;
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
      context: this.#throughCompletionContext(
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
    const occurrences = this.#pointsByNode.get(node) ?? [];
    const occurrenceId = requireRustOwnershipSourceIdentity(this.#ast, node);
    const suspensionKind = this.#effects.nodeSuspensionKind(node);
    const point = this.#appendPoint({
      id: `${regionId}\0node:${occurrenceId}:${occurrences.length}`,
      regionId,
      lexicalRegionId: this.#lexicalRegions.regionFor(node)?.id,
      node,
      kind: "node",
      ...(suspensionKind === undefined
        ? {}
        : { suspension: { kind: suspensionKind, occurrenceId } }),
    });
    occurrences.push(point);
    this.#pointsByNode.set(node, occurrences);
    this.#regionByNode.set(node, regionId);
    return point;
  }

  #resourceCleanupPoint(
    declaration: Node,
    effect: RustSourceResourceCleanupEffect,
    regionId: string,
  ): number {
    const occurrenceId = requireRustOwnershipSourceIdentity(this.#ast, declaration);
    const ordinal = this.#points.length;
    return this.#appendPoint({
      id: `${regionId}\0resource-cleanup:${occurrenceId}:${ordinal}`,
      regionId,
      lexicalRegionId: this.#lexicalRegions.regionFor(declaration)?.id,
      kind: "node",
      resourceCleanup: {
        declaration,
        access: effect.access,
      },
      ...(effect.asynchronous
        ? {
            suspension: {
              kind: "await" as const,
              occurrenceId: `${occurrenceId}\0resource-cleanup:${ordinal}`,
            },
          }
        : {}),
    });
  }

  #syntheticPoint(
    regionId: string,
    kind: RustSourceFlowPoint["kind"],
    label: string,
    lexicalRegionId: string | undefined,
  ): number {
    return this.#appendPoint({
      id: `${regionId}\0${label}:${this.#points.length}`,
      regionId,
      ...(lexicalRegionId === undefined ? {} : { lexicalRegionId }),
      kind,
    });
  }

  #appendPoint(point: Omit<RustSourceFlowPoint, "index">): number {
    const pointDiagnostic = rustFlowPointComplexityDiagnostic(this.#points.length + 1);
    if (pointDiagnostic !== undefined) {
      throw new FlowLimitError(pointDiagnostic.code, pointDiagnostic.message);
    }
    const index = this.#points.length;
    this.#points.push(Object.freeze({ ...point, index }));
    this.#successors.push([]);
    this.#predecessors.push([]);
    return index;
  }

  #connect(from: number, to: number): void {
    const successors = this.#successors[from]!;
    if (successors.includes(to)) return;
    const edgeDiagnostic = rustFlowEdgeComplexityDiagnostic(this.#edgeCount + 1);
    if (edgeDiagnostic !== undefined) {
      throw new FlowLimitError(edgeDiagnostic.code, edgeDiagnostic.message);
    }
    successors.push(to);
    this.#predecessors[to]!.push(from);
    this.#edgeCount += 1;
  }

  #denseStatements(node: Node): readonly Node[] {
    return this.#denseNodes(
      this.#ast.statements(node),
      "Statement list contains an undefined or non-data statement slot.",
    );
  }

  #denseNodes(
    values: readonly (Node | undefined)[] | undefined,
    message: string,
  ): readonly Node[] {
    if (values === undefined || !isDenseDataArray(values) ||
      values.some((value) => value === undefined)) {
      throw new FlowShapeError(message);
    }
    return values as readonly Node[];
  }

  #requiredNode(node: Node | undefined, message: string): Node {
    if (node === undefined) throw new FlowShapeError(message);
    return node;
  }

  #seal(): RustSourceFlowGraph {
    const points = Object.freeze([...this.#points]);
    const pointIndexes = new WeakMap<object, number>();
    points.forEach((point) => pointIndexes.set(point, point.index));
    const successors = Object.freeze(this.#successors.map((entries) => Object.freeze([...entries])));
    const predecessors = Object.freeze(this.#predecessors.map((entries) => Object.freeze([...entries])));
    const cyclic = computeCyclicPoints(successors, predecessors);
    const reachability = new Map<string, boolean>();
    let querySteps = 0;
    const chargeQuerySteps = (count: number): void => {
      querySteps += count;
      if (!Number.isSafeInteger(querySteps) || querySteps > maximumFlowQuerySteps) {
        throw new RustSourceFlowQueryLimitError(querySteps);
      }
    };
    const cacheReachability = (key: string, value: boolean): void => {
      if (reachability.size < maximumFlowReachabilityCacheEntries) {
        reachability.set(key, value);
      }
    };
    const pointIndices = (value: Node | RustSourceFlowPoint): readonly number[] => {
      const exact = pointIndexes.get(value);
      if (exact !== undefined) return Object.freeze([exact]);
      return Object.freeze([...(this.#pointsByNode.get(value as Node) ?? [])]);
    };
    const reachesIndex = (from: number, to: number): boolean => {
      const key = `${from}:${to}`;
      const cached = reachability.get(key);
      if (cached !== undefined) return cached;
      if (from === to) {
        const result = cyclic.has(from);
        cacheReachability(key, result);
        return result;
      }
      const pending = [...successors[from]!];
      const seen = new Set<number>([from]);
      while (pending.length > 0) {
        chargeQuerySteps(1);
        const current = pending.pop()!;
        if (current === to) {
          cacheReachability(key, true);
          return true;
        }
        if (seen.has(current)) continue;
        seen.add(current);
        pending.push(...successors[current]!);
      }
      cacheReachability(key, false);
      return false;
    };
    const graph: RustSourceFlowGraph = Object.freeze({
      points,
      edgeCount: this.#edgeCount,
      pointsFor: (node: Node | undefined) => Object.freeze(
        (node === undefined ? [] : this.#pointsByNode.get(node) ?? [])
          .map((index) => points[index]!),
      ),
      successors: (point: RustSourceFlowPoint) =>
        Object.freeze(successors[point.index]!.map((index) => points[index]!)),
      predecessors: (point: RustSourceFlowPoint) =>
        Object.freeze(predecessors[point.index]!.map((index) => points[index]!)),
      reaches: (from: Node | RustSourceFlowPoint, to: Node | RustSourceFlowPoint) => {
        const fromIndices = pointIndices(from);
        const toIndices = pointIndices(to);
        return fromIndices.some((fromIndex) => toIndices.some((toIndex) =>
          points[fromIndex]!.regionId === points[toIndex]!.regionId &&
          reachesIndex(fromIndex, toIndex)));
      },
      repeats: (node: Node | RustSourceFlowPoint) => {
        return pointIndices(node).some((index) => cyclic.has(index));
      },
      pointsOnPaths: (
        from: Node | RustSourceFlowPoint,
        targets: readonly (Node | RustSourceFlowPoint)[],
      ) => {
        const selected = new Set<number>();
        const targetIndexes = targets.flatMap((target) => [...pointIndices(target)]);
        for (const fromIndex of pointIndices(from)) {
          const sameRegionTargets = targetIndexes.filter((index) =>
            points[index]!.regionId === points[fromIndex]!.regionId);
          if (sameRegionTargets.length === 0) continue;
          const forward = reachableSet(fromIndex, successors, true, chargeQuerySteps);
          const backward = new Set<number>();
          for (const target of sameRegionTargets) {
            for (const index of reachableSet(target, predecessors, true, chargeQuerySteps)) {
              backward.add(index);
            }
          }
          chargeQuerySteps(points.length);
          for (const point of points) {
            if (point.regionId === points[fromIndex]!.regionId &&
              forward.has(point.index) && backward.has(point.index)) {
              selected.add(point.index);
            }
          }
        }
        return Object.freeze([...selected].sort((left, right) => left - right)
          .map((index) => points[index]!));
      },
      regionFor: (node: Node | undefined) => node === undefined
        ? undefined
        : this.#regionByNode.get(node),
      exitsFor: (owner: SourceFile | Node) => {
        const record = this.#regionByOwner.get(owner);
        return record === undefined ? Object.freeze([]) : Object.freeze([points[record.exit]!]);
      },
    });
    return graph;
  }
}

function reachableSet(
  start: number,
  edges: readonly (readonly number[])[],
  includeStart: boolean,
  charge: (count: number) => void,
): ReadonlySet<number> {
  const seen = new Set<number>(includeStart ? [start] : []);
  const pending = [...edges[start]!];
  while (pending.length > 0) {
    charge(1);
    const current = pending.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    pending.push(...edges[current]!);
  }
  return seen;
}

function computeCyclicPoints(
  successors: readonly (readonly number[])[],
  predecessors: readonly (readonly number[])[],
): ReadonlySet<number> {
  const visited = new Uint8Array(successors.length);
  const finishOrder: number[] = [];
  for (let start = 0; start < successors.length; start += 1) {
    if (visited[start] !== 0) continue;
    visited[start] = 1;
    const stack: { readonly point: number; next: number }[] = [{ point: start, next: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const adjacent = successors[frame.point]!;
      const successor = adjacent[frame.next];
      if (successor === undefined) {
        finishOrder.push(frame.point);
        stack.pop();
        continue;
      }
      frame.next += 1;
      if (visited[successor] !== 0) continue;
      visited[successor] = 1;
      stack.push({ point: successor, next: 0 });
    }
  }

  const assigned = new Uint8Array(successors.length);
  const cyclic = new Set<number>();
  for (let orderIndex = finishOrder.length - 1; orderIndex >= 0; orderIndex -= 1) {
    const start = finishOrder[orderIndex]!;
    if (assigned[start] !== 0) continue;
    const component: number[] = [];
    const pending = [start];
    assigned[start] = 1;
    while (pending.length > 0) {
      const point = pending.pop()!;
      component.push(point);
      for (const predecessor of predecessors[point]!) {
        if (assigned[predecessor] !== 0) continue;
        assigned[predecessor] = 1;
        pending.push(predecessor);
      }
    }
    if (component.length > 1 || successors[start]!.includes(start)) {
      component.forEach((selected) => cyclic.add(selected));
    }
  }
  return cyclic;
}

function isCallable(node: Node, ast: AstReader): boolean {
  const kind = ast.kindName(node);
  return kind === "KindFunctionDeclaration" || kind === "KindFunctionExpression" ||
    kind === "KindArrowFunction" || kind === "KindMethodDeclaration" ||
    kind === "KindConstructor" || kind === "KindGetAccessor" ||
    kind === "KindSetAccessor";
}

function isIterationKind(kind: string): boolean {
  return kind === "KindWhileStatement" || kind === "KindDoStatement" ||
    kind === "KindForStatement" || kind === "KindForInStatement" ||
    kind === "KindForOfStatement";
}

function isShortCircuitOperator(kind: string | undefined): boolean {
  return kind === "KindAmpersandAmpersandToken" || kind === "KindBarBarToken" ||
    kind === "KindQuestionQuestionToken";
}
